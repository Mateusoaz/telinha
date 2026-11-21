const { app, BrowserWindow } = require('electron');
const path = require('path');

const ANIMATION_WINDOW_TITLE = 'Animacao Teste';

app.whenReady().then(() => {
  const animationWindow = new BrowserWindow({
    x: 20,
    y: 20,
    width: 1600,
    height: 900,
    frame: false,
    title: ANIMATION_WINDOW_TITLE,
    webPreferences: { backgroundThrottling: false },
  });
  animationWindow.on('page-title-updated', (event) => event.preventDefault());
  animationWindow.loadFile(path.join(__dirname, 'animation.html'), { query: { kind: 'game' } });
});
