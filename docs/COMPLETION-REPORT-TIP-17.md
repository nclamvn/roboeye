# COMPLETION REPORT · TIP-17

**STATUS:** DONE — engineering scope; not safety-certified.

## Delivered

- Replaced the ineffective MobileViT inference path with pinned SE-ResNet TFLite in an off-main-thread classic worker.
- Added byte/SHA-256 verification for model and 345-label file and self-hosted TFLite WASM/JS runtime.
- Reproduced official 28×28 raster geometry, polarity and stroke width.
- Added 345/345 Vietnamese labels, five scored suggestions, confidence/margin messaging and explicit confirmation before TTS.
- Added real official-data quality benchmark and CI/release gates.
- Extended `build:offline` with verified Hand Landmarker, QuickDraw TFLite and labels for no-WAN cold start.

## Acceptance results

- Vector pipeline: 85% top-1, 100% top-3; gates 75%/90% PASS.
- Official bitmap sanity: 90% top-1, 95% top-3.
- Vietnamese label coverage: 345/345 PASS.
- Unit/typecheck/build: PASS at implementation checkpoint.
- Offline build verification: PASS; hand/classifier READY with zero external browser requests.

## Deviations and decisions

- MediaPipe ImageClassifier was rejected because it only accepts 3/4-channel image models and the chosen model is grayscale `[1,28,28,1]`.
- TFLite runs through TensorFlow.js classic-worker runtime because its WASM loader uses `importScripts`.
- The model card polarity prose was not trusted after conflict; official bitmap A/B established the working contract.

## Remaining product validation

- Collect consented air-drawing samples from target Vietnamese users, across camera distances/light/hand styles.
- Define class-specific false-decision limits and an emergency controlled vocabulary before any rescue pilot.
- Require a second communication channel and field/human-factors review for life-safety use.
