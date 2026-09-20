# Completion Report — TIP-50R-D

## Status

IN PROGRESS — reviewed local baseline measured; the first vectorizer fails the
lane/corridor quality gate and is rejected for product integration.

## Same-artifact local evidence

Artifact: canonical OpenVINO road segmentation ONNX, SHA-256 `be0ceeb002af577936e9b439b7194dc8df6c8e5bc84ecb9bbfcab68695c86d17`.

| Source | Source SHA-256 | Frames sampled | WASM latency p50 / p95 | Visual finding |
|---|---|---:|---:|---|
| `Test1.mp4` (19.5 s, 1280×720) | `83a2ee31d6bbdd205531f5c684b29d23d2573011ac988b12efb8058ffb9de93f` | 4 | 184.6 / 234.0 ms | road, lane marks and physical curb/barrier are visibly separated across the clip |
| `Test2.mp4` (186.73 s, 1280×720) | `85d59cccacf5e968df17d92dad570ddbb1a72854e2221e1842a669fdb8cf575d` | 4 | 181.0 / 231.8 ms | segmentation remains coherent at widely separated timestamps, curves and overtaking traffic |

The first inference is cold-biased; steady samples are about 180–186 ms. At this resolution/provider the branch is suitable only for a low-frequency research cadence, not 30 FPS.

## Honest boundary

- Overlay inspection is qualitative and cannot substitute for IoU/line/corridor truth.
- Direct 1280×720 → 896×512 resize is recorded; no hidden crop or hand correction is applied.
- Source videos remain local; only hashes and measurements are documented.
- No RoadStructure output is connected to the driver HUD.
- TIP-50R-D1 provides a prediction-blind, hash-bound local annotation workbench and two four-frame tasks from the same sources.
- Both annotation sets were accepted by the human reviewer and frozen by hash for the D2 first held-out run. They remain explicitly classified as human-reviewed AI pre-labels, not independent expert truth.
- TIP-50R-D2 produced drivable IoU `0.5949`, lane match `0/16`, ego-corridor recall `0` and WASM p50/p95 `178.3/233.3 ms`; the candidate therefore fails promotion.
- Test1/Test2 are now test-only. The next build slice must use a separate validation set for continuity-aware path association.

## Ground-truth workflow evidence

- Test1 workbench: `http://127.0.0.1:4193/` while the local server is running.
- Test2 workbench: `http://127.0.0.1:4194/` while the local server is running.
- Unit contract: 4/4 focused tests pass.
- Chrome smoke: both tasks load 4 frames at 1280×720, expose no prediction payload and report zero browser errors.
- Inspector: all 8 raw image hashes pass; both annotation sets are reviewed and `benchmarkReady=true`.
- Machine report: `/private/tmp/roboeye-road-tip50r-d2-r1/report.json`, SHA-256 `837f22e76d5bb1ffba1306b7233d40f0877be32707929d855c882d3be0a48732`.
