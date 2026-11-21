const GLITCH_TEST_SECONDS = 44;
const GLITCH_SAMPLE_INTERVAL_MS = 100;
const GLITCH_VIEWER_SECONDS = 46;
const EXTRA_VIEWER_SECONDS = 12;
const BLACK_CHANNEL_LIMIT = 12;
const BLACK_FRACTION_WORTH_A_SCREENSHOT = 0.03;
const MAXIMUM_GLITCH_SCREENSHOTS = 6;
const ANIMATION_WINDOW_NAME = 'Animacao Teste';

const GLITCH_TEST_TIMELINE = [
  { second: 6, name: 'trocou pra janela (ao vivo)', run: (sources) => switchBroadcastSource(sources.animationWindow, appState.myBroadcast.settings) },
  { second: 12, name: 'mudou pra 720p (janela)', run: () => appState.myBroadcast.updateSettings({ resolution: '720' }) },
  { second: 16, name: 'voltou pra 1080p (janela)', run: () => appState.myBroadcast.updateSettings({ resolution: '1080' }) },
  { second: 20, name: 'janela por cima', run: () => desktopApp.showTestOccludingWindow() },
  { second: 24, name: 'tirou a janela de cima', run: () => desktopApp.hideTestOccludingWindow() },
  { second: 28, name: 'segundo espectador entrando', run: () => {} },
  { second: 32, name: 'trocou de volta pro monitor (ao vivo)', run: (sources) => switchBroadcastSource(sources.firstMonitor, appState.myBroadcast.settings) },
];

function logTestEvent(name) {
  logTestStep('evento:', JSON.stringify({ time: Date.now(), name }));
}

async function runGlitchHostAutotest() {
  await createTestRoom();

  const allSources = await desktopApp.listCaptureSources();
  const sources = {
    firstMonitor: allSources.find((candidate) => candidate.kind === 'screen'),
    animationWindow: allSources.find((candidate) => candidate.kind === 'window' && candidate.name === ANIMATION_WINDOW_NAME),
  };
  if (!sources.firstMonitor || !sources.animationWindow) {
    logTestStep('FALHA: fonte não encontrada', JSON.stringify(allSources.map((candidate) => candidate.name)));
    return;
  }
  await startBroadcast(sources.firstMonitor, { ...DEFAULT_SHARE_SETTINGS, shareAudio: true });
  logTestEvent('ao vivo (monitor)');

  for (let second = 1; second <= GLITCH_TEST_SECONDS; second += 1) {
    await waitMilliseconds(1000);
    const step = GLITCH_TEST_TIMELINE.find((candidate) => candidate.second === second);
    if (step && appState.myBroadcast) {
      logTestEvent(step.name);
      const result = await step.run(sources);
      if (result === false) logTestEvent('FALHOU: ' + step.name);
    }
    if (!appState.myBroadcast) {
      logTestStep('FALHA: a transmissão caiu no segundo', second);
      return;
    }
    const outbound = await readOutboundVideoCounters();
    if (outbound) logTestStep('envio-detalhe:', JSON.stringify({ time: Date.now(), source: appState.myBroadcast.sourceLabel, hasAudio: Boolean(appState.myBroadcast.audioTrack), ...outbound }));
  }
}

async function readOutboundVideoCounters() {
  const broadcast = appState.myBroadcast;
  if (!broadcast) return null;
  const totals = { viewers: broadcast.connectionsByViewerId.size, keyFramesEncoded: 0, pliReceived: 0, nackReceived: 0, retransmittedPackets: 0, width: 0, height: 0, limitation: '' };
  for (const connection of broadcast.connectionsByViewerId.values()) {
    const report = await connection.peerConnection.getStats();
    report.forEach((entry) => {
      if (entry.type !== 'outbound-rtp' || entry.kind !== 'video') return;
      totals.keyFramesEncoded += entry.keyFramesEncoded || 0;
      totals.pliReceived += entry.pliCount || 0;
      totals.nackReceived += entry.nackCount || 0;
      totals.retransmittedPackets += entry.retransmittedPacketsSent || 0;
      totals.width = entry.frameWidth || totals.width;
      totals.height = entry.frameHeight || totals.height;
      totals.limitation = entry.qualityLimitationReason || totals.limitation;
    });
  }
  return totals;
}

async function runGlitchViewerAutotest() {
  await joinTestRoom('Amigo');
  const broadcaster = await waitFor(() => [...appState.participantsById.values()].find((participant) => participant.sharing), 20000);
  if (!broadcaster) {
    logTestStep('FALHA: ninguém ao vivo');
    return;
  }
  startWatching(broadcaster.id);
  const watchedStream = appState.watchedStreamsByBroadcasterId.get(broadcaster.id);
  watchedStream.tile.video.muted = true;

  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 90;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  let screenshotsTaken = 0;
  let lastScreenshotTime = 0;

  for (let second = 0; second < GLITCH_VIEWER_SECONDS; second += 1) {
    const blackFractions = [];
    for (let sample = 0; sample < 1000 / GLITCH_SAMPLE_INTERVAL_MS; sample += 1) {
      await waitMilliseconds(GLITCH_SAMPLE_INTERVAL_MS);
      const video = watchedStream.tile.video;
      if (video.readyState < 2) continue;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blackFraction = measureBlackFraction(context.getImageData(0, 0, canvas.width, canvas.height).data);
      blackFractions.push(blackFraction);
      const canTakeScreenshot = screenshotsTaken < MAXIMUM_GLITCH_SCREENSHOTS && Date.now() - lastScreenshotTime > 3000;
      if (blackFraction > BLACK_FRACTION_WORTH_A_SCREENSHOT && canTakeScreenshot) {
        screenshotsTaken += 1;
        lastScreenshotTime = Date.now();
        await desktopApp.saveTestScreenshot(`preto-${screenshotsTaken}-${Date.now()}.png`);
      }
    }
    const inbound = await readInboundVideoCounters(watchedStream.viewer.peerConnection);
    logTestStep('amostra:', JSON.stringify({
      time: Date.now(),
      connectionState: watchedStream.viewer.connectionState,
      maxBlack: blackFractions.length ? Math.max(...blackFractions) : null,
      ...inbound,
    }));
  }
}

function measureBlackFraction(pixels) {
  let blackPixels = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index] < BLACK_CHANNEL_LIMIT && pixels[index + 1] < BLACK_CHANNEL_LIMIT && pixels[index + 2] < BLACK_CHANNEL_LIMIT) blackPixels += 1;
  }
  return blackPixels / (pixels.length / 4);
}

async function readInboundVideoCounters(peerConnection) {
  if (!peerConnection) return {};
  const report = await peerConnection.getStats();
  let counters = {};
  report.forEach((entry) => {
    if (entry.type !== 'inbound-rtp' || entry.kind !== 'video') return;
    counters = {
      width: entry.frameWidth,
      height: entry.frameHeight,
      framesPerSecond: entry.framesPerSecond,
      packetsLost: entry.packetsLost,
      framesDropped: entry.framesDropped,
      freezeCount: entry.freezeCount,
      pliSent: entry.pliCount,
      nackSent: entry.nackCount,
      keyFramesDecoded: entry.keyFramesDecoded,
      framesDecoded: entry.framesDecoded,
      decoder: entry.decoderImplementation,
    };
  });
  return counters;
}

async function runExtraViewerAutotest() {
  await joinTestRoom('Segundo');
  const broadcaster = await waitFor(() => [...appState.participantsById.values()].find((participant) => participant.sharing), 10000);
  if (!broadcaster) return;
  startWatching(broadcaster.id);
  appState.watchedStreamsByBroadcasterId.get(broadcaster.id).tile.video.muted = true;
  await waitMilliseconds(EXTRA_VIEWER_SECONDS * 1000);
}
