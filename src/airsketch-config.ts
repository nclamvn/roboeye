export const AIRSKETCH_CONFIG = {
  handModel: {
    url: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
    version: 'float16/1',
    bytes: 7_819_105,
    sha256: 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1',
    etag: '15318430ea3851670fe9914116a9cfad'
  },
  classifier: {
    model: 'Xenova/quickdraw-mobilevit-small',
    revision: 'ceb1c5cc6d623c6cffac36dca08c1903ba879755',
    dtype: 'q8',
    topK: 3
  },
  tracking: {
    maxFps: 24,
    captureWidth: 480,
    pinchDownRatio: 0.38,
    pinchUpRatio: 0.52,
    undoHoldMs: 650,
    clearHoldMs: 1_050
  },
  recognition: {
    idleMs: 650,
    rasterSize: 224,
    contentSize: 184,
    minPoints: 8
  }
} as const;
