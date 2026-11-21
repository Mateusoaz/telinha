const RETRY_AFTER_FAILURE_MS = 1500;
const HAVE_CURRENT_DATA = 2;

function startWatching(broadcasterId) {
  const broadcaster = appState.participantsById.get(broadcasterId);
  if (!broadcaster || !broadcaster.sharing || !appState.roomConnection) return;
  if (appState.watchedStreamsByBroadcasterId.has(broadcasterId)) return;

  const tile = createStreamTile(broadcasterId);
  const viewer = new StreamViewer({
    roomConnection: appState.roomConnection,
    broadcasterId,
    onStream: (stream) => {
      if (tile.video.srcObject !== stream) tile.video.srcObject = stream;
      tile.video.play().catch(() => {});
    },
    onConnectionStateChange: (state) => handleViewerConnectionState(broadcasterId, state),
    onStats: (stats) => showStreamTileStats(broadcasterId, stats),
  });
  appState.watchedStreamsByBroadcasterId.set(broadcasterId, { viewer, tile });
  renderRoomScreen();
}

function stopWatching(broadcasterId, { notifyBroadcaster = true } = {}) {
  const watchedStream = appState.watchedStreamsByBroadcasterId.get(broadcasterId);
  if (!watchedStream) return;
  appState.watchedStreamsByBroadcasterId.delete(broadcasterId);
  watchedStream.viewer.close({ notifyBroadcaster });
  watchedStream.tile.video.srcObject = null;
  watchedStream.tile.element.remove();
  if (appState.focusedBroadcasterId === broadcasterId) appState.focusedBroadcasterId = null;
  renderRoomScreen();
}

function handleViewerConnectionState(broadcasterId, state) {
  const watchedStream = appState.watchedStreamsByBroadcasterId.get(broadcasterId);
  if (!watchedStream) return;
  const message = watchedStream.tile.message;

  if (state === 'connected' && watchedStream.tile.video.readyState < HAVE_CURRENT_DATA) message.textContent = 'Carregando vídeo…';
  if (state === 'disconnected') message.textContent = 'Conexão instável…';
  if (state === 'failed') {
    message.textContent = 'A conexão falhou. Tentando de novo…';
    setTimeout(() => {
      if (appState.watchedStreamsByBroadcasterId.get(broadcasterId) === watchedStream) watchedStream.viewer.requestStream();
    }, RETRY_AFTER_FAILURE_MS);
  }
  if (state === 'ended') {
    const broadcaster = appState.participantsById.get(broadcasterId);
    stopWatching(broadcasterId, { notifyBroadcaster: false });
    if (broadcaster) showToast(`${broadcaster.name} parou de compartilhar.`);
  }
}

function createStreamTile(broadcasterId) {
  const broadcaster = appState.participantsById.get(broadcasterId);
  const video = createElement('video', { autoplay: true, playsinline: true });
  const stats = createElement('div', { class: 'tile-stats' }, '…');
  if (!savedPreferences.read('showStats', true)) stats.classList.add('hidden');
  const message = createElement('div', { class: 'tile-message' }, 'Conectando…');
  const sourceLabel = createElement('span', { class: 'tile-source-label' }, broadcaster.sharing.sourceLabel);

  const element = createElement('div', { class: 'tile loading' },
    video,
    createElement('div', { class: 'tile-header' }, createElement('span', { class: 'live-badge' }, 'AO VIVO'), createElement('b', {}, broadcaster.name), sourceLabel),
    stats,
    message,
    createElement('div', { class: 'tile-controls' },
      ...createVolumeControls(video, broadcaster.name),
      createElement('div', { class: 'spacer' }),
      createElement('button', { class: 'icon-button', title: 'Mostrar/esconder estatísticas', onclick: () => toggleStatsVisibility(stats) }, '📊'),
      createElement('button', { class: 'icon-button', title: 'Destacar', onclick: () => toggleFocus(broadcasterId) }, '⤢'),
      createElement('button', { class: 'icon-button', title: 'Tela cheia (ou clique duas vezes)', onclick: () => toggleFullscreen(element) }, '⛶'),
      createElement('button', { class: 'icon-button', title: 'Parar de assistir', onclick: () => stopWatching(broadcasterId) }, '✕')));

  video.addEventListener('dblclick', () => toggleFullscreen(element));
  video.addEventListener('playing', () => {
    element.classList.remove('loading');
    message.textContent = '';
  });
  findElement('#stage-grid').append(element);
  return { element, video, stats, message, sourceLabel };
}

function createVolumeControls(video, broadcasterName) {
  const volumePreferenceKey = `volume.${broadcasterName}`;
  const muteButton = createElement('button', { class: 'icon-button', title: 'Mudo' }, '🔊');
  const volumeSlider = createElement('input', { type: 'range', min: 0, max: 1, step: 0.01, title: 'Volume' });
  volumeSlider.value = savedPreferences.read(volumePreferenceKey, 1);
  video.volume = Number(volumeSlider.value);

  const showMuteState = () => { muteButton.textContent = video.muted || video.volume === 0 ? '🔇' : '🔊'; };
  muteButton.addEventListener('click', () => {
    video.muted = !video.muted;
    showMuteState();
  });
  volumeSlider.addEventListener('input', () => {
    video.volume = Number(volumeSlider.value);
    video.muted = false;
    savedPreferences.write(volumePreferenceKey, video.volume);
    showMuteState();
  });
  return [muteButton, volumeSlider];
}

function toggleStatsVisibility(stats) {
  stats.classList.toggle('hidden');
  savedPreferences.write('showStats', !stats.classList.contains('hidden'));
}

function toggleFocus(broadcasterId) {
  appState.focusedBroadcasterId = appState.focusedBroadcasterId === broadcasterId ? null : broadcasterId;
  renderRoomScreen();
}

function toggleFullscreen(element) {
  if (document.fullscreenElement) document.exitFullscreen();
  else element.requestFullscreen().catch(() => {});
}

function updateStreamTileLabel(broadcasterId) {
  const watchedStream = appState.watchedStreamsByBroadcasterId.get(broadcasterId);
  const broadcaster = appState.participantsById.get(broadcasterId);
  if (watchedStream && broadcaster && broadcaster.sharing) watchedStream.tile.sourceLabel.textContent = broadcaster.sharing.sourceLabel;
}

function showStreamTileStats(broadcasterId, stats) {
  const watchedStream = appState.watchedStreamsByBroadcasterId.get(broadcasterId);
  if (!watchedStream || !stats) return;
  const video = stats.video;
  const lines = [];
  if (video && video.width) lines.push(`${video.width}×${video.height} · ${Math.round(video.framesPerSecond || 0)} fps`);
  lines.push(`${formatMegabits(stats.kilobitsPerSecond)} Mbps${video && video.codecName ? ` · ${video.codecName}` : ''}`);
  if (typeof stats.roundTripSeconds === 'number') lines.push(`ping ${Math.round(stats.roundTripSeconds * 1000)} ms`);
  if (video && video.decoderName) lines.push(`decoder: ${video.decoderName}${video.usesHardwareDecoder ? ' (placa)' : ' (processador)'}`);
  watchedStream.tile.stats.replaceChildren(...lines.flatMap((line, index) => (index ? [createElement('br'), line] : [line])));
}
