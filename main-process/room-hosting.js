const { ipcMain } = require('electron');
const { RoomServer } = require('../server/room-server');
const { RoomDiscovery, listNetworkInterfaces } = require('../server/room-discovery');

const DEFAULT_ROOM_PORT = 47800;

let roomServer = null;
let roomDiscovery = null;

function registerRoomHostingHandlers({ getMainWindow, announceOnlyOnThisComputer }) {
  roomDiscovery = new RoomDiscovery((rooms) => {
    const mainWindow = getMainWindow();
    if (mainWindow) mainWindow.webContents.send('rooms-found', rooms);
  }, { announceOnlyOnThisComputer });
  roomDiscovery.startListening();

  ipcMain.handle('get-network-info', () => {
    const externalInterfaces = listNetworkInterfaces().filter((networkInterface) => !networkInterface.isInternal);
    return { interfaces: externalInterfaces, radminInterface: externalInterfaces.find((networkInterface) => networkInterface.isRadmin) || null };
  });

  ipcMain.handle('start-hosting-room', (event, options) => startHostingRoom(options));

  ipcMain.handle('stop-hosting-room', () => {
    stopHostingRoom();
    return true;
  });
}

async function startHostingRoom({ port, roomName, password, hostName }) {
  stopHostingRoom();
  const server = new RoomServer({ port: Number(port) || DEFAULT_ROOM_PORT, roomName, password, hostName });
  try {
    await server.start();
  } catch (error) {
    const message = error.code === 'EADDRINUSE'
      ? `A porta ${server.port} já está em uso (outra sala aberta neste PC?).`
      : error.message;
    return { started: false, error: message };
  }
  roomServer = server;
  roomDiscovery.startAnnouncing(() => server.describeRoom());
  return { started: true, port: server.port };
}

function stopHostingRoom() {
  if (roomDiscovery) roomDiscovery.stopAnnouncing();
  if (roomServer) roomServer.stop();
  roomServer = null;
}

function shutDownRoomHosting() {
  stopHostingRoom();
  if (roomDiscovery) roomDiscovery.stopListening();
}

module.exports = { registerRoomHostingHandlers, shutDownRoomHosting };
