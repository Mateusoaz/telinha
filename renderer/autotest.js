const HOST_TEST_SECONDS = 36;
const SECOND_WHEN_HOST_CHANGES_QUALITY = 24;
const VIEWER_TEST_SECONDS = 26;
const TEST_ROOM_PORT = 47850;
const TEST_ROOM_NAME = 'Sala Teste';

function logTestStep(...values) {
  console.log('[autotest]', ...values);
}

async function runAutotest(mode) {
  try {
    if (mode === 'host') await runHostAutotest();
    if (mode === 'viewer') await runViewerAutotest();
    if (mode === 'picker') await runPickerAutotest();
    if (mode === 'update') await runUpdateAutotest();
    if (mode === 'glitch-host') await runGlitchHostAutotest();
    if (mode === 'glitch-viewer') await runGlitchViewerAutotest();
    if (mode === 'extra-viewer') await runExtraViewerAutotest();
  } catch (error) {
    logTestStep('ERRO', (error && error.stack) || error);
  } finally {
    await waitMilliseconds(300);
    desktopApp.quitTest();
  }
}

async function createTestRoom() {
  findElement('#my-name-input').value = 'Host';
  findElement('#new-room-name-input').value = TEST_ROOM_NAME;
  findElement('#new-room-port-input').value = TEST_ROOM_PORT;
  await createRoom();
  if (!appState.roomConnection) throw new Error('não deu pra criar a sala de teste');
  logTestStep('sala de teste criada na porta', TEST_ROOM_PORT);
}

async function joinTestRoom(myName) {
  findElement('#my-name-input').value = myName;
  for (let attempt = 0; attempt < 20 && !appState.roomConnection; attempt += 1) {
    await joinRoom({ address: LOOPBACK_ADDRESS, port: TEST_ROOM_PORT, password: '', wantsToHost: false });
    if (!appState.roomConnection) await waitMilliseconds(500);
  }
  if (!appState.roomConnection) throw new Error('não deu pra entrar na sala de teste');
  if (appState.roomDetails.roomName !== TEST_ROOM_NAME) throw new Error('entrou numa sala que não é a de teste');
}

async function runHostAutotest() {
  await createTestRoom();

  await desktopApp.openTestAnimation();
  await waitMilliseconds(800);
  const sources = await desktopApp.listCaptureSources();
  const firstMonitor = sources.find((source) => source.kind === 'screen');
  await startBroadcast(firstMonitor, { ...DEFAULT_SHARE_SETTINGS, framesPerSecond: 60 });
  logTestStep('ao vivo:', JSON.stringify(appState.myBroadcast && appState.myBroadcast.describeForRoom()));

  for (let second = 0; second < HOST_TEST_SECONDS; second += 1) {
    await waitMilliseconds(1000);
    const broadcast = appState.myBroadcast;
    if (broadcast && broadcast.latestStats.viewerCount) logTestStep('envio:', JSON.stringify(broadcast.latestStats));
    if (second === SECOND_WHEN_HOST_CHANGES_QUALITY && broadcast) {
      logTestStep('>>> trocando ao vivo pra 720p 4 Mbps pedindo 60 fps (tem que ficar em 30)');
      await broadcast.updateSettings({ resolution: '720', framesPerSecond: 60, bitrateMegabits: 4 });
    }
  }
  await desktopApp.saveTestScreenshot('host.png');
}

async function runViewerAutotest() {
  await joinTestRoom('Amigo');
  logTestStep('salas descobertas:', JSON.stringify(appState.discoveredRooms));
  const broadcaster = await waitFor(() => [...appState.participantsById.values()].find((participant) => participant.sharing), 20000);
  if (!broadcaster) {
    logTestStep('FALHA: ninguém ao vivo');
    return;
  }
  logTestStep('assistindo:', broadcaster.name, JSON.stringify(broadcaster.sharing));
  startWatching(broadcaster.id);
  const watchedStream = appState.watchedStreamsByBroadcasterId.get(broadcaster.id);
  watchedStream.tile.video.muted = true;

  for (let second = 0; second < VIEWER_TEST_SECONDS; second += 1) {
    await waitMilliseconds(1000);
    const video = watchedStream.tile.video;
    logTestStep('recebendo:', watchedStream.viewer.connectionState, JSON.stringify(watchedStream.viewer.latestStats), 'video', `${video.videoWidth}x${video.videoHeight}`);
  }
  await desktopApp.saveTestScreenshot('viewer.png');
}

async function runPickerAutotest() {
  findElement('#my-name-input').value = 'Teste';
  await waitMilliseconds(2500);
  await desktopApp.saveTestScreenshot('lobby.png');
  await createTestRoom();
  await openShareDialog({ mode: 'start' });
  await waitMilliseconds(1500);
  await desktopApp.saveTestScreenshot('picker-telas.png');

  shareDialog.activeTab = 'window';
  shareDialog.selectedSource = shareDialog.sources.find((source) => source.kind === 'window');
  renderCaptureSources();
  await waitMilliseconds(800);
  await desktopApp.saveTestScreenshot('picker-janelas.png');
  const windows = shareDialog.sources.filter((source) => source.kind === 'window').map((source) => [source.name, source.windowHandle]);
  logTestStep('janelas:', JSON.stringify(windows));
}

async function runUpdateAutotest() {
  const readyStatus = await waitFor(async () => {
    const status = await desktopApp.getUpdateStatus();
    return status.state === 'ready-to-install' ? status : null;
  }, 90000);
  logTestStep('atualização:', JSON.stringify(readyStatus || await desktopApp.getUpdateStatus()));
  await waitMilliseconds(1500);
  await desktopApp.saveTestScreenshot('update-banner.png');
}

async function waitFor(findValue, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await findValue();
    if (value) return value;
    await waitMilliseconds(500);
  }
  return null;
}
