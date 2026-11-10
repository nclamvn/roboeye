export const HAND_TRACKING_CONFIG = {
  handModel: {
    url: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
    version: 'float16/1',
    bytes: 7_819_105,
    sha256: 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1',
    etag: '15318430ea3851670fe9914116a9cfad'
  },
  tracking: {
    // 30 fps is the highest sustainable target for the pinned CPU hand model;
    // latest-frame-wins prevents any queue buildup.
    maxFps: 30,
    captureWidth: 480,
    // A delegate that initializes successfully can still be software-rendered
    // and much slower than CPU. Probe two live frames, then auto-fallback.
    gpuFallbackInferMs: 120,
    gpuFallbackSlowSamples: 2
  }
} as const;
