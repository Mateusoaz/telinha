const { WebSocketServer } = require('ws');
const crypto = require('crypto');

const MAXIMUM_PARTICIPANTS_PER_ROOM = 16;
const HEARTBEAT_INTERVAL_MS = 5000;
const HELLO_TIMEOUT_MS = 10000;
const MAXIMUM_MESSAGE_BYTES = 1024 * 1024;
const MAXIMUM_NAME_LENGTH = 32;

const CLOSE_CODE_ROOM_CLOSED = 4000;
const CLOSE_CODE_NO_HELLO = 4001;
const CLOSE_CODE_WRONG_PASSWORD = 4003;
const CLOSE_CODE_ROOM_FULL = 4004;

function createRandomId(byteCount) {
  return crypto.randomBytes(byteCount).toString('hex');
}

function isLoopbackAddress(address) {
  return /^(127\.|::1$|::ffff:127\.)/.test(address || '');
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

class RoomServer {
  constructor({ port, roomName, password, hostName }) {
    this.port = port;
    this.roomName = roomName || 'Sala';
    this.password = password || '';
    this.hostName = hostName || 'Host';
    this.roomId = createRandomId(6);
    this.participantsById = new Map();
    this.webSocketServer = null;
    this.heartbeatTimer = null;
  }

  start() {
    return new Promise((resolve, reject) => {
      const webSocketServer = new WebSocketServer({ port: this.port, host: '0.0.0.0', maxPayload: MAXIMUM_MESSAGE_BYTES });
      webSocketServer.once('error', reject);
      webSocketServer.once('listening', () => {
        webSocketServer.off('error', reject);
        webSocketServer.on('error', (error) => console.error('[sala]', error.message));
        this.webSocketServer = webSocketServer;
        this.heartbeatTimer = setInterval(() => this.disconnectUnresponsiveParticipants(), HEARTBEAT_INTERVAL_MS);
        resolve();
      });
      webSocketServer.on('connection', (socket, request) => this.handleNewConnection(socket, request));
    });
  }

  stop() {
    clearInterval(this.heartbeatTimer);
    if (!this.webSocketServer) return;
    for (const participant of this.participantsById.values()) {
      participant.socket.close(CLOSE_CODE_ROOM_CLOSED, 'sala fechada');
    }
    this.participantsById.clear();
    this.webSocketServer.close();
    this.webSocketServer = null;
  }

  describeRoom() {
    const participants = [...this.participantsById.values()];
    return {
      roomId: this.roomId,
      roomName: this.roomName,
      hostName: this.hostName,
      port: this.port,
      participantCount: participants.length,
      liveCount: participants.filter((participant) => participant.sharing).length,
      hasPassword: Boolean(this.password),
    };
  }

  disconnectUnresponsiveParticipants() {
    for (const participant of this.participantsById.values()) {
      if (!participant.socket.answeredLastPing) {
        participant.socket.terminate();
        continue;
      }
      participant.socket.answeredLastPing = false;
      if (participant.socket.readyState === participant.socket.OPEN) participant.socket.ping();
    }
  }

  toPublicParticipant(participant) {
    return { id: participant.id, name: participant.name, sharing: participant.sharing, isHost: participant.isHost, appVersion: participant.appVersion };
  }

  sendToEveryoneExcept(message, excludedParticipantId) {
    const text = JSON.stringify(message);
    for (const participant of this.participantsById.values()) {
      if (participant.id !== excludedParticipantId && participant.socket.readyState === participant.socket.OPEN) {
        participant.socket.send(text);
      }
    }
  }

  handleNewConnection(socket, request) {
    const connectedFromThisComputer = isLoopbackAddress(request.socket.remoteAddress);
    let participant = null;

    socket.answeredLastPing = true;
    socket.on('pong', () => { socket.answeredLastPing = true; });
    socket.on('error', () => {});

    const sendToThisSocket = (message) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    };

    const helloTimeout = setTimeout(() => {
      if (!participant) socket.close(CLOSE_CODE_NO_HELLO, 'sem hello');
    }, HELLO_TIMEOUT_MS);

    socket.on('message', (rawMessage) => {
      const message = parseJson(rawMessage.toString());
      if (!message) return;

      if (!participant) {
        if (message.type !== 'hello') return;
        participant = this.admitParticipant(socket, message, connectedFromThisComputer, sendToThisSocket);
        if (participant) clearTimeout(helloTimeout);
        return;
      }

      if (message.type === 'update-sharing') this.updateSharing(participant, message.sharing);
      if (message.type === 'signal') this.forwardSignal(participant, message.to, message.payload);
    });

    socket.on('close', () => {
      clearTimeout(helloTimeout);
      if (participant && this.participantsById.get(participant.id) === participant) {
        this.participantsById.delete(participant.id);
        this.sendToEveryoneExcept({ type: 'participant-left', participantId: participant.id });
      }
    });
  }

  admitParticipant(socket, helloMessage, connectedFromThisComputer, sendToThisSocket) {
    if (this.password && helloMessage.password !== this.password) {
      sendToThisSocket({ type: 'error', reason: 'wrong-password', message: 'Senha errada.' });
      socket.close(CLOSE_CODE_WRONG_PASSWORD, 'senha errada');
      return null;
    }
    if (this.participantsById.size >= MAXIMUM_PARTICIPANTS_PER_ROOM) {
      sendToThisSocket({ type: 'error', reason: 'room-full', message: 'A sala está cheia.' });
      socket.close(CLOSE_CODE_ROOM_FULL, 'sala cheia');
      return null;
    }

    const participant = {
      id: createRandomId(4),
      name: String(helloMessage.name || 'Anônimo').slice(0, MAXIMUM_NAME_LENGTH),
      sharing: null,
      isHost: Boolean(helloMessage.wantsToHost) && connectedFromThisComputer,
      appVersion: typeof helloMessage.appVersion === 'string' ? helloMessage.appVersion.slice(0, 20) : null,
      socket,
    };
    const otherParticipants = [...this.participantsById.values()].map((other) => this.toPublicParticipant(other));
    this.participantsById.set(participant.id, participant);

    sendToThisSocket({
      type: 'welcome',
      yourId: participant.id,
      room: { roomId: this.roomId, roomName: this.roomName, hostName: this.hostName },
      participants: otherParticipants,
    });
    this.sendToEveryoneExcept({ type: 'participant-joined', participant: this.toPublicParticipant(participant) }, participant.id);
    return participant;
  }

  updateSharing(participant, sharing) {
    participant.sharing = sharing && typeof sharing === 'object' ? sharing : null;
    this.sendToEveryoneExcept({ type: 'participant-updated', participant: this.toPublicParticipant(participant) }, participant.id);
  }

  forwardSignal(sender, recipientId, payload) {
    const recipient = this.participantsById.get(recipientId);
    if (recipient && recipient.socket.readyState === recipient.socket.OPEN) {
      recipient.socket.send(JSON.stringify({ type: 'signal', from: sender.id, payload }));
    }
  }
}

module.exports = { RoomServer, CLOSE_CODE_ROOM_CLOSED };
