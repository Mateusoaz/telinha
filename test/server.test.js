const assert = require('assert');
const WebSocket = require('ws');
const { RoomServer } = require('../server/room-server');
const { RoomDiscovery } = require('../server/room-discovery');

const TEST_PORT = 47899;
const TEST_DISCOVERY_PORT = 47898;
const MESSAGE_TIMEOUT_MS = 2000;

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function connectTestClient(name, password, wantsToHost) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);
    const receivedMessages = [];
    socket.on('open', () => socket.send(JSON.stringify({ type: 'hello', name, password, wantsToHost })));
    socket.on('message', (rawMessage) => {
      const message = JSON.parse(rawMessage.toString());
      receivedMessages.push(message);
      if (message.type === 'welcome') {
        resolve({ socket, receivedMessages, id: message.yourId, welcome: message, send: (outgoing) => socket.send(JSON.stringify(outgoing)) });
      }
      if (message.type === 'error') reject(new Error(message.reason));
    });
    socket.on('error', reject);
  });
}

async function waitForMessage(client, matches) {
  const deadline = Date.now() + MESSAGE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const message = client.receivedMessages.find(matches);
    if (message) return message;
    await wait(20);
  }
  throw new Error('a mensagem esperada não chegou');
}

async function testRoomServer() {
  const server = new RoomServer({ port: TEST_PORT, roomName: 'Teste', password: 'abc', hostName: 'Ana' });
  await server.start();

  await assert.rejects(connectTestClient('Intruso', 'errada'), /wrong-password/);
  console.log('ok  senha errada é recusada');

  const ana = await connectTestClient('Ana', 'abc', true);
  const bia = await connectTestClient('Bia', 'abc', false);
  assert.strictEqual(bia.welcome.participants.length, 1);
  assert.strictEqual(bia.welcome.participants[0].isHost, true);
  await waitForMessage(ana, (message) => message.type === 'participant-joined' && message.participant.name === 'Bia');
  console.log('ok  entrar na sala, aviso de quem entrou e marca do host');

  ana.send({ type: 'update-sharing', sharing: { broadcastId: 'b1', sourceLabel: 'Monitor 1' } });
  const update = await waitForMessage(bia, (message) => message.type === 'participant-updated' && message.participant.sharing);
  assert.strictEqual(update.participant.id, ana.id);
  assert.strictEqual(update.participant.sharing.sourceLabel, 'Monitor 1');
  console.log('ok  "ao vivo" chega pros outros');

  bia.send({ type: 'signal', to: ana.id, payload: { direction: 'to-broadcaster', kind: 'watch-request' } });
  const signal = await waitForMessage(ana, (message) => message.type === 'signal');
  assert.strictEqual(signal.from, bia.id);
  assert.strictEqual(signal.payload.kind, 'watch-request');
  console.log('ok  repasse de sinalização');

  assert.strictEqual(server.describeRoom().participantCount, 2);
  assert.strictEqual(server.describeRoom().liveCount, 1);
  bia.socket.close();
  await waitForMessage(ana, (message) => message.type === 'participant-left' && message.participantId === bia.id);
  console.log('ok  aviso de quem saiu');

  return server;
}

async function testRoomDiscovery(server) {
  let discoveredRooms = [];
  const isolatedDiscovery = { announceOnlyOnThisComputer: true, port: TEST_DISCOVERY_PORT };
  const listener = new RoomDiscovery((rooms) => { discoveredRooms = rooms; }, isolatedDiscovery);
  const announcer = new RoomDiscovery(() => {}, isolatedDiscovery);
  listener.startListening();
  await wait(300);
  announcer.startAnnouncing(() => server.describeRoom());

  const deadline = Date.now() + 4000;
  while (!discoveredRooms.length && Date.now() < deadline) await wait(100);
  assert.ok(discoveredRooms.length >= 1, 'a sala não foi descoberta');
  assert.strictEqual(discoveredRooms[0].roomName, 'Teste');
  assert.strictEqual(discoveredRooms[0].port, TEST_PORT);
  assert.strictEqual(discoveredRooms[0].hasPassword, true);
  console.log('ok  descoberta da sala na rede via', discoveredRooms[0].addresses.join(', '));

  listener.stopListening();
  announcer.stopAnnouncing();
}

async function runAllTests() {
  const server = await testRoomServer();
  await testRoomDiscovery(server);
  server.stop();
  console.log('\nTUDO OK');
  process.exit(0);
}

runAllTests().catch((error) => {
  console.error('FALHOU:', error);
  process.exit(1);
});
