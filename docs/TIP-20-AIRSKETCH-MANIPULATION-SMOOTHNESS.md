# TIP-20 — AirSketch manipulation smoothness

## Evidence and root causes

Live use showed unstable pickup, jumpy movement and scale flicker. The interaction path had three independent sources of instability:

1. Pinch was a single threshold with no hysteresis, so noisy landmarks could alternate between grab and release.
2. Raw landmark position and raw palm span were applied directly to drawing/object coordinates and scale.
3. Hit testing required near-perfect placement on small strokes.

## Requirements

- `REQ-20-01`: pinch engages at `pinchDownRatio` and does not release until `pinchUpRatio`.
- `REQ-20-02`: cursor and palm span use adaptive filtering: steady jitter is damped, deliberate fast motion remains responsive.
- `REQ-20-03`: small completed strokes have a bounded pickup halo.
- `REQ-20-04`: double-flick arming, pointer fallback, classifier and scene contract remain unchanged.

## Acceptance criteria

- A 0.45 palm-relative pinch remains down after engaging at 0.38, and releases above 0.52.
- A 0.01 normalized cursor jitter is damped below 0.006, while a 0.24 fast movement advances by more than 0.12 in one sample.
- A small object is selectable 0.035 normalized units from its center, but not at 0.095.
- Unit, browser AirSketch E2E, build and full QA pass.
