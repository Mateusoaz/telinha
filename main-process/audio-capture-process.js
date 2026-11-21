const { app, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const BYTES_PER_AUDIO_FRAME = 4;
const STARTUP_TIMEOUT_MS = 6000;
const FORCE_KILL_DELAY_MS = 500;

let audioCaptureProcess = null;

function findAudioCaptureExecutable() {
  const packagedPath = path.join(process.resourcesPath || '', 'bin', 'audiocap.exe');
  if (app.isPackaged && fs.existsSync(packagedPath)) return packagedPath;
  return path.join(__dirname, '..', 'resources', 'bin', 'audiocap.exe');
}

function registerAudioCaptureHandlers() {
  ipcMain.handle('start-audio-capture', (event, options) => startAudioCaptureProcess(event.sender, options));
  ipcMain.handle('stop-audio-capture', () => {
    stopAudioCaptureProcess();
    return true;
  });
}

function stopAudioCaptureProcess() {
  if (!audioCaptureProcess) return;
  const processToStop = audioCaptureProcess;
  audioCaptureProcess = null;
  processToStop.stdin.end();
  setTimeout(() => {
    if (processToStop.exitCode === null) processToStop.kill();
  }, FORCE_KILL_DELAY_MS);
}

const DISCORD_PROCESS_NAMES = ['Discord.exe', 'DiscordPTB.exe', 'DiscordCanary.exe', 'DiscordDevelopment.exe', 'Vesktop.exe'];

function listCaptureAttempts({ mode, windowHandle, excludeDiscord }) {
  if (mode === 'window') return [['window', String(windowHandle)]];
  const excludedDiscordArguments = excludeDiscord ? DISCORD_PROCESS_NAMES.flatMap((name) => ['--exclude-name', name]) : [];
  return [
    ['everything-except', '--exclude-pid', String(process.pid), ...excludedDiscordArguments],
    ['exclude', String(process.pid)],
  ];
}

async function startAudioCaptureProcess(renderer, options) {
  stopAudioCaptureProcess();
  const executable = findAudioCaptureExecutable();
  if (!fs.existsSync(executable)) return { started: false, error: 'audiocap.exe não encontrado' };

  let lastResult = null;
  for (const captureArguments of listCaptureAttempts(options)) {
    lastResult = await spawnAudioCapture(executable, captureArguments, renderer);
    if (lastResult.started) return lastResult;
    console.warn('[audiocap] tentativa falhou:', captureArguments[0], lastResult.error);
  }
  return lastResult;
}

function spawnAudioCapture(executable, captureArguments, renderer) {
  return new Promise((resolve) => {
    const captureProcess = spawn(executable, captureArguments, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    audioCaptureProcess = captureProcess;

    let alreadyAnswered = false;
    const answer = (result) => {
      if (alreadyAnswered) return;
      alreadyAnswered = true;
      clearTimeout(startupTimeout);
      resolve(result);
    };
    const startupTimeout = setTimeout(() => answer({ started: false, error: 'o captador de áudio não respondeu' }), STARTUP_TIMEOUT_MS);

    forwardWholeAudioFrames(captureProcess.stdout, renderer);
    readStatusLines(captureProcess.stderr, (line) => {
      console.log('[audiocap]', line);
      if (line.startsWith('READY')) answer({ started: true, details: line });
      if (line.startsWith('ERR')) answer({ started: false, error: line.slice(4) });
    });

    captureProcess.on('error', (error) => answer({ started: false, error: error.message }));
    captureProcess.on('exit', (exitCode) => {
      answer({ started: false, error: `o captador de áudio fechou (código ${exitCode})` });
      if (audioCaptureProcess !== captureProcess) return;
      audioCaptureProcess = null;
      if (!renderer.isDestroyed()) renderer.send('audio-capture-ended', exitCode);
    });
  });
}

function forwardWholeAudioFrames(stream, renderer) {
  let leftoverBytes = Buffer.alloc(0);
  stream.on('data', (chunk) => {
    const bytes = leftoverBytes.length ? Buffer.concat([leftoverBytes, chunk]) : chunk;
    const wholeFrameByteCount = bytes.length - (bytes.length % BYTES_PER_AUDIO_FRAME);
    if (wholeFrameByteCount > 0 && !renderer.isDestroyed()) renderer.send('audio-samples', bytes.subarray(0, wholeFrameByteCount));
    leftoverBytes = bytes.subarray(wholeFrameByteCount);
  });
}

function readStatusLines(stream, onLine) {
  let pendingText = '';
  stream.on('data', (chunk) => {
    pendingText += chunk.toString();
    let lineEnd = pendingText.indexOf('\n');
    while (lineEnd >= 0) {
      const line = pendingText.slice(0, lineEnd).trim();
      pendingText = pendingText.slice(lineEnd + 1);
      if (line) onLine(line);
      lineEnd = pendingText.indexOf('\n');
    }
  });
}

module.exports = { registerAudioCaptureHandlers, stopAudioCaptureProcess };
