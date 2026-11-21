const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const AUDIO_CAPTURE_EXECUTABLE = path.join(__dirname, '..', 'resources', 'bin', 'audiocap.exe');
const SAMPLE_RATE = 48000;
const INAUDIBLE_TONE_HERTZ = 22000;
const TONE_AMPLITUDE = 2000;
const TONE_SECONDS = 30;
const CAPTURE_SECONDS = '2';
const PLAYER_STARTUP_MS = 1500;
const MINIMUM_TONE_STRENGTH = 30;
const DISCORD_PROCESS_NAMES = ['Discord.exe', 'DiscordPTB.exe', 'DiscordCanary.exe'];

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function writeInaudibleToneWave(filePath) {
  const frameCount = SAMPLE_RATE * TONE_SECONDS;
  const dataSize = frameCount * 4;
  const wave = Buffer.alloc(44 + dataSize);
  wave.write('RIFF', 0);
  wave.writeUInt32LE(36 + dataSize, 4);
  wave.write('WAVEfmt ', 8);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(2, 22);
  wave.writeUInt32LE(SAMPLE_RATE, 24);
  wave.writeUInt32LE(SAMPLE_RATE * 4, 28);
  wave.writeUInt16LE(4, 32);
  wave.writeUInt16LE(16, 34);
  wave.write('data', 36);
  wave.writeUInt32LE(dataSize, 40);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const sample = Math.round(TONE_AMPLITUDE * Math.sin((2 * Math.PI * INAUDIBLE_TONE_HERTZ * frame) / SAMPLE_RATE));
    wave.writeInt16LE(sample, 44 + frame * 4);
    wave.writeInt16LE(sample, 46 + frame * 4);
  }
  fs.writeFileSync(filePath, wave);
}

function startWavePlayer(filePath) {
  return spawn('powershell.exe', ['-NoProfile', '-Command', `(New-Object System.Media.SoundPlayer '${filePath}').PlaySync()`], { windowsHide: true });
}

function runAudioCapture(captureArguments) {
  return new Promise((resolve) => {
    const capture = spawn(AUDIO_CAPTURE_EXECUTABLE, [...captureArguments, '--seconds', CAPTURE_SECONDS], { windowsHide: true });
    const audioChunks = [];
    let statusText = '';
    capture.stdout.on('data', (chunk) => audioChunks.push(chunk));
    capture.stderr.on('data', (chunk) => { statusText += chunk; });
    capture.stdin.end();
    capture.on('exit', (exitCode) => resolve({ exitCode, audio: Buffer.concat(audioChunks), statusText }));
  });
}

function measureToneStrength(audio, frequencyHertz) {
  const frameCount = Math.floor(audio.length / 4);
  if (!frameCount) return 0;
  const coefficient = 2 * Math.cos((2 * Math.PI * frequencyHertz) / SAMPLE_RATE);
  let previous = 0;
  let beforePrevious = 0;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const current = audio.readInt16LE(frame * 4) + coefficient * previous - beforePrevious;
    beforePrevious = previous;
    previous = current;
  }
  const power = previous * previous + beforePrevious * beforePrevious - coefficient * previous * beforePrevious;
  return (2 * Math.sqrt(Math.max(0, power))) / frameCount;
}

function findAnyWindowHandle() {
  const output = execFileSync('powershell.exe', ['-NoProfile', '-Command',
    'Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1 | ForEach-Object { "$($_.MainWindowHandle) $($_.Id)" }']).toString().trim();
  const [windowHandle, processId] = output.split(' ');
  return { windowHandle, processId };
}

function excludeDiscordArguments() {
  return DISCORD_PROCESS_NAMES.flatMap((name) => ['--exclude-name', name]);
}

async function expectTone(description, captureArguments, shouldHearTone) {
  const result = await runAudioCapture(captureArguments);
  assert.strictEqual(result.exitCode, 0, result.statusText);
  assert.ok(result.statusText.includes('READY'), result.statusText);
  const strength = measureToneStrength(result.audio, INAUDIBLE_TONE_HERTZ);
  const heardTone = strength > MINIMUM_TONE_STRENGTH;
  assert.strictEqual(heardTone, shouldHearTone, `${description}: força do tom ${strength.toFixed(1)}\n${result.statusText}`);
  console.log(`ok  ${description} (força do tom ${strength.toFixed(0)}, ${(result.audio.length / (SAMPLE_RATE * 4)).toFixed(1)} s)`);
  return result;
}

async function runAllTests() {
  assert.ok(fs.existsSync(AUDIO_CAPTURE_EXECUTABLE), 'audiocap.exe não existe: rode npm run build:audio');
  const wavePath = path.join(os.tmpdir(), 'telinha-tom-inaudivel.wav');
  writeInaudibleToneWave(wavePath);
  const player = startWavePlayer(wavePath);
  await wait(PLAYER_STARTUP_MS);

  try {
    await expectTone('só um programa: ouve o player', ['include', String(player.pid)], true);
    await expectTone('tudo menos um programa: tira o player', ['exclude', String(player.pid)], false);
    const mixed = await expectTone('tudo menos o Discord: ouve o player', ['everything-except', ...excludeDiscordArguments()], true);
    assert.ok(!/capturando pid \d+ \((audiodg|audiocap|SteelSeriesSonar)/i.test(mixed.statusText), `um roteador de áudio entrou na mistura:
${mixed.statusText}`);
    console.log('ok  motor de áudio do Windows, o próprio captador e mixers virtuais ficam de fora');
    assert.ok(!/capturando pid \d+ \(Discord/i.test(mixed.statusText), `o Discord entrou na mistura:\n${mixed.statusText}`);
    const capturedPrograms = [...mixed.statusText.matchAll(/capturando pid \d+ \(([^)]+)\)/g)].map((match) => match[1]);
    console.log(`ok  o Discord ficou de fora da mistura (programas misturados: ${capturedPrograms.join(', ')})`);
    await expectTone('tudo menos o player (pelo nome): tira o player', ['everything-except', '--exclude-name', 'powershell.exe'], false);
  } finally {
    player.kill();
    await wait(300);
    fs.unlinkSync(wavePath);
  }

  const { windowHandle, processId } = findAnyWindowHandle();
  const byWindow = await runAudioCapture(['window', windowHandle]);
  assert.strictEqual(byWindow.exitCode, 0, byWindow.statusText);
  assert.ok(byWindow.statusText.includes(`-> pid ${processId}`), byWindow.statusText);
  console.log(`ok  janela ${windowHandle} encontra o programa certo (pid ${processId})`);

  const invalidWindow = await runAudioCapture(['window', '12345']);
  assert.notStrictEqual(invalidWindow.exitCode, 0);
  assert.ok(invalidWindow.statusText.includes('ERR janela nao encontrada'));
  console.log('ok  janela inválida dá erro claro');

  console.log('\nTUDO OK');
}

runAllTests().catch((error) => {
  console.error('FALHOU:', error.message);
  process.exit(1);
});
