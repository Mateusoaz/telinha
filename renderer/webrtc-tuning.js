const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
const PEER_CONNECTION_CONFIG = { iceServers: ICE_SERVERS, bundlePolicy: 'max-bundle' };
const AUDIO_BITRATE_BITS = 192000;
const SDP_MAX_VIDEO_KILOBITS = 25000;
const START_BITRATE_FRACTION = 0.8;
const MINIMUM_VIDEO_BITRATE_BITS = 300000;

const CODEC_MIME_TYPES = { auto: 'video/H264', h264: 'video/H264', vp8: 'video/VP8', vp9: 'video/VP9', av1: 'video/AV1' };
const H264_PROFILE_ORDER = { 6400: 0, '4d00': 1, '42e0': 2, 4200: 3 };

function replaceFormatParameters(sdp, payloadType, newParameters, replacedParameterPattern) {
  const formatLinePattern = new RegExp(`a=fmtp:${payloadType} (.*)`);
  if (formatLinePattern.test(sdp)) {
    return sdp.replace(formatLinePattern, (line, existingParameters) => {
      const keptParameters = existingParameters.split(';').map((parameter) => parameter.trim())
        .filter((parameter) => parameter && !replacedParameterPattern.test(parameter));
      return `a=fmtp:${payloadType} ${keptParameters.concat(newParameters).join(';')}`;
    });
  }
  const codecLinePattern = new RegExp(`(a=rtpmap:${payloadType} [^\\r\\n]+)`);
  return sdp.replace(codecLinePattern, `$1\r\na=fmtp:${payloadType} ${newParameters.join(';')}`);
}

function enableStereoOpus(sdp) {
  const opusLine = sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/i);
  if (!opusLine) return sdp;
  return replaceFormatParameters(
    sdp,
    opusLine[1],
    ['stereo=1', 'sprop-stereo=1', `maxaveragebitrate=${AUDIO_BITRATE_BITS}`, 'useinbandfec=1'],
    /^(stereo|sprop-stereo|maxaveragebitrate|useinbandfec)=/,
  );
}

function setVideoBitrateHints(sdp, startKilobits) {
  const videoPayloadTypes = [...sdp.matchAll(/a=rtpmap:(\d+) (H264|VP8|VP9|AV1)\/90000/gi)].map((match) => match[1]);
  return videoPayloadTypes.reduce((updatedSdp, payloadType) => replaceFormatParameters(
    updatedSdp,
    payloadType,
    [`x-google-start-bitrate=${startKilobits}`, `x-google-max-bitrate=${SDP_MAX_VIDEO_KILOBITS}`],
    /^x-google-(start|max|min)-bitrate=/,
  ), sdp);
}

function rankH264Variant(codec) {
  const formatLine = codec.sdpFmtpLine || '';
  const profile = ((formatLine.match(/profile-level-id=([0-9a-f]{4})/i) || [])[1] || '').toLowerCase();
  const packetizationPenalty = /packetization-mode=1/.test(formatLine) ? 0 : 10;
  return packetizationPenalty + (H264_PROFILE_ORDER[profile] ?? 4);
}

function orderCodecsByPreference(codecChoice) {
  const capabilities = RTCRtpSender.getCapabilities && RTCRtpSender.getCapabilities('video');
  if (!capabilities) return null;
  const preferredMimeType = CODEC_MIME_TYPES[codecChoice] || CODEC_MIME_TYPES.auto;
  const preferredCodecs = capabilities.codecs.filter((codec) => codec.mimeType === preferredMimeType);
  if (!preferredCodecs.length) return null;
  if (preferredMimeType === 'video/H264') preferredCodecs.sort((first, second) => rankH264Variant(first) - rankH264Variant(second));
  const otherCodecs = capabilities.codecs.filter((codec) => codec.mimeType !== preferredMimeType);
  return preferredCodecs.concat(otherCodecs);
}

function readableCodecName(mimeType) {
  return (mimeType || '').replace('video/', '').replace('audio/', '');
}
