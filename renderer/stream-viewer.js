const WATCH_REQUEST_RETRY_MS = 12000;
const VIEWER_STATS_INTERVAL_MS = 1000;

class StreamViewer {
  constructor({ roomConnection, broadcasterId, onStream, onConnectionStateChange, onStats }) {
    this.roomConnection = roomConnection;
    this.broadcasterId = broadcasterId;
    this.onStream = onStream;
    this.onConnectionStateChange = onConnectionStateChange;
    this.onStats = onStats;
    this.peerConnection = null;
    this.broadcastId = null;
    this.pendingIceCandidates = [];
    this.previousStatsSample = null;
    this.latestStats = null;
    this.connectionState = 'connecting';
    this.isClosed = false;
    this.statsTimer = setInterval(() => this.collectStats(), VIEWER_STATS_INTERVAL_MS);
    this.requestStream();
  }

  sendToBroadcaster(payload) {
    this.roomConnection.sendSignal(this.broadcasterId, { direction: 'to-broadcaster', broadcastId: this.broadcastId, ...payload });
  }

  requestStream() {
    this.sendToBroadcaster({ kind: 'watch-request' });
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      if (!this.isClosed && this.connectionState !== 'connected') this.requestStream();
    }, WATCH_REQUEST_RETRY_MS);
  }

  changeConnectionState(newState) {
    this.connectionState = newState;
    if (this.onConnectionStateChange) this.onConnectionStateChange(newState);
  }

  async handleSignalFromBroadcaster(payload) {
    if (this.isClosed) return;
    if (payload.kind === 'offer') await this.acceptOffer(payload.broadcastId, payload.sdp);
    if (payload.kind === 'ice-candidate' && payload.broadcastId === this.broadcastId) await this.addIceCandidate(payload.candidate);
    if (payload.kind === 'broadcast-ended' && (!payload.broadcastId || payload.broadcastId === this.broadcastId)) {
      this.changeConnectionState('ended');
    }
  }

  async acceptOffer(broadcastId, offerSdp) {
    if (this.peerConnection) this.peerConnection.close();
    this.broadcastId = broadcastId;
    this.pendingIceCandidates = [];

    const peerConnection = new RTCPeerConnection(PEER_CONNECTION_CONFIG);
    this.peerConnection = peerConnection;
    const receivedStream = new MediaStream();

    peerConnection.ontrack = (event) => {
      receivedStream.addTrack(event.track);
      if (this.onStream) this.onStream(receivedStream);
    };
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) this.sendToBroadcaster({ kind: 'ice-candidate', candidate: event.candidate.toJSON() });
    };
    peerConnection.onconnectionstatechange = () => {
      if (peerConnection !== this.peerConnection) return;
      console.log(`[assistindo] ${this.broadcasterId}: ${peerConnection.connectionState}`);
      this.changeConnectionState(peerConnection.connectionState);
    };

    await peerConnection.setRemoteDescription({ type: 'offer', sdp: offerSdp });
    for (const candidate of this.pendingIceCandidates.splice(0)) await peerConnection.addIceCandidate(candidate).catch(() => {});
    const answer = await peerConnection.createAnswer();
    answer.sdp = enableStereoOpus(answer.sdp);
    await peerConnection.setLocalDescription(answer);
    this.sendToBroadcaster({ kind: 'answer', sdp: peerConnection.localDescription.sdp });
  }

  async addIceCandidate(candidate) {
    if (this.peerConnection && this.peerConnection.remoteDescription) await this.peerConnection.addIceCandidate(candidate).catch(() => {});
    else this.pendingIceCandidates.push(candidate);
  }

  async collectStats() {
    if (!this.peerConnection) return;
    const report = await this.peerConnection.getStats().catch(() => null);
    if (!report) return;
    const now = performance.now();
    let bytesReceived = 0;
    let video = null;
    let audioLevel = null;
    let roundTripSeconds = null;
    let route = '';

    report.forEach((entry) => {
      if (entry.type === 'inbound-rtp') {
        bytesReceived += entry.bytesReceived || 0;
        if (entry.kind === 'video') video = describeInboundVideo(entry, report);
        if (entry.kind === 'audio') audioLevel = entry.audioLevel;
      }
      if (entry.type === 'candidate-pair' && entry.nominated && entry.state === 'succeeded') {
        roundTripSeconds = entry.currentRoundTripTime;
        route = describeRoute(report.get(entry.localCandidateId), report.get(entry.remoteCandidateId));
      }
    });

    const kilobitsPerSecond = this.previousStatsSample
      ? ((bytesReceived - this.previousStatsSample.bytesReceived) * 8) / (now - this.previousStatsSample.time)
      : 0;
    this.previousStatsSample = { bytesReceived, time: now };
    this.latestStats = { video, kilobitsPerSecond: Math.max(0, kilobitsPerSecond), roundTripSeconds, route, audioLevel };
    if (this.onStats) this.onStats(this.latestStats);
  }

  close({ notifyBroadcaster = true } = {}) {
    if (this.isClosed) return;
    this.isClosed = true;
    clearInterval(this.statsTimer);
    clearTimeout(this.retryTimer);
    if (notifyBroadcaster) this.sendToBroadcaster({ kind: 'stop-watching' });
    if (this.peerConnection) this.peerConnection.close();
  }
}

function describeInboundVideo(entry, report) {
  const codec = entry.codecId && report.get(entry.codecId);
  return {
    width: entry.frameWidth,
    height: entry.frameHeight,
    framesPerSecond: entry.framesPerSecond,
    codecName: codec ? readableCodecName(codec.mimeType) : '',
    packetsLost: entry.packetsLost,
    framesDropped: entry.framesDropped,
    decoderName: entry.decoderImplementation,
    usesHardwareDecoder: entry.powerEfficientDecoder,
  };
}

function describeRoute(localCandidate, remoteCandidate) {
  if (!localCandidate || !remoteCandidate) return '';
  return `${localCandidate.candidateType}/${localCandidate.protocol} ${remoteCandidate.address || ''}`;
}
