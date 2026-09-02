# TIP-32 · AirDesk spatial hand gestures

## Outcome

AirDesk treats the hand as a continuous spatial controller for the image. A
single held gesture now drives translation, scale, rotation and face flip from
MediaPipe landmarks instead of requiring separate on-screen controls.

## Root causes removed

1. Translation was clamped to `±0.38/±0.34` and CSS multiplied that normalized
   value by the image's own dimensions. The result was a visibly tiny travel
   range. Translation is now stage-relative in pixels and bounded to `±1.2`
   stage widths/heights.
2. AirDesk tracked only the index pointer. It had no two-finger transform state,
   so image move, scale, rotate and flip were unrelated button/handle actions.
3. Thumb–index separation was initially overloaded as both zoom and release.
   That grammar cannot support pinch-to-zoom reliably. Separation is now only
   a scale axis while held; a confirmed open palm places the image.
4. Stable filtered landmarks were used directly for object motion. The gesture
   center now uses bounded source-frame-age prediction while scale, palm angle
   and palm-facing signals retain adaptive 1€ filtering.

## Gesture contract

| Phase | Recognition | Effect |
| --- | --- | --- |
| Aim | Index tip over image | No mutation |
| Pick up | Thumb + index close | Capture transform baseline |
| Hold | Thumb + index remain the control pair | Keep one transform transaction |
| Move | Change pair midpoint | Translate across the camera stage |
| Zoom | Change normalized thumb–index distance | Scale `0.25×–4.5×` |
| Rotate | Rotate wrist→middle-MCP axis | Continuous image rotation |
| Flip | Sustained palm-facing sign reversal | Toggle horizontal face |
| Place | Fully open palm for three samples | Commit and release |

The HUD exposes `TÂM`, `MỞ`, `GÓC` and relative `MẶT A/B`. A/B is deliberate:
absolute “palm/back” naming is not reliable without handedness and per-camera
mirror calibration, while a relative face transition is sufficient to drive a
natural flip.

## Quality gates

- Unit test covers one complete pick → move → zoom → rotate → flip → open-palm
  release transaction, including the rule that two-finger separation cannot
  release the image.
- Browser E2E injects deterministic MediaPipe-shaped frames through the actual
  hand worker boundary and asserts at least 38% stage travel, `>1.65×` scale,
  `>50°` rotation, face flip and confirmed release.
- Existing AirSketch draw, object grab, classifier and Vietnamese TTS browser
  contracts remain in the same suite.

## Physical acceptance run

Use even front lighting, keep the full hand inside the camera field of view and
start about 50–80 cm from the laptop. In AirDesk, aim at the image, close thumb
and index, then perform each axis separately before combining them. The HUD must
change to `BIẾN ĐỔI 2 NGÓN`; if it does not, the gesture was not acquired and no
image mutation should occur. This visible state is the ground truth for tuning
camera-specific ergonomics after release.
