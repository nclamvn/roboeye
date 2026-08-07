export const AIRSKETCH_CONFIG = {
  handModel: {
    url: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
    version: 'float16/1',
    bytes: 7_819_105,
    sha256: 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1',
    etag: '15318430ea3851670fe9914116a9cfad'
  },
  classifier: {
    model: 'zarqankhn/quickdraw-345-tflite',
    revision: 'f978d83cfc41fa3c76435a4c96417e055220c735',
    url: 'https://huggingface.co/zarqankhn/quickdraw-345-tflite/resolve/f978d83cfc41fa3c76435a4c96417e055220c735/quickdraw_model.tflite',
    bytes: 8_851_924,
    sha256: '22bb3d3c131aeeee551a1880930910e2ebff8efad8d5cd0c942c97c2dee0993c',
    labelsUrl: 'https://huggingface.co/zarqankhn/quickdraw-345-tflite/resolve/f978d83cfc41fa3c76435a4c96417e055220c735/labels.txt',
    labelsBytes: 2_791,
    labelsSha256: '2ed0dac4ba018854a3e3166f9862e5529bc5f58a80d157d57eee22ca731895d5',
    topK: 5
  },
  tracking: {
    maxFps: 24,
    captureWidth: 480,
    pinchDownRatio: 0.38,
    pinchUpRatio: 0.52,
    calibrationFlickDistance: 0.075,
    calibrationFlickMaxMs: 220,
    calibrationFlickDebounceMs: 90,
    doubleFlickGapMs: 900,
    // Adaptive low-pass filters remove landmark jitter while preserving quick
    // intentional motion for drawing and object manipulation.
    cursorMinAlpha: 0.24,
    cursorMaxAlpha: 0.82,
    cursorVelocityGain: 0.48,
    palmSpanMinAlpha: 0.28,
    palmSpanMaxAlpha: 0.76,
    palmSpanDeltaGain: 0.96,
    grabHitPadding: 0.045,
    objectMinScale: 0.45,
    objectMaxScale: 2.8,
    undoHoldMs: 650,
    clearHoldMs: 1_050
  },
  recognition: {
    idleMs: 650,
    rasterSize: 28,
    contentSize: 24,
    minPoints: 8
  }
} as const;
