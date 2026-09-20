# Completion / verification — TIP-50R-D4

Date: 2026-09-17. **STATUS: DONE for local experimental UI.**

## Delivered

- `road-runtime.ts`: pinned tensor/preprocessing contract and media-time freshness.
- `drive-road-worker.ts`: verified real ONNX/WASM inference, D3 vectorization,
  actual class-mask pixels, bounded single-flight protocol and tensor cleanup.
- `road-ui.ts`: separate lane lifecycle, toggle, stale/source/seek invalidation,
  mask/path renderer, visible state, recovery and bounded diagnostic history.
- `drive.html`, `drive.css`, `app.ts`: integrated floating lane control, explicit
  lane-only path, video/camera, analysis drawer, surface toggle, 1×/½×/¼× inspection,
  JSON diagnostics. Existing vehicle/depth analysis remains separately accessible.
- `stage-road-ui.mjs`, package script, Vite dev middleware: hash-checked ignored
  research cache; no research weights in public or production release.
- Unit/browser tests, TIP, task graph and user guide updated.

## Verification

**Requirement coverage: 6/6 (100%); missing: 0 within D4 local-UI scope.**

| Requirement | Evidence | Result |
|---|---|---|
| R1 real-video lane path | Test1 real weights, visible canvas pixels, play/pause; no detector/depth download in lane-only mode | PASS |
| R2 UI/diagnostics/transform | Desktop 1440×900 + mobile 390×844 screenshots reviewed; same contain transform; export JSON, speed selector | PASS |
| R3 abstention/lifecycle | Empty-mask and timestamp unit tests; seek/toggle clears pixels, source switch and video random access | PASS |
| R4 recovery/single-flight | Missing-model 404, same-sized SHA mismatch, retry; camera source test; worker terminated on stop | PASS |
| R5 isolation | No road import into range/risk; synthetic source excluded; research artifact gitignored and absent from dist | PASS |
| R6 local QA | 204/204 full unit tests, 15 browser checks, production build | PASS |

Commands:

```sh
npm run build
node --import tsx --test tests/unit/*.test.ts
npm run test:road-ui
git diff --check
```

- Build PASS; TypeScript errors 0; full unit suite 204 passed / 0 failed.
- Real-model browser scenarios 15 passed / 0 failed; browser page errors 0.
- Test2 duration **186.733333 s**: loaded, first frame inferred, random access
  to middle and last second inferred. This is NOT a full-duration playback soak.
- Camera uses browser fake-device fixture; physical phone camera not validated.
- No linter configured/run in this task; dependency advisory audit not rerun.
  No new dependencies. Existing accepted security risks are not cleared by D4.

Local evidence (not committed because it contains user video imagery):
`/private/tmp/roboeye-road-ui-qa/{result.json,diagnostics.json,paused-real-model.png,mobile.png}`.

## Measured performance / limits

Final short browser sample: 7 processed frames, request p50 **446.6 ms**, p95
**772.3 ms** (nearest-rank, includes startup), 2 replies expired while playing.
Other runs varied under machine load; one earlier run timed out waiting for its
first frame without enough captured diagnostics to assign a proven root cause.
Subsequent complete runs passed. This is not a latency acceptance benchmark.

The overlay expires after 400 ms of **media** time; paused frames remain valid.
Use pause or ¼× for inspection when inference cannot keep up. Slow playback is
explicitly labelled, never presented as realtime. No geometry is retained across
a seek or source generation. No queue is accumulated, and history is bounded at
600 samples. Long-video startup therefore does not require whole-clip analysis.

D3 lane quality, calibration, RoadGraph temporal fusion, commercial model/data
rights, field validation and lane-departure alerts remain outside this TIP and
unresolved. UI integration does not improve or certify those capabilities.

## Decisions / deviations

- User's request authorizes a local experiment despite D3's earlier no-HUD gate;
  the operational range/risk/field gate remains closed. Recorded before coding.
- Process reduced to scan → TIP → Builder → verification because architecture
  and user intent are already known. Frontend skill kept controls inside the
  existing video shell and moved technical detail to the drawer.
- Use latest displayed frame instead of whole-file precompute, so old uploaded
  clips can be tested immediately. WASM is the previously verified backend;
  no claim of WebGPU support is added.
- Add explicit slow playback after real-model measurements showed variable
  runtime cost. This supports inspection without relaxing freshness safeguards.

**Overall: READY for local UI testing; NOT READY for driving/safety/commercial
promotion.** No commit, push or deployment performed in this task.
