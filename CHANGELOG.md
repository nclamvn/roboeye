# Changelog

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
