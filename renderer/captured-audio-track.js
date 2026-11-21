const AUDIO_SAMPLE_RATE = 48000;

const AUDIO_PLAYBACK_WORKLET_SOURCE = `
const SAMPLE_RATE = 48000;
const CHANNEL_COUNT = 2;
const BUFFER_SECONDS = 2;
const TARGET_LATENCY_SECONDS = 0.04;
const MAXIMUM_LATENCY_SECONDS = 0.15;

class CapturedAudioPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.capacity = SAMPLE_RATE * CHANNEL_COUNT * BUFFER_SECONDS;
    this.samples = new Float32Array(this.capacity);
    this.readPosition = 0;
    this.writePosition = 0;
    this.storedSampleCount = 0;
    this.isPlaying = false;
    this.targetSampleCount = Math.round(SAMPLE_RATE * TARGET_LATENCY_SECONDS) * CHANNEL_COUNT;
    this.maximumSampleCount = Math.round(SAMPLE_RATE * MAXIMUM_LATENCY_SECONDS) * CHANNEL_COUNT;
    this.port.onmessage = (event) => this.storeSamples(new Int16Array(event.data));
  }

  storeSamples(incomingSamples) {
    for (const sample of incomingSamples) {
      this.samples[this.writePosition] = sample / 32768;
      this.writePosition = (this.writePosition + 1) % this.capacity;
    }
    this.storedSampleCount += incomingSamples.length;
    if (this.storedSampleCount > this.capacity) {
      this.skipSamples(this.storedSampleCount - this.capacity);
    }
  }

  skipSamples(count) {
    this.readPosition = (this.readPosition + count) % this.capacity;
    this.storedSampleCount -= count;
  }

  process(inputs, outputs) {
    const left = outputs[0][0];
    const right = outputs[0][1] || left;
    const frameCount = left.length;

    if (this.storedSampleCount > this.maximumSampleCount) this.skipSamples(this.storedSampleCount - this.targetSampleCount);
    if (!this.isPlaying && this.storedSampleCount < this.targetSampleCount) return true;
    this.isPlaying = true;
    if (this.storedSampleCount < frameCount * CHANNEL_COUNT) {
      this.isPlaying = false;
      return true;
    }

    for (let frame = 0; frame < frameCount; frame += 1) {
      left[frame] = this.samples[this.readPosition];
      right[frame] = this.samples[(this.readPosition + 1) % this.capacity];
      this.readPosition = (this.readPosition + CHANNEL_COUNT) % this.capacity;
    }
    this.storedSampleCount -= frameCount * CHANNEL_COUNT;
    return true;
  }
}

registerProcessor('captured-audio-player', CapturedAudioPlayer);
`;

const capturedAudio = {
  audioContext: null,
  playerNode: null,
  isCapturing: false,
  isListeningForSamples: false,

  listenForSamplesOnce() {
    if (this.isListeningForSamples) return;
    this.isListeningForSamples = true;
    desktopApp.onAudioSamples((samples) => {
      if (!this.isCapturing || !this.playerNode) return;
      const ownCopy = samples.slice();
      this.playerNode.port.postMessage(ownCopy.buffer, [ownCopy.buffer]);
    });
    desktopApp.onAudioCaptureEnded((exitCode) => {
      if (this.isCapturing) console.warn('[audio] o captador de áudio fechou', exitCode);
    });
  },

  async createAudioContextOnce() {
    if (this.audioContext) return;
    this.audioContext = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE, latencyHint: 'interactive' });
    const workletUrl = URL.createObjectURL(new Blob([AUDIO_PLAYBACK_WORKLET_SOURCE], { type: 'application/javascript' }));
    await this.audioContext.audioWorklet.addModule(workletUrl);
  },

  async start(mode, windowHandle, { excludeDiscord = true } = {}) {
    this.stop();
    this.listenForSamplesOnce();
    const result = await desktopApp.startAudioCapture(mode, windowHandle, excludeDiscord);
    if (!result.started) throw new Error(result.error || 'falha no áudio');

    await this.createAudioContextOnce();
    await this.audioContext.resume();
    this.playerNode = new AudioWorkletNode(this.audioContext, 'captured-audio-player', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    const streamDestination = this.audioContext.createMediaStreamDestination();
    streamDestination.channelCount = 2;
    this.playerNode.connect(streamDestination);
    this.isCapturing = true;
    console.log('[audio] captura iniciada:', result.details);
    return streamDestination.stream.getAudioTracks()[0];
  },

  stop() {
    if (!this.isCapturing && !this.playerNode) return;
    this.isCapturing = false;
    desktopApp.stopAudioCapture();
    if (this.playerNode) this.playerNode.disconnect();
    this.playerNode = null;
  },
};
