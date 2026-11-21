const { app, ipcMain, shell } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;

let latestUpdateStatus = { state: 'none' };

function isPortableBuild() {
  return Boolean(process.env.PORTABLE_EXECUTABLE_DIR);
}

function releasesPageUrl() {
  const { homepage } = require(path.join(app.getAppPath(), 'package.json'));
  return `${homepage}/releases/latest`;
}

function registerAppUpdateHandlers({ getMainWindow, testFeedUrl, shouldCheckForUpdates }) {
  const publishStatus = (status) => {
    latestUpdateStatus = status;
    const mainWindow = getMainWindow();
    if (mainWindow) mainWindow.webContents.send('update-status', status);
  };

  ipcMain.handle('get-update-status', () => latestUpdateStatus);
  ipcMain.handle('install-update', () => autoUpdater.quitAndInstall(true, true));
  ipcMain.handle('open-releases-page', () => shell.openExternal(releasesPageUrl()));

  if (!shouldCheckForUpdates) return;
  if (testFeedUrl) {
    autoUpdater.forceDevUpdateConfig = true;
    autoUpdater.setFeedURL({ provider: 'generic', url: testFeedUrl });
  } else if (!app.isPackaged) {
    return;
  }

  let availableVersion = null;
  autoUpdater.autoDownload = !isPortableBuild();
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.disableWebInstaller = true;
  autoUpdater.logger = { info: () => {}, warn: (message) => console.warn('[atualização]', message), error: (message) => console.warn('[atualização]', message), debug: () => {} };

  autoUpdater.on('update-available', (info) => {
    availableVersion = info.version;
    publishStatus(isPortableBuild()
      ? { state: 'available-for-manual-download', version: info.version }
      : { state: 'downloading', version: info.version, percent: 0 });
  });
  autoUpdater.on('download-progress', (progress) => {
    publishStatus({ state: 'downloading', version: availableVersion, percent: Math.round(progress.percent) });
  });
  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[atualização] versão ${info.version} baixada e conferida`);
    publishStatus({ state: 'ready-to-install', version: info.version });
  });
  autoUpdater.on('update-not-available', () => console.log('[atualização] já está na versão mais nova'));
  autoUpdater.on('error', (error) => console.warn('[atualização] falhou:', error.message));

  const checkForUpdates = () => autoUpdater.checkForUpdates().catch((error) => console.warn('[atualização] não deu pra conferir:', error.message));
  checkForUpdates();
  setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL_MS);
}

module.exports = { registerAppUpdateHandlers };
