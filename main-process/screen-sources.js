const { ipcMain, desktopCapturer, screen, session, BrowserWindow } = require('electron');

const THUMBNAIL_SIZE = { width: 384, height: 216 };

let chosenSourceId = null;
let includeSystemAudioLoopback = false;

function registerScreenSourceHandlers() {
  session.defaultSession.setDisplayMediaRequestHandler(provideChosenSource);

  ipcMain.handle('list-capture-sources', listCaptureSources);

  ipcMain.handle('choose-capture-source', (event, { sourceId, includeSystemAudio }) => {
    chosenSourceId = sourceId;
    includeSystemAudioLoopback = Boolean(includeSystemAudio);
    return true;
  });
}

async function provideChosenSource(request, respond) {
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } });
    const chosenSource = sources.find((source) => source.id === chosenSourceId);
    if (!chosenSource) {
      respond({});
      return;
    }
    respond(includeSystemAudioLoopback ? { video: chosenSource, audio: 'loopback' } : { video: chosenSource });
  } catch (error) {
    console.error('[captura]', error.message);
    respond({});
  }
}

async function listCaptureSources() {
  const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: THUMBNAIL_SIZE, fetchWindowIcons: true });
  const ownWindowTitles = new Set(BrowserWindow.getAllWindows().map((window) => window.getTitle()));
  let monitorNumber = 0;

  return sources
    .filter((source) => !ownWindowTitles.has(source.name))
    .map((source) => {
      const isScreen = source.id.startsWith('screen:');
      if (isScreen) monitorNumber += 1;
      return {
        id: source.id,
        kind: isScreen ? 'screen' : 'window',
        name: isScreen ? `Monitor ${monitorNumber}` : source.name,
        detail: isScreen ? describeDisplay(source.display_id) : '',
        windowHandle: isScreen ? null : source.id.split(':')[1],
        thumbnailDataUrl: imageToDataUrl(source.thumbnail),
        iconDataUrl: imageToDataUrl(source.appIcon),
      };
    });
}

function describeDisplay(displayId) {
  const display = screen.getAllDisplays().find((candidate) => String(candidate.id) === String(displayId));
  if (!display) return '';
  const width = Math.round(display.size.width * display.scaleFactor);
  const height = Math.round(display.size.height * display.scaleFactor);
  const isPrimary = display.id === screen.getPrimaryDisplay().id;
  return `${width}×${height}${isPrimary ? ' · principal' : ''}`;
}

function imageToDataUrl(image) {
  return image && !image.isEmpty() ? image.toDataURL() : null;
}

module.exports = { registerScreenSourceHandlers };
