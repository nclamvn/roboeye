# Changelog

## 1.4.0 — 07/08/2026

### AirSketch interaction (T18)

- Added deliberate double-flick arming so ordinary hand movement cannot paint accidentally.
- Added index-only drawing, open-palm manipulation, pinch grab/release and bounded palm-depth scaling.
- Promoted completed strokes to independent 2.5D scene objects with hit-test, selection and placement feedback.
- Added state-machine/scene unit coverage and T18 QA/completion artifacts.

### AirSketch recognition quality

- Replaced the low-performing QuickDraw MobileViT path with a pinned 345-class SE-ResNet TFLite model running off-main-thread; model and labels are verified by byte length and SHA-256 before load.
- Matched the official QuickDraw 28×28 raster contract: centered content, black background, white antialiased strokes and the official-equivalent 1.47 px line width.
- Raised the measured 20-sample vector benchmark from 15%/25% to 85%/100% top-1/top-3 and made 75%/90% a CI/release gate.
- Expanded display from top-3 to top-5, localized all 345 classes to Vietnamese, and added confidence/margin handling so ambiguous results are never presented as certain.
- Removed unconfirmed top-1 speech fallback: users must explicitly select a suggestion before Vietnamese TTS can speak it.
- Added an on-device heart pictogram fallback because `heart` is not one of the pinned model's 345 classes; the shape is surfaced as `trái tim` only when the two-lobe/pointed-tip geometry gate passes.

### Safety and verification

- Added explicit notice that AirSketch is AAC, not a sign-language translator or a sole rescue/life-safety channel.
- Bundled verified hand-tracking, classifier and label artifacts into `build:offline`; both workers cold-started with all external requests blocked.
- Added full-label coverage and confidence unit tests, production-pipeline quality benchmark, updated mock E2E and real-model smoke.

## 1.3.0 — 06/08/2026

### AirSketch

- Added realtime index-finger tracking and pinch-to-draw air ink with held undo/clear gestures.
- Added a pinned QuickDraw MobileViT classifier with top-3 guesses after a short drawing pause.
- Added AAC phrase composition and Vietnamese browser TTS, with explicit non-sign-language scope.
- Added mouse/touch fallback and a reserved responsive sidecar so prediction text never covers camera graphics.

### Reliability and verification

- Self-hosted MediaPipe runtime, exact-pinned the package, and validates the remote hand model with SHA-256 before use.
- Added clean one-time classifier load retry and sequential WASM cold start.
- Added 4 unit tests, 10 AirSketch browser checks and a real hand/classifier model smoke with p50/p95 metrics.

## 1.2.1 — 06/08/2026

### Product

- Moved live A* route telemetry out of the BEV canvas and into the sidebar so it no longer covers the visualization.
- Vertically centered the object review panel on desktop while preserving the compact top-aligned mobile layout.
- Decoupled detection capture from depth inference: detection now keeps a dedicated 384 px source even when depth falls back to 140 px WASM.
- Raised the OWL-ViT confidence threshold to the pipeline-standard 0.10 to reduce low-confidence noise.

### Reliability

- Pinned RT-DETR and OWL-ViT to verified immutable model revisions.
- Kept stable q8 WASM as the production detection default, with WebGPU available only through the explicit experimental flag.
- Added a clean-worker WASM retry after model-load failure and deterministic worker teardown when detection is disabled.
- Added a release gate that downloads, initializes and runs one real inference through both production detection models.

### Verification

- Full local QA, detection contract E2E and release E2E pass.
- Real RT-DETR, OWL-ViT and depth WASM smoke gates pass before Pages deployment.
- Live Pages manifest and browser console are verified after deployment.

## 1.2.0 — 06/08/2026

### Product

- Added a first-run perception rail and guided 60-second RGB → Depth → Point Cloud → BEV tour.
- Added responsive mobile controls at 375 px without changing the desktop HIVE instrument layout.
- Added visible build version, online/offline status and user-triggered local diagnostics export.
- Added explicit depth load retry and inference-frame recovery.

### Production

- Added CSP, static-host security headers and restricted browser permissions.
- Added a generated versioned service worker with app-shell precache and same-origin runtime caching.
- Added CI, weekly/main real-depth smoke, GitHub Pages HTTPS deployment and tagged release archive workflows.
- Added verified `build:offline` packaging for the pinned depth q8 fixture; detection stays online-only.
- Raised the build requirement to Node 20.19+, matching Vite 7's supported runtime.

### Verification

- 15 unit tests.
- 13 detection contract browser checks.
- 20 release/product browser checks.
- 14 real-depth smoke checks.
