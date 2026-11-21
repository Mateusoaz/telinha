const ROOM_CONNECTION_TIMEOUT_MS = 7000;
const CONNECTION_FAILED_MESSAGE = 'Não deu pra conectar na sala. Confira o IP, a porta e o firewall do host.';
const CONNECTION_TIMED_OUT_MESSAGE = 'A sala não respondeu. Confira o IP, a porta e se o firewall do host liberou o Telinha.';

class RoomConnection {
  constructor({ url, name, password, wantsToHost, appVersion }) {
    this.url = url;
    this.appVersion = appVersion;
    this.name = name;
    this.password = password;
    this.wantsToHost = Boolean(wantsToHost);
    this.listenersByEvent = {};
    this.socket = null;
    this.isClosingOnPurpose = false;
    this.lastErrorMessage = null;
  }

  on(eventName, listener) {
    (this.listenersByEvent[eventName] ||= []).push(listener);
  }

  emit(eventName, ...values) {
    for (const listener of this.listenersByEvent[eventName] || []) {
      try {
        listener(...values);
      } catch (error) {
        console.error(error);
      }
    }
  }

  connect() {
    return new Promise((resolve, reject) => {
      let socket;
      try {
        socket = new WebSocket(this.url);
      } catch {
        reject(new Error('Endereço inválido.'));
        return;
      }
      this.socket = socket;
      let wasWelcomed = false;

      const connectionTimeout = setTimeout(() => {
        if (wasWelcomed) return;
        socket.close();
        reject(new Error(CONNECTION_TIMED_OUT_MESSAGE));
      }, ROOM_CONNECTION_TIMEOUT_MS);

      socket.onopen = () => {
        this.send({ type: 'hello', name: this.name, password: this.password, wantsToHost: this.wantsToHost, appVersion: this.appVersion });
      };

      socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'welcome') {
          wasWelcomed = true;
          clearTimeout(connectionTimeout);
          resolve(message);
        } else if (message.type === 'error') {
          this.lastErrorMessage = message.message;
          if (!wasWelcomed) {
            clearTimeout(connectionTimeout);
            reject(new Error(message.message));
          }
        } else {
          this.emit(message.type, message);
        }
      };

      socket.onclose = (event) => {
        clearTimeout(connectionTimeout);
        if (!wasWelcomed) reject(new Error(this.lastErrorMessage || CONNECTION_FAILED_MESSAGE));
        else if (!this.isClosingOnPurpose) this.emit('disconnected', event);
      };
    });
  }

  send(message) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  sendSignal(recipientId, payload) {
    this.send({ type: 'signal', to: recipientId, payload });
  }

  updateSharing(sharing) {
    this.send({ type: 'update-sharing', sharing });
  }

  close() {
    this.isClosingOnPurpose = true;
    if (this.socket) this.socket.close();
  }
}
