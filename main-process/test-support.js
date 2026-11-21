const { app, ipcMain, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const SCREENSHOT_ATTEMPTS = 5;
const SCREENSHOT_RETRY_DELAY_MS = 500;
const TEST_ANIMATION_BOUNDS = { x: 20, y: 20, width: 1600, height: 900 };
const TEST_OCCLUDING_WINDOW_BOUNDS = { x: 300, y: 250, width: 700, height: 400 };

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function registerTestSupportHandlers({ getMainWindow, testOutputFolder, animationKind }) {
  let animationWindow = null;

  ipcMain.handle('save-test-screenshot', async (event, fileName) => {
    const mainWindow = getMainWindow();
    if (!mainWindow) return null;
    for (let attempt = 0; attempt < SCREENSHOT_ATTEMPTS; attempt += 1) {
      try {
        const image = await mainWindow.webContents.capturePage();
        const outputPath = path.join(testOutputFolder, path.basename(String(fileName)));
        fs.writeFileSync(outputPath, image.toPNG());
        return outputPath;
      } catch {
        await wait(SCREENSHOT_RETRY_DELAY_MS);
      }
    }
    return null;
  });

  ipcMain.handle('open-test-animation', () => {
    animationWindow = new BrowserWindow({ ...TEST_ANIMATION_BOUNDS, frame: false, alwaysOnTop: true, webPreferences: { backgroundThrottling: false } });
    animationWindow.loadFile(path.join(__dirname, '..', 'test', 'animation.html'), { query: { kind: animationKind || 'game' } });
    return true;
  });

  let occludingWindow = null;

  ipcMain.handle('show-test-occluding-window', () => {
    occludingWindow = new BrowserWindow({ ...TEST_OCCLUDING_WINDOW_BOUNDS, frame: false, alwaysOnTop: true, backgroundColor: '#808080', focusable: false });
    occludingWindow.loadURL('about:blank');
    return true;
  });

  ipcMain.handle('hide-test-occluding-window', () => {
    if (occludingWindow && !occludingWindow.isDestroyed()) occludingWindow.destroy();
    occludingWindow = null;
    return true;
  });

  ipcMain.handle('quit-test', () => {
    if (animationWindow && !animationWindow.isDestroyed()) animationWindow.destroy();
    if (occludingWindow && !occludingWindow.isDestroyed()) occludingWindow.destroy();
    setTimeout(() => app.quit(), 200);
    return true;
  });
}

module.exports = { registerTestSupportHandlers };
