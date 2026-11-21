async function startApp() {
  appState.launchOptions = await desktopApp.getLaunchOptions();
  const { profileName, autotestMode, appVersion } = appState.launchOptions;
  document.title = profileName ? `Telinha (${profileName})` : 'Telinha';
  findElement('#app-version').textContent = `v${appVersion}`;

  findElement('#leave-room-button').addEventListener('click', leaveRoom);
  initializeShareDialog();
  await initializeLobby();
  initializeAppUpdates();

  if (autotestMode) runAutotest(autotestMode);
}

startApp();
