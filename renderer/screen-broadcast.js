const STATS_INTERVAL_MS = 1000;

function createRandomBroadcastId() {
  return Math.random().toString(36).slice(2, 10);
}

class ScreenBroadcast {
  constructor({ roomConnection, stream, settings, sourceLabel, sourceKind, captureVideoTrack, onSourceEnded, onChange, onStats }) {
    this.roomConnection = roomConnection;
    this.stream = stream;
    this.settings = normalizeShareSettings(settings);
    this.sourceLabel = sourceLabel;
    this.sourceKind = sourceKind;
    this.captureVideoTrack = captureVideoTrack;
    this.onSourceEnded = onSourceEnded;
    this.onChange = onChange;
    this.onStats = onStats;
    this.broadcastId = createRandomBroadcastId();
    this.connectionsByViewerId = new Map();
    this.latestStats = { viewerCount: 0, kilobitsPerSecond: 0, video: null, captureFramesPerSecond: null, captureAudioLevel: null };
    this.isStopped = false;
    this.statsTimer = setInterval(() => this.collectStats(), STATS_INTERVAL_MS);
    this.watchForSourceEnd(this.videoTrack);
  }

  watchForSourceEnd(track) {
    track.addEventListener('ended', () => {
      if (!this.isStopped && track === this.videoTrack && this.onSourceEnded) this.onSourceEnded();
    });
  }

  get videoTrack() {
    return this.stream.getVideoTracks()[0];
  }

  get audioTrack() {
    return this.stream.getAudioTracks()[0];
  }

  describeForRoom() {
    const trackSettings = this.videoTrack ? this.videoTrack.getSettings() : {};
    return {
      broadcastId: this.broadcastId,
      sourceLabel: this.sourceLabel,
      sourceKind: this.sourceKind,
      resolution: this.settings.resolution,
      framesPerSecond: this.settings.framesPerSecond,
      bitrateMegabits: this.settings.bitrateMegabits,
      priority: this.settings.priority,
      hasAudio: Boolean(this.audioTrack),
      width: trackSettings.width || null,
      height: trackSettings.height || null,
      viewerIds: [...this.connectionsByViewerId.keys()],
    };
  }

  bitratePerViewer() {
    const viewerCount = Math.max(1, this.connectionsByViewerId.size);
    let bitrate = this.settings.bitrateMegabits * 1e6;
    if (this.settings.uploadLimitMegabits > 0) bitrate = Math.min(bitrate, (this.settings.uploadLimitMegabits * 1e6) / viewerCount);
    return Math.max(MINIMUM_VIDEO_BITRATE_BITS, Math.round(bitrate));
  }

  sendToViewer(viewerId, payload) {
    this.roomConnection.sendSignal(viewerId, { direction: 'to-viewer', broadcastId: this.broadcastId, ...payload });
  }

  async handleSignalFromViewer(viewerId, payload) {
    if (payload.kind === 'watch-request') {
      await this.addViewer(viewerId);
      return;
    }
    if (payload.kind === 'stop-watching') {
      this.removeViewer(viewerId, { notifyViewer: false });
      return;
    }
    const connection = this.connectionsByViewerId.get(viewerId);
    if (!connection || payload.broadcastId !== this.broadcastId) return;
    if (payload.kind === 'answer') await this.acceptAnswer(connection, payload.sdp);
    if (payload.kind === 'ice-candidate') await this.addIceCandidate(connection, payload.candidate);
  }

  async addViewer(viewerId) {
    if (this.isStopped) return;
    if (this.connectionsByViewerId.has(viewerId)) this.removeViewer(viewerId, { notifyViewer: false });

    const peerConnection = new RTCPeerConnection(PEER_CONNECTION_CONFIG);
    const connection = { peerConnection, pendingIceCandidates: [], videoSender: null, audioSender: null, previousBytesSent: 0, previousStatsTime: 0 };
    this.connectionsByViewerId.set(viewerId, connection);

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) this.sendToViewer(viewerId, { kind: 'ice-candidate', candidate: event.candidate.toJSON() });
    };
    peerConnection.onconnectionstatechange = () => {
      console.log(`[transmissão] espectador ${viewerId}: ${peerConnection.connectionState}`);
      if (peerConnection.connectionState === 'failed') this.removeViewer(viewerId);
    };

    connection.videoSender = this.addVideoTrack(peerConnection);
    connection.audioSender = this.addAudioChannel(peerConnection);

    const offer = await peerConnection.createOffer();
    offer.sdp = enableStereoOpus(offer.sdp);
    await peerConnection.setLocalDescription(offer);
    this.sendToViewer(viewerId, { kind: 'offer', sdp: peerConnection.localDescription.sdp });
    this.applyEncodingLimits();
    this.notifyChange();
  }

  addVideoTrack(peerConnection) {
    const transceiver = peerConnection.addTransceiver(this.videoTrack, {
      direction: 'sendonly',
      streams: [this.stream],
      sendEncodings: [{ maxBitrate: this.bitratePerViewer(), maxFramerate: this.settings.framesPerSecond, priority: 'high', networkPriority: 'high' }],
    });
    const codecOrder = orderCodecsByPreference(this.settings.codec);
    if (codecOrder && transceiver.setCodecPreferences) {
      try {
        transceiver.setCodecPreferences(codecOrder);
      } catch (error) {
        console.warn('[transmissão] preferência de codec recusada:', error.message);
      }
    }
    return transceiver.sender;
  }

  addAudioChannel(peerConnection) {
    const transceiver = peerConnection.addTransceiver('audio', {
      direction: 'sendonly',
      streams: [this.stream],
      sendEncodings: [{ maxBitrate: AUDIO_BITRATE_BITS, priority: 'high' }],
    });
    if (this.audioTrack) transceiver.sender.replaceTrack(this.audioTrack);
    return transceiver.sender;
  }

  async acceptAnswer(connection, answerSdp) {
    const startKilobits = Math.round((this.bitratePerViewer() / 1000) * START_BITRATE_FRACTION);
    const tunedSdp = enableStereoOpus(setVideoBitrateHints(answerSdp, startKilobits));
    await connection.peerConnection.setRemoteDescription({ type: 'answer', sdp: tunedSdp });
    for (const candidate of connection.pendingIceCandidates.splice(0)) {
      await connection.peerConnection.addIceCandidate(candidate).catch(() => {});
    }
    this.applyEncodingLimits();
  }

  async addIceCandidate(connection, candidate) {
    if (connection.peerConnection.remoteDescription) await connection.peerConnection.addIceCandidate(candidate).catch(() => {});
    else connection.pendingIceCandidates.push(candidate);
  }

  removeViewer(viewerId, { notifyViewer = true } = {}) {
    const connection = this.connectionsByViewerId.get(viewerId);
    if (!connection) return;
    this.connectionsByViewerId.delete(viewerId);
    connection.peerConnection.close();
    if (notifyViewer) this.sendToViewer(viewerId, { kind: 'broadcast-ended' });
    this.applyEncodingLimits();
    this.notifyChange();
  }

  applyEncodingLimits() {
    const bitrate = this.bitratePerViewer();
    const degradationPreference = this.settings.priority === 'motion' ? 'maintain-framerate' : 'maintain-resolution';
    for (const connection of this.connectionsByViewerId.values()) {
      updateSenderParameters(connection.videoSender, (parameters) => {
        parameters.encodings[0].maxBitrate = bitrate;
        parameters.encodings[0].maxFramerate = this.settings.framesPerSecond;
        parameters.degradationPreference = degradationPreference;
      });
    }
  }

  async updateSettings(changedSettings) {
    const previousSettings = this.settings;
    const nextSettings = normalizeShareSettings({ ...previousSettings, ...changedSettings });
    const captureNeedsRestart = nextSettings.resolution !== previousSettings.resolution
      || nextSettings.framesPerSecond !== previousSettings.framesPerSecond;
    this.settings = nextSettings;

    let captureWasUpdated = true;
    if (captureNeedsRestart) {
      try {
        await this.replaceVideoTrack(await this.captureVideoTrack(nextSettings));
      } catch (error) {
        console.warn('[transmissão] não deu pra recapturar com a nova resolução:', error.message);
        this.settings = { ...nextSettings, resolution: previousSettings.resolution, framesPerSecond: previousSettings.framesPerSecond };
        captureWasUpdated = false;
      }
    }
    if (this.videoTrack) this.videoTrack.contentHint = this.settings.priority;
    this.applyEncodingLimits();
    this.notifyChange();
    return captureWasUpdated;
  }

  async switchSource({ sourceLabel, sourceKind, captureVideoTrack, settings }) {
    const nextSettings = normalizeShareSettings({ ...this.settings, ...settings });
    const newVideoTrack = await captureVideoTrack(nextSettings);
    this.settings = nextSettings;
    this.captureVideoTrack = captureVideoTrack;
    this.sourceLabel = sourceLabel;
    this.sourceKind = sourceKind;
    await this.replaceVideoTrack(newVideoTrack);
    this.applyEncodingLimits();
    this.notifyChange();
  }

  async replaceAudioTrack(newAudioTrack) {
    const oldAudioTrack = this.audioTrack;
    this.stream = new MediaStream([this.videoTrack, ...(newAudioTrack ? [newAudioTrack] : [])]);
    for (const connection of this.connectionsByViewerId.values()) {
      await connection.audioSender.replaceTrack(newAudioTrack || null);
    }
    if (oldAudioTrack && oldAudioTrack !== newAudioTrack) oldAudioTrack.stop();
    this.notifyChange();
  }

  async replaceVideoTrack(newVideoTrack) {
    newVideoTrack.contentHint = this.settings.priority;
    const oldVideoTrack = this.videoTrack;
    this.stream = new MediaStream([newVideoTrack, ...this.stream.getAudioTracks()]);
    this.watchForSourceEnd(newVideoTrack);
    for (const connection of this.connectionsByViewerId.values()) {
      await connection.videoSender.replaceTrack(newVideoTrack);
    }
    if (oldVideoTrack) oldVideoTrack.stop();
  }

  notifyChange() {
    if (!this.isStopped && this.onChange) this.onChange(this);
  }

  async collectStats() {
    const now = performance.now();
    let totalKilobitsPerSecond = 0;
    let video = null;
    let captureFramesPerSecond = null;
    let captureAudioLevel = null;

    for (const connection of this.connectionsByViewerId.values()) {
      let bytesSent = 0;
      const report = await connection.peerConnection.getStats().catch(() => null);
      if (!report) continue;
      report.forEach((entry) => {
        if (entry.type === 'media-source' && entry.kind === 'video') captureFramesPerSecond = entry.framesPerSecond;
        if (entry.type === 'media-source' && entry.kind === 'audio') captureAudioLevel = entry.audioLevel;
        if (entry.type !== 'outbound-rtp') return;
        bytesSent += entry.bytesSent || 0;
        if (entry.kind === 'video' && !video) video = describeOutboundVideo(entry, report);
      });
      if (connection.previousStatsTime) {
        totalKilobitsPerSecond += ((bytesSent - connection.previousBytesSent) * 8) / (now - connection.previousStatsTime);
      }
      connection.previousBytesSent = bytesSent;
      connection.previousStatsTime = now;
    }

    this.latestStats = {
      viewerCount: this.connectionsByViewerId.size,
      kilobitsPerSecond: Math.max(0, totalKilobitsPerSecond),
      video,
      captureFramesPerSecond,
      captureAudioLevel,
    };
    if (this.onStats) this.onStats(this.latestStats);
  }

  stop() {
    if (this.isStopped) return;
    this.isStopped = true;
    clearInterval(this.statsTimer);
    for (const [viewerId, connection] of this.connectionsByViewerId) {
      this.sendToViewer(viewerId, { kind: 'broadcast-ended' });
      connection.peerConnection.close();
    }
    this.connectionsByViewerId.clear();
    for (const track of this.stream.getTracks()) track.stop();
    capturedAudio.stop();
  }
}

function describeOutboundVideo(entry, report) {
  const codec = entry.codecId && report.get(entry.codecId);
  return {
    width: entry.frameWidth,
    height: entry.frameHeight,
    framesPerSecond: entry.framesPerSecond,
    limitationReason: entry.qualityLimitationReason,
    encoderName: entry.encoderImplementation,
    usesHardwareEncoder: entry.powerEfficientEncoder,
    codecName: codec ? readableCodecName(codec.mimeType) : '',
  };
}

async function updateSenderParameters(sender, changeParameters) {
  if (!sender) return;
  const parameters = sender.getParameters();
  if (!parameters.encodings || !parameters.encodings.length) return;
  changeParameters(parameters);
  try {
    await sender.setParameters(parameters);
  } catch {
    delete parameters.degradationPreference;
    await sender.setParameters(parameters).catch((error) => console.warn('[transmissão] setParameters:', error.message));
  }
}
