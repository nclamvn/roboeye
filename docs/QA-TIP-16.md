# QA REPORT · TIP-16 AirSketch

Date: 06/08/2026 · Environment: macOS Chrome headless + production Vite build.

| Tier | Passed | Failed | Total | Status |
|---|---:|---:|---:|---|
| Tier 1 · requirements/unit/contract | 21 | 0 | 21 | PASS |
| Tier 2 · responsive/recovery/fallback | 6 | 0 | 6 | PASS |
| Tier 3 · real models/performance/security | 5 | 0 | 5 | PASS |

Evidence:

- Unit suite: 27/27 PASS total; 4 tests are T16 gesture/document/metrics cases.
- AirSketch mock E2E: 10/10 PASS, including sidecar, 224×224 raster, top-3, phrase, TTS, clear and mobile.
- Real smoke: pinned QuickDraw returns top-3; pinned MediaPipe returns camera-frame inference.
- Real latency: hand p50 27.6 ms / p95 28.6 ms after 3 warm-up frames; QuickDraw 70.8 ms measured.
- Camera frames remain local; diagnostics store labels/timing only, never pixels, strokes or phrase text.

Limits:

- Fake-camera visual content is not a representative hand/drawing accuracy corpus.
- TTS availability/voice quality is provided by the host browser/OS.
