const { contextBridge, ipcRenderer } = require('electron');

function listenTo(channel, listener) {
  ipcRenderer.on(channel, (event, value) => listener(value));
}

contextBridge.exposeInMainWorld('desktopApp', {
  getLaunchOptions: () => ipcRenderer.invoke('get-launch-options'),
  getNetworkInfo: () => ipcRenderer.invoke('get-network-info'),
  copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),
  getAppPreferences: () => ipcRenderer.invoke('get-app-preferences'),
  setHardwareVideoDecoding: (enabled) => ipcRenderer.invoke('set-hardware-video-decoding', enabled),
  restartApp: () => ipcRenderer.invoke('restart-app'),
  getUpdateStatus: () => ipcRenderer.invoke('get-update-status'),
  onUpdateStatus: (listener) => listenTo('update-status', listener),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  openReleasesPage: () => ipcRenderer.invoke('open-releases-page'),

  checkFirewall: () => ipcRenderer.invoke('check-firewall'),
  allowThroughFirewall: () => ipcRenderer.invoke('allow-through-firewall'),

  startHostingRoom: (options) => ipcRenderer.invoke('start-hosting-room', options),
  stopHostingRoom: () => ipcRenderer.invoke('stop-hosting-room'),
  onRoomsFound: (listener) => listenTo('rooms-found', listener),

  listCaptureSources: () => ipcRenderer.invoke('list-capture-sources'),
  chooseCaptureSource: (sourceId, includeSystemAudio) => ipcRenderer.invoke('choose-capture-source', { sourceId, includeSystemAudio }),

  startAudioCapture: (mode, windowHandle, excludeDiscord) => ipcRenderer.invoke('start-audio-capture', { mode, windowHandle, excludeDiscord }),
  stopAudioCapture: () => ipcRenderer.invoke('stop-audio-capture'),
  onAudioSamples: (listener) => listenTo('audio-samples', listener),
  onAudioCaptureEnded: (listener) => listenTo('audio-capture-ended', listener),

  saveTestScreenshot: (fileName) => ipcRenderer.invoke('save-test-screenshot', fileName),
  openTestAnimation: () => ipcRenderer.invoke('open-test-animation'),
  showTestOccludingWindow: () => ipcRenderer.invoke('show-test-occluding-window'),
  hideTestOccludingWindow: () => ipcRenderer.invoke('hide-test-occluding-window'),
  quitTest: () => ipcRenderer.invoke('quit-test'),
});
