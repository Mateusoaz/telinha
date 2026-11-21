const { app, BrowserWindow, ipcMain, session, clipboard, shell } = require('electron');
const path = require('path');
const os = require('os');
const { readCommandLineValue } = require('./shared/command-line');
const { registerRoomHostingHandlers, shutDownRoomHosting } = require('./main-process/room-hosting');
const { registerScreenSourceHandlers } = require('./main-process/screen-sources');
const { registerAudioCaptureHandlers, stopAudioCaptureProcess } = require('./main-process/audio-capture-process');
const { registerFirewallHandlers } = require('./main-process/firewall');
const { registerTestSupportHandlers } = require('./main-process/test-support');
const { readAppPreferences, registerAppPreferencesHandlers } = require('./main-process/app-preferences');
const { registerAppUpdateHandlers } = require('./main-process/app-updates');

const APP_ID = 'com.telinha.app';
const WINDOW_BACKGROUND_COLOR = '#1e1f22';

const profileName = readCommandLineValue('profile');
const autotestMode = readCommandLineValue('autotest');
const testOutputFolder = readCommandLineValue('testdir') || os.tmpdir();
const testAnimationKind = readCommandLineValue('motion');
const testUpdateFeedUrl = readCommandLineValue('update-feed');

let mainWindow = null;

function configureChromium(appPreferences) {
  app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns,CalculateNativeWinOcclusion');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
  if (!appPreferences.useHardwareVideoDecoding) app.commandLine.appendSwitch('disable-accelerated-video-decode');
}

function useSeparateDataFolderForProfile() {
  if (profileName) app.setPath('userData', path.join(app.getPath('appData'), `Telinha-${profileName}`));
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: WINDOW_BACKGROUND_COLOR,
    title: 'Telinha',
    icon: path.join(__dirname, 'renderer', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.webContents.on('console-message', (event) => {
    process.stdout.write(`[ui${profileName ? ':' + profileName : ''}] ${event.message}\n`);
  });
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') mainWindow.webContents.toggleDevTools();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function getMainWindow() {
  return mainWindow;
}

function registerAppInfoHandlers() {
  ipcMain.handle('get-launch-options', () => ({ profileName, autotestMode, appVersion: app.getVersion() }));
  ipcMain.handle('copy-to-clipboard', (event, text) => {
    clipboard.writeText(String(text));
    return true;
  });
}

useSeparateDataFolderForProfile();
configureChromium(readAppPreferences());

app.whenReady().then(() => {
  app.setAppUserModelId(APP_ID);
  session.defaultSession.setPermissionRequestHandler((webContents, permission, respond) => respond(true));
  registerAppInfoHandlers();
  registerAppPreferencesHandlers();
  registerAppUpdateHandlers({ getMainWindow, testFeedUrl: testUpdateFeedUrl, shouldCheckForUpdates: !autotestMode || Boolean(testUpdateFeedUrl) });
  registerRoomHostingHandlers({ getMainWindow, announceOnlyOnThisComputer: Boolean(autotestMode) });
  registerScreenSourceHandlers();
  registerAudioCaptureHandlers();
  registerFirewallHandlers();
  if (autotestMode) registerTestSupportHandlers({ getMainWindow, testOutputFolder, animationKind: testAnimationKind });
  createMainWindow();
});

app.on('window-all-closed', () => {
  stopAudioCaptureProcess();
  shutDownRoomHosting();
  app.quit();
});
