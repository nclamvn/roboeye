# Changelog

## Unreleased

### AirSketch direct-manipulation recovery (TIP-28)

- Fixed the pen/object coordinate discontinuity: thumb-index pinch now keeps
  the index fingertip as its reference instead of jumping to the midpoint.
- Split responsive predicted ink/cursor coordinates from stable non-predicted
  object pickup/move coordinates, preventing a small object from being missed
  or overshot while the pen remains responsive.
- A deliberate open-palm workspace now accepts a natural two-finger pinch even
  while the other fingers remain extended; a short landmark loss no longer
  breaks an active stroke or releases an object.
- Added complete capture-to-main hand-pipeline p50/p95 telemetry and covered
  the natural open-pinch grab in deterministic unit and browser E2E tests.

### Real-time perception recovery (TIP-27)

- Detection now tries WebGPU by default and clearly retries on WASM only when
  the GPU path cannot initialize; the active backend, inference time and cadence
  are visible in the object status.
- RGB detection and AirSketch now take priority over depth-frame processing,
  eliminating a competing pixel-read/inference job during direct interaction.
- AirSketch hand samples preserve camera-frame timestamps, apply bounded latency
  prediction before smoothing, run at 30 fps latest-frame-wins, and retain denser
  curved ink samples.
- Replaced stale double-flick copy with the implemented thumb–index clutch,
  fist pen-up and open-palm manipulation grammar.

### Motion-aware detection tracking (TIP-26)

- Detection boxes now carry the source camera timestamp through the worker and
  are projected across inference latency before the overlay is corrected. This
  reduces the visible lag and jump of a moving object without drawing a stale
  box over a newer video frame.
- Matching uses both IoU and a speed-aware centre gate, retains a confirmed box
  through short detector misses, and preserves confidence-aware filtering for
  one-frame noise.
- Restored the T14 benchmark-locked thresholds (RT-DETR 0.45, OWL-ViT 0.08);
  temporal confirmation now handles transient noise rather than sacrificing
  recall at the model boundary.
- Patched the transitive `nanoid` advisory in the lockfile; security audit is
  green without accepting that finding as a policy exception.

## 1.5.0 — 09/08/2026

### Metric depth and KITTI export (P1-B-2)

- Added opt-in Depth Pro metric mode: on a frozen frame it estimates real-world metres and lifts each 2D detection into a metric 3D box in camera/KITTI coordinates.
- Added KITTI label export (15-field lines in metres) and a metric variant of the 3D JSON export (`scale: metric`, `dims_m`, per-object `distance_m`), plus a nearest-object distance readout.
- Depth Pro runs on demand in its own worker (~600 MB, loaded only when metric mode is enabled); the relative-depth realtime pipeline is untouched.
- Resolves the prior data-honesty gap: the 3D export copy referenced a "Depth Pro metric mode" that did not exist — it now exists.

### Detection overlay fix

- Fixed detection boxes never being visible. The `#det-overlay` SVG kept its `hidden` attribute and the global `[hidden]{display:none!important}` reset overrode the inline `display:block`, so boxes were drawn into a permanently hidden container. The attribute is now cleared whenever detections are shown.

### Detection accuracy and smoothing

- Raised confidence thresholds (RT-DETR 0.45 → 0.55, OWL-ViT 0.08 → 0.20) to cut false positives such as a raised hand becoming a second `person`.
- Added a temporal box smoother (`src/detection-smooth.ts`): boxes are matched across inference frames by IoU and centre distance, then interpolated every render frame so they glide with moving objects instead of jumping.
- Added confirmation and persistence: a box must appear in at least two consecutive inferences before it is drawn, and is kept for two missed inferences, removing flickering false positives.

### Verification

- tsc strict clean, full vite build green. Metric maths, KITTI formatting and the box smoother are covered by synthetic unit checks (transient false positive suppressed, real object confirmed, boxes glide without teleporting, fast motion matched by centre distance).

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
