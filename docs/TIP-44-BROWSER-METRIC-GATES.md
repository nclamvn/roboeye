# TIP44 — R0/R1 browser metric-depth measurement gate

## Contractor / scan / approval

2026-09-13. User approved next steps of the browser-only research architecture. RRI is auto-answered from that approval and prior research; no repeated approval interview. Roles execute sequentially in this task: contractor specifies, builder implements, contractor verifies.

Focused scan: strict TypeScript/Vite, browser workers, Node test runner. DriveSense has corrected RT-DETR, geometry/profile and replay. Existing depth worker outputs normalized uint8 relative depth, therefore **must not be reused for metres**. Current app disallows live inference for files. ONNX Runtime Web already installed transitively; tests support real Chromium. Dirty RoboHand/Drive changes predate this TIP and must remain. No separate lint script configured.

## Dependencies / scope

Depends on TIP43 and `research/browser-metric-depth/BAO-CAO-KIEN-TRUC.md`. Priority P0. R0 → R1 → measured local browser trial; production fusion and mobile acceptance only after evidence gates. No commit/push/deploy requested in this turn.

## Requirements and acceptance

- R44-1: Explicit metric output contract, optical-axis Z in metres, model identity/revision/hash, invalid mask; relative normalized depth rejected.
- R44-2: MoGe-2 Small official ONNX loader with pinned bytes/hash; implement focal/shift recovery and metric scale, do not call raw output metres.
- R44-3: Test analytical geometry fixtures and independent reference parity; actual-model checks distinct from synthetic tests.
- R44-4: Browser test bench can load a local image/video without upload, run a chosen backend explicitly, report input/compute/postprocessing/age. No silent WASM fallback reported as GPU.
- R44-5: Latest-frame single-flight, stale/reset/source-change protection, bounded storage and teardown. No future-frame replay reported as realtime.
- R44-6: Metric benchmark uses held-out explicit references, unaligned errors, coverage and latency; absent references stay null. Invalid references rejected.
- R44-7: Run health checks and actual local-browser model trial where available. Report hardware and untested phone/Safari gates explicitly; no product accuracy or realtime readiness claim from one desktop run.

Given synthetic affine points from a known camera, recovery must reproduce focal/shift/metres; degenerate masks must refuse. Given source switch while inference runs, stale output must not update new source. Given a relative depth tensor, metric adapter must refuse. Given no measured distances, exported accuracy stays null. Given a backend failure, status says failure, not successful fallback.

## Builder boundaries

Reuse installed ORT version and runtime assets. Test bench remains separate from DriveSense production measurement until parity/performance pass. Model weights go in ignored local cache, not git; camera/video never transmitted. Any model A/B winner is provisional until the same gates run on phone and laptop. DA2 export/reference is next dependent gate if not safely executable in this pass, not silently substituted with a relative community checkpoint.

L2 decision during build: local isolated Python reference tooling is available, so include DA2 export/parity now. Author-hosted metric safetensors, pinned revision/hash, fixed 224×280 RGB fixture; no dynamic-shape or road-quality claim. This follows the approved A/B research architecture. Model assets live under ignored `tests/.metric-cache`, outside production `public/`.

## Deliverables

Measurement contracts/tests, MoGe adapter, reproducible asset preparation and browser bench, completion/verify report with implemented/total, tests, build, measured versus missing gates.
