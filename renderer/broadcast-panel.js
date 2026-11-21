const LIMITATION_REASON_LABELS = { cpu: 'CPU', bandwidth: 'rede' };

function renderBroadcastPanel() {
  const panel = findElement('#broadcast-panel');
  const broadcast = appState.myBroadcast;
  if (!broadcast) {
    panel.replaceChildren(createElement('button', { class: 'button primary wide', onclick: () => openShareDialog({ mode: 'start' }) }, '🖥  Compartilhar tela'));
    return;
  }
  panel.replaceChildren(createElement('div', { class: 'broadcast-card' },
    createElement('div', { class: 'broadcast-header' },
      createElement('span', { class: 'live-badge' }, 'AO VIVO'),
      createElement('span', { class: 'broadcast-source' }, broadcast.sourceLabel)),
    createElement('video', { class: 'broadcast-preview', autoplay: true, muted: true, srcObject: broadcast.stream }),
    createElement('div', { class: 'broadcast-stats', id: 'broadcast-stats' }, 'Esperando alguém assistir…'),
    createElement('div', { class: 'broadcast-actions' },
      createElement('button', { class: 'button small', onclick: () => openShareDialog({ mode: 'adjust' }) }, '⚙ Qualidade'),
      createElement('button', { class: 'button small', onclick: () => openShareDialog({ mode: 'switch' }) }, '🔄 Trocar'),
      createElement('button', { class: 'button danger small', onclick: () => stopBroadcast() }, 'Parar'))));
}

function showBroadcastStats(stats) {
  const statsElement = findElement('#broadcast-stats');
  const broadcast = appState.myBroadcast;
  if (!statsElement || !broadcast) return;
  const settings = broadcast.settings;

  if (!stats.viewerCount) {
    statsElement.replaceChildren('Esperando alguém assistir…', createElement('br'),
      `${describeResolution(settings.resolution)} · ${settings.framesPerSecond} fps · até ${settings.bitrateMegabits} Mbps`);
    return;
  }

  const lines = [`👁 ${stats.viewerCount} assistindo · ↑ ${formatMegabits(stats.kilobitsPerSecond)} Mbps`];
  const video = stats.video;
  if (video) {
    lines.push(`${video.width || '?'}×${video.height || '?'} · ${Math.round(video.framesPerSecond || 0)} fps · ${video.codecName}`);
    if (video.encoderName) lines.push(`encoder: ${video.encoderName}${video.usesHardwareEncoder ? ' (placa de vídeo)' : ''}`);
  }
  const children = lines.flatMap((line) => [line, createElement('br')]);
  if (video && video.limitationReason && video.limitationReason !== 'none') {
    children.push(createElement('span', { class: 'warn' }, `⚠ limitado pela ${LIMITATION_REASON_LABELS[video.limitationReason] || video.limitationReason}`));
  }
  statsElement.replaceChildren(...children);
}

async function captureAudioFor(source, settings, { allowSystemLoopback = true } = {}) {
  if (!settings.shareAudio) return { audioTrack: null, useSystemLoopback: false };
  try {
    const audioTrack = await capturedAudio.start(source.kind === 'window' ? 'window' : 'screen', source.windowHandle, { excludeDiscord: settings.excludeDiscordAudio });
    return { audioTrack, useSystemLoopback: false };
  } catch (error) {
    console.warn('[audio] o captador falhou:', error.message);
    if (source.kind === 'screen' && allowSystemLoopback) {
      showToast('Usando o áudio do sistema inteiro (o captador de áudio falhou).', 'warn');
      return { audioTrack: null, useSystemLoopback: true };
    }
    showToast(`Não deu pra pegar o áudio dessa janela: ${error.message}`, 'error');
    return { audioTrack: null, useSystemLoopback: false };
  }
}

async function startBroadcast(source, requestedSettings) {
  if (!source) {
    showToast('Escolha uma tela ou janela.', 'warn');
    return;
  }
  stopBroadcast({ silently: true });
  const settings = normalizeShareSettings(requestedSettings);
  const { audioTrack, useSystemLoopback } = await captureAudioFor(source, settings);

  await desktopApp.chooseCaptureSource(source.id, useSystemLoopback);
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: buildCaptureConstraints(settings), audio: useSystemLoopback });
  } catch (error) {
    capturedAudio.stop();
    showToast(`Não deu pra capturar a tela: ${error.message}`, 'error');
    return;
  }
  if (audioTrack) stream.addTrack(audioTrack);

  const videoTrack = stream.getVideoTracks()[0];
  videoTrack.contentHint = settings.priority;

  const broadcast = new ScreenBroadcast({
    roomConnection: appState.roomConnection,
    stream,
    settings,
    sourceLabel: source.name,
    sourceKind: source.kind,
    captureVideoTrack: createVideoCapturer(source),
    onSourceEnded: () => {
      if (appState.myBroadcast !== broadcast) return;
      showToast('O compartilhamento terminou (a janela foi fechada?).', 'warn');
      stopBroadcast();
    },
    onChange: (changedBroadcast) => {
      if (appState.myBroadcast !== changedBroadcast) return;
      showCurrentStreamInPreview(changedBroadcast);
      publishMyBroadcast();
      renderRoomScreen();
    },
    onStats: showBroadcastStats,
  });
  appState.myBroadcast = broadcast;
  publishMyBroadcast();
  renderBroadcastPanel();
  renderRoomScreen();

  const captured = videoTrack.getSettings();
  console.log(`[transmissão] ao vivo: ${source.name} ${captured.width}x${captured.height}@${captured.frameRate} áudio=${Boolean(stream.getAudioTracks().length)}`);
}

function createVideoCapturer(source) {
  return async (settings) => {
    await desktopApp.chooseCaptureSource(source.id, false);
    const capturedStream = await navigator.mediaDevices.getDisplayMedia({ video: buildCaptureConstraints(settings), audio: false });
    return capturedStream.getVideoTracks()[0];
  };
}

function showCurrentStreamInPreview(broadcast) {
  const preview = findElement('.broadcast-preview');
  if (preview && preview.srcObject !== broadcast.stream) preview.srcObject = broadcast.stream;
}

async function switchBroadcastSource(source, requestedSettings) {
  const broadcast = appState.myBroadcast;
  if (!broadcast || !source) return;
  const settings = normalizeShareSettings(requestedSettings);
  try {
    await broadcast.switchSource({ sourceLabel: source.name, sourceKind: source.kind, captureVideoTrack: createVideoCapturer(source), settings });
  } catch (error) {
    showToast(`Não deu pra trocar: ${error.message}`, 'error');
    return;
  }
  if (!settings.shareAudio) capturedAudio.stop();
  const { audioTrack } = await captureAudioFor(source, settings, { allowSystemLoopback: false });
  await broadcast.replaceAudioTrack(audioTrack);
  renderBroadcastPanel();
  showToast(`Agora transmitindo: ${source.name}`, 'ok');
}

function publishMyBroadcast() {
  if (appState.roomConnection) appState.roomConnection.updateSharing(appState.myBroadcast ? appState.myBroadcast.describeForRoom() : null);
}

function stopBroadcast({ silently = false } = {}) {
  const broadcast = appState.myBroadcast;
  if (!broadcast) return;
  appState.myBroadcast = null;
  broadcast.stop();
  publishMyBroadcast();
  renderBroadcastPanel();
  renderRoomScreen();
  if (!silently) showToast('Você parou de compartilhar.');
}
