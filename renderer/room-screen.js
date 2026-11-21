const ROOM_CLOSED_BY_HOST_CODE = 4000;

async function joinRoom({ address, port, password, wantsToHost }) {
  if (!ensureNameIsFilled() || appState.roomConnection) return false;
  const roomConnection = new RoomConnection({ url: `ws://${address}:${port}`, name: appState.myName, password, wantsToHost, appVersion: appState.launchOptions.appVersion });
  let welcome;
  try {
    welcome = await roomConnection.connect();
  } catch (error) {
    showToast(error.message, 'error');
    return false;
  }

  appState.roomConnection = roomConnection;
  appState.myParticipantId = welcome.yourId;
  appState.roomDetails = { ...welcome.room, address, port };
  appState.participantsById = new Map(welcome.participants.map((participant) => [participant.id, participant]));
  if (!wantsToHost) {
    savedPreferences.write('lastAddress', address);
    savedPreferences.write('lastPort', port);
  }

  listenToRoomEvents(roomConnection);
  showScreen('room');
  renderBroadcastPanel();
  renderRoomScreen();
  return true;
}

function listenToRoomEvents(roomConnection) {
  roomConnection.on('participant-joined', ({ participant }) => {
    appState.participantsById.set(participant.id, participant);
    showToast(`${participant.name} entrou na sala`);
    renderRoomScreen();
  });
  roomConnection.on('participant-left', ({ participantId }) => handleParticipantLeft(participantId));
  roomConnection.on('participant-updated', ({ participant }) => handleParticipantUpdated(participant));
  roomConnection.on('signal', ({ from, payload }) => routeSignal(from, payload));
  roomConnection.on('disconnected', (event) => {
    showToast(event && event.code === ROOM_CLOSED_BY_HOST_CODE ? 'O host fechou a sala.' : 'A conexão com a sala caiu.', 'error');
    leaveRoom();
  });
}

function handleParticipantLeft(participantId) {
  const participant = appState.participantsById.get(participantId);
  appState.participantsById.delete(participantId);
  if (appState.myBroadcast) appState.myBroadcast.removeViewer(participantId, { notifyViewer: false });
  stopWatching(participantId, { notifyBroadcaster: false });
  if (participant) showToast(`${participant.name} saiu da sala`);
  renderRoomScreen();
}

function handleParticipantUpdated(participant) {
  const previousSharing = (appState.participantsById.get(participant.id) || {}).sharing;
  const currentSharing = participant.sharing;
  appState.participantsById.set(participant.id, participant);

  if (!previousSharing && currentSharing) showToast(`🔴 ${participant.name} está ao vivo: ${currentSharing.sourceLabel}`);

  if (appState.watchedStreamsByBroadcasterId.has(participant.id)) {
    if (!currentSharing) {
      stopWatching(participant.id, { notifyBroadcaster: false });
    } else if (previousSharing && previousSharing.broadcastId !== currentSharing.broadcastId) {
      stopWatching(participant.id, { notifyBroadcaster: false });
      startWatching(participant.id);
    } else {
      updateStreamTileLabel(participant.id);
    }
  }
  renderRoomScreen();
}

function routeSignal(senderId, payload) {
  if (!payload) return;
  if (payload.direction === 'to-broadcaster') {
    if (appState.myBroadcast) {
      appState.myBroadcast.handleSignalFromViewer(senderId, payload).catch((error) => console.error('[transmissão]', error));
    } else if (payload.kind === 'watch-request') {
      appState.roomConnection.sendSignal(senderId, { direction: 'to-viewer', kind: 'broadcast-ended' });
    }
    return;
  }
  const watchedStream = appState.watchedStreamsByBroadcasterId.get(senderId);
  if (watchedStream) watchedStream.viewer.handleSignalFromBroadcaster(payload).catch((error) => console.error('[assistindo]', error));
}

function leaveRoom() {
  stopBroadcast({ silently: true });
  for (const broadcasterId of [...appState.watchedStreamsByBroadcasterId.keys()]) stopWatching(broadcasterId, { notifyBroadcaster: false });
  if (appState.roomConnection) appState.roomConnection.close();
  appState.roomConnection = null;
  appState.participantsById.clear();
  if (appState.hostedRoom) {
    desktopApp.stopHostingRoom();
    appState.hostedRoom = null;
  }
  showScreen('lobby');
}

function listOtherParticipants() {
  return [...appState.participantsById.values()].sort((first, second) => first.name.localeCompare(second.name));
}

function renderRoomScreen() {
  if (!appState.roomConnection) return;
  renderRoomHeader();
  renderParticipantList();
  renderLiveStrip();
  renderStage();
  renderMyStatusBar();
}

function renderRoomHeader() {
  const room = appState.roomDetails;
  findElement('#room-title').textContent = room.roomName;
  const subtitle = findElement('#room-subtitle');
  if (appState.hostedRoom) {
    const radminInterface = appState.networkInfo && appState.networkInfo.radminInterface;
    subtitle.replaceChildren('Você é o host', radminInterface ? createCopyableAddress(radminInterface.address) : '');
  } else {
    subtitle.replaceChildren(`Host: ${room.hostName}`, createCopyableAddress(room.address));
  }
}

function createCopyableAddress(address) {
  return createElement('code', { title: 'Clique pra copiar', onclick: () => copyTextToClipboard(address) }, address);
}

function renderParticipantList() {
  const me = { id: appState.myParticipantId, name: appState.myName, sharing: appState.myBroadcast ? appState.myBroadcast.describeForRoom() : null, isHost: Boolean(appState.hostedRoom), isMe: true };
  const everyone = [me, ...listOtherParticipants()];
  findElement('#participant-count').textContent = everyone.length;
  findElement('#participant-list').replaceChildren(...everyone.map(createParticipantItem));
}

function createParticipantItem(participant) {
  const isLive = Boolean(participant.sharing);
  const isBeingWatched = appState.watchedStreamsByBroadcasterId.has(participant.id);
  const canBeWatched = isLive && !participant.isMe;
  const tags = [participant.isMe ? '(você)' : '', participant.isHost ? '👑' : ''].filter(Boolean).join(' ');
  const toggleWatching = () => (isBeingWatched ? stopWatching(participant.id) : startWatching(participant.id));

  return createElement('li', {
    class: `participant${canBeWatched ? ' clickable' : ''}${isBeingWatched ? ' watching' : ''}`,
    title: canBeWatched ? (isBeingWatched ? 'Parar de assistir' : `Assistir ${participant.name}`) : '',
    onclick: canBeWatched ? toggleWatching : null,
  },
  createAvatar(participant.name, isLive),
  createElement('div', { class: 'participant-name' }, participant.name, ' ', createElement('span', { class: 'participant-tags' }, tags), describeVersionMismatch(participant)),
  isLive ? createElement('span', { class: 'viewer-count', title: 'Assistindo' }, `👁 ${participant.sharing.viewerIds.length}`) : '',
  isLive ? createElement('span', { class: 'live-badge' }, 'AO VIVO') : '');
}

function describeVersionMismatch(participant) {
  if (participant.isMe || participant.appVersion === appState.launchOptions.appVersion) return '';
  const label = participant.appVersion ? `v${participant.appVersion}` : 'versão antiga';
  return createElement('span', { class: 'version-mismatch', title: 'Versão do Telinha diferente da sua' }, ` ${label}`);
}

function renderLiveStrip() {
  const liveParticipantsNotWatched = listOtherParticipants().filter((participant) => participant.sharing && !appState.watchedStreamsByBroadcasterId.has(participant.id));
  findElement('#live-strip').replaceChildren(...liveParticipantsNotWatched.map(createLiveCard));
}

function createLiveCard(participant) {
  const sharing = participant.sharing;
  return createElement('div', { class: 'live-card', title: 'Clique pra assistir', onclick: () => startWatching(participant.id) },
    createAvatar(participant.name, true),
    createElement('div', { class: 'live-card-info' },
      createElement('div', { class: 'live-card-name' }, participant.name),
      createElement('div', { class: 'live-card-details' }, `${sharing.sourceLabel} · ${describeResolution(sharing.resolution)}${sharing.framesPerSecond}${sharing.hasAudio ? ' · 🔊' : ''}`)),
    createElement('button', { class: 'button primary small' }, 'Assistir'));
}

function renderStage() {
  const watchedCount = appState.watchedStreamsByBroadcasterId.size;
  const stageGrid = findElement('#stage-grid');
  const layoutClass = watchedCount <= 4 ? `tiles-${watchedCount}` : 'tiles-many';
  const hasFocus = appState.focusedBroadcasterId && watchedCount > 1;
  stageGrid.className = `stage-grid ${layoutClass}${hasFocus ? ' has-focus' : ''}`;
  for (const [broadcasterId, watchedStream] of appState.watchedStreamsByBroadcasterId) {
    watchedStream.tile.element.classList.toggle('focused', appState.focusedBroadcasterId === broadcasterId);
  }

  const placeholder = findElement('#stage-placeholder');
  placeholder.classList.toggle('hidden', watchedCount > 0);
  if (watchedCount > 0) return;
  const someoneIsLive = listOtherParticipants().some((participant) => participant.sharing);
  findElement('h3', placeholder).textContent = someoneIsLive ? 'Tem gente ao vivo!' : 'Ninguém ao vivo ainda';
  findElement('p', placeholder).textContent = someoneIsLive
    ? 'Clique em quem está ao vivo pra assistir.'
    : 'Clique em "Compartilhar tela" pra começar, ou espere alguém entrar ao vivo.';
}

function renderMyStatusBar() {
  findElement('#my-avatar').replaceChildren(createAvatar(appState.myName, Boolean(appState.myBroadcast)));
  findElement('#my-name-label').textContent = appState.myName;
  const watchedCount = appState.watchedStreamsByBroadcasterId.size;
  let status = 'Conectado';
  if (watchedCount) status = `Assistindo ${watchedCount}`;
  if (appState.myBroadcast) status = `Ao vivo · 👁 ${appState.myBroadcast.connectionsByViewerId.size}`;
  findElement('#my-status').textContent = status;
}
