const DEFAULT_ROOM_PORT = 47800;
const LOOPBACK_ADDRESS = '127.0.0.1';

async function initializeLobby() {
  const nameInput = findElement('#my-name-input');
  nameInput.value = appState.myName;
  nameInput.addEventListener('input', readMyName);

  findElement('#new-room-name-input').value = savedPreferences.read('roomName', '');
  findElement('#new-room-port-input').value = savedPreferences.read('roomPort', DEFAULT_ROOM_PORT);
  findElement('#join-address-input').value = savedPreferences.read('lastAddress', '');
  findElement('#join-port-input').value = savedPreferences.read('lastPort', DEFAULT_ROOM_PORT);

  findElement('#create-room-button').addEventListener('click', createRoom);
  findElement('#join-button').addEventListener('click', joinRoomByAddress);
  findElement('#join-address-input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') joinRoomByAddress();
  });

  desktopApp.onRoomsFound((rooms) => {
    appState.discoveredRooms = rooms;
    renderDiscoveredRooms();
  });
  renderDiscoveredRooms();

  appState.networkInfo = await desktopApp.getNetworkInfo();
  showRadminStatus();
  showFirewallStatus();
  await initializeHardwareDecodingToggle();
}

async function initializeHardwareDecodingToggle() {
  const checkbox = findElement('#hardware-decoding-checkbox');
  const preferences = await desktopApp.getAppPreferences();
  checkbox.checked = preferences.useHardwareVideoDecoding;
  checkbox.addEventListener('change', async () => {
    await desktopApp.setHardwareVideoDecoding(checkbox.checked);
    showRestartToast();
  });
}

function showRestartToast() {
  const toast = createElement('div', { class: 'toast' },
    'Isso só vale depois de reiniciar o Telinha. ',
    createElement('button', { class: 'button small primary', onclick: () => desktopApp.restartApp() }, 'Reiniciar agora'));
  findElement('#toasts').append(toast);
  setTimeout(() => toast.remove(), ERROR_TOAST_DURATION_MS * 2);
}

function readMyName() {
  appState.myName = findElement('#my-name-input').value.trim();
  savedPreferences.write('name', appState.myName);
  return appState.myName;
}

function ensureNameIsFilled() {
  if (readMyName()) return true;
  showToast('Coloca um nome primeiro 🙂', 'warn');
  findElement('#my-name-input').focus();
  return false;
}

function showRadminStatus() {
  const radminInterface = appState.networkInfo && appState.networkInfo.radminInterface;
  const status = findElement('#radmin-status');
  if (!radminInterface) {
    status.replaceChildren(createElement('span', { class: 'warn' }, '⚠ Radmin VPN não detectado. Sem ele, só dá pra conectar com quem está na mesma rede local.'));
    return;
  }
  status.replaceChildren(
    'Seu IP no Radmin: ',
    createElement('b', {}, radminInterface.address),
    createElement('button', { class: 'icon-button', onclick: () => copyTextToClipboard(radminInterface.address) }, 'copiar'),
  );
}

async function showFirewallStatus() {
  const status = findElement('#firewall-status');
  status.replaceChildren('🛡 Verificando o firewall…');
  const firewall = await desktopApp.checkFirewall();
  if (firewall.isAllowed === null) {
    status.replaceChildren();
    return;
  }
  if (firewall.isAllowed) {
    status.replaceChildren(createElement('span', { class: 'ok' }, '🛡 Firewall liberado pro Radmin'));
    return;
  }
  const problem = firewall.isBlocked ? '⚠ O firewall está bloqueando o Telinha no Radmin.' : '⚠ O Telinha ainda não foi liberado no firewall.';
  status.replaceChildren(
    createElement('span', { class: 'warn' }, problem),
    createElement('button', { class: 'button small', onclick: allowAppThroughFirewall }, 'Liberar (pede administrador)'),
  );
}

async function allowAppThroughFirewall() {
  showToast('Confirme no aviso do Windows…');
  const firewall = await desktopApp.allowThroughFirewall();
  await showFirewallStatus();
  if (firewall.isAllowed) showToast('Firewall liberado!', 'ok');
  else showToast('Não deu pra liberar o firewall (o aviso foi cancelado?).', 'error');
}

function renderDiscoveredRooms() {
  const roomList = findElement('#discovered-rooms');
  if (!appState.discoveredRooms.length) {
    roomList.replaceChildren(createElement('div', { class: 'empty-message' }, createElement('span', { class: 'spinner' }), 'Procurando salas na rede…'));
    return;
  }
  roomList.replaceChildren(...appState.discoveredRooms.map(createDiscoveredRoomItem));
}

function createDiscoveredRoomItem(room) {
  const peopleLabel = room.participantCount === 1 ? 'pessoa' : 'pessoas';
  return createElement('div', { class: 'room-item' },
    createElement('div', { class: 'room-item-info' },
      createElement('div', { class: 'room-item-name' }, room.hasPassword ? '🔒 ' : '', room.roomName),
      createElement('div', { class: 'room-item-details' },
        `${room.hostName} · ${room.participantCount} ${peopleLabel}`,
        room.liveCount ? createElement('span', { class: 'room-item-live' }, ` · ${room.liveCount} ao vivo`) : '',
        ` · ${room.isOnThisComputer ? 'este PC' : room.address}`)),
    createElement('button', { class: 'button primary small', onclick: () => joinDiscoveredRoom(room) }, 'Entrar'));
}

function joinDiscoveredRoom(room) {
  const password = findElement('#join-password-input').value;
  if (room.hasPassword && !password) {
    showToast('Essa sala tem senha: digite no campo "Senha" e clique em Entrar de novo.', 'warn');
    findElement('#join-password-input').focus();
    return;
  }
  joinRoom({ address: room.address, port: room.port, password, wantsToHost: false });
}

function joinRoomByAddress() {
  const address = findElement('#join-address-input').value.trim();
  if (!address) {
    showToast('Digite o IP do host.', 'warn');
    findElement('#join-address-input').focus();
    return;
  }
  const port = Number(findElement('#join-port-input').value) || DEFAULT_ROOM_PORT;
  joinRoom({ address, port, password: findElement('#join-password-input').value, wantsToHost: false });
}

async function createRoom() {
  if (!ensureNameIsFilled()) return;
  const typedRoomName = findElement('#new-room-name-input').value.trim();
  const port = Number(findElement('#new-room-port-input').value) || DEFAULT_ROOM_PORT;
  const password = findElement('#new-room-password-input').value;
  savedPreferences.write('roomName', typedRoomName);
  savedPreferences.write('roomPort', port);

  const createButton = findElement('#create-room-button');
  createButton.disabled = true;
  try {
    const result = await desktopApp.startHostingRoom({ port, roomName: typedRoomName || `Sala de ${appState.myName}`, password, hostName: appState.myName });
    if (!result.started) {
      showToast(result.error, 'error');
      return;
    }
    appState.hostedRoom = { port };
    const joined = await joinRoom({ address: LOOPBACK_ADDRESS, port, password, wantsToHost: true });
    if (!joined) {
      await desktopApp.stopHostingRoom();
      appState.hostedRoom = null;
    }
  } finally {
    createButton.disabled = false;
  }
}
