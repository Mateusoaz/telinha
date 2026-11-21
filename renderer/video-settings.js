const MAX_FRAMES_PER_SECOND = 30;

const RESOLUTION_SIZES = {
  480: { width: 854, height: 480 },
  720: { width: 1280, height: 720 },
  1080: { width: 1920, height: 1080 },
  native: null,
};

const DEFAULT_BITRATE_MEGABITS_BY_RESOLUTION = { 480: 3, 720: 6, 1080: 10, native: 12 };

const DEFAULT_SHARE_SETTINGS = {
  resolution: '1080',
  framesPerSecond: 30,
  bitrateMegabits: 10,
  priority: 'motion',
  shareAudio: true,
  excludeDiscordAudio: true,
  codec: 'auto',
  uploadLimitMegabits: 30,
};

function limitFramesPerSecond(framesPerSecond) {
  return Math.max(1, Math.min(MAX_FRAMES_PER_SECOND, Number(framesPerSecond) || MAX_FRAMES_PER_SECOND));
}

function normalizeShareSettings(settings) {
  const normalized = { ...DEFAULT_SHARE_SETTINGS, ...settings };
  normalized.framesPerSecond = limitFramesPerSecond(normalized.framesPerSecond);
  return normalized;
}

function buildCaptureConstraints(settings) {
  const framesPerSecond = limitFramesPerSecond(settings.framesPerSecond);
  const constraints = { frameRate: { ideal: framesPerSecond, max: framesPerSecond } };
  const size = RESOLUTION_SIZES[settings.resolution];
  if (size) {
    constraints.width = { max: size.width };
    constraints.height = { max: size.height };
  }
  return constraints;
}
