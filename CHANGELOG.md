# Changelog

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
