const { app, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const PREFERENCES_FILE_NAME = 'preferencias.json';
const DEFAULT_APP_PREFERENCES = { useHardwareVideoDecoding: true };

function preferencesFilePath() {
  return path.join(app.getPath('userData'), PREFERENCES_FILE_NAME);
}

function readAppPreferences() {
  try {
    return { ...DEFAULT_APP_PREFERENCES, ...JSON.parse(fs.readFileSync(preferencesFilePath(), 'utf8')) };
  } catch {
    return { ...DEFAULT_APP_PREFERENCES };
  }
}

function writeAppPreferences(preferences) {
  fs.mkdirSync(path.dirname(preferencesFilePath()), { recursive: true });
  fs.writeFileSync(preferencesFilePath(), JSON.stringify(preferences, null, 2));
}

function registerAppPreferencesHandlers() {
  ipcMain.handle('get-app-preferences', () => readAppPreferences());

  ipcMain.handle('set-hardware-video-decoding', (event, enabled) => {
    writeAppPreferences({ ...readAppPreferences(), useHardwareVideoDecoding: Boolean(enabled) });
    return true;
  });

  ipcMain.handle('restart-app', () => {
    app.relaunch();
    app.exit(0);
  });
}

module.exports = { readAppPreferences, registerAppPreferencesHandlers };
