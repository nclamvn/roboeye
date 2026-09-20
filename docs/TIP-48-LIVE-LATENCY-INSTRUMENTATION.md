# TIP-48 — live capture-to-alert instrumentation

## HEADER

- Project: RoboEye / DriveSense
- Module: live browser hot path
- Depends on: current DriveSense pipeline; TIP-47A metric discipline
- Priority: P0
- Scope: measurement and export only; no risk-threshold or metre-estimation change

## CONTEXT

The current camera path records detector request latency and drops results older than one second, but it does not retain one trace from camera-frame availability through preprocessing, inference result acceptance, tracker/risk evaluation and the first rendered/audio alert. Consequently a quick-looking HUD cannot prove low latency, and `requestToResultP95Ms` cannot be presented as sensor-to-alert time.

## TASK

Add a bounded, local-only trace pipeline for live camera sessions. Each sampled frame receives a monotonically increasing trace ID and timestamps for frame callback, capture completion, worker dispatch/result, acceptance/drop reason, risk evaluation and first overlay/audio publication. Aggregate P50/P95/P99, frame age, drops and stage timings without uploading video or retaining pixel data.

## SPECIFICATIONS

1. Use one monotonic browser clock; never combine media time, wall-clock epoch and `performance.now()` as the same duration domain.
2. Latest-frame-wins remains authoritative. Every discarded or stale result records a typed reason; missing stages remain null, never zero.
3. Bound trace memory and exported events. Reset traces on source/model epoch changes so a previous source cannot contaminate a session.
4. Separate these quantities: frame-callback→capture, capture/preprocess, worker request→result, result age at acceptance, result→risk, risk→first overlay, risk→audio request and capture→first visible/audio alert.
5. Report P50/P95/P99, sample count and unavailable count for each stage. Show detector cadence, accepted/dropped result counts and maximum visible evidence age.
6. Add a machine-readable local JSON export with build/version, browser capability, source class, dimensions and explicit `live-camera` provenance. Do not include image bytes, file paths, plate/face data or raw landmark pixels.
7. Add deterministic unit tests using an injected clock and synthetic event sequences: normal, dropped busy frame, stale worker result, source reset, no-risk frame, risk rendered one RAF later and audio disabled/enabled.
8. The UI may expose a compact diagnostics status only under Analysis. It must not add driver-facing text or imply the target latency has passed.

## ACCEPTANCE CRITERIA

- A normal synthetic live trace yields exact stage durations and capture→overlay latency.
- A stale result increments the correct drop reason and never produces an alert duration.
- A source reset invalidates prior inflight traces and clears aggregate state.
- Missing audio or risk remains null and cannot improve a percentile.
- Memory remains bounded over a simulated two-hour session.
- Export contains no frame pixels/private paths and clearly distinguishes request latency from capture-to-alert latency.
- Full unit suite, typecheck, production build and diff hygiene pass; existing RoboHand work remains untouched.

## OUT OF SCOPE

No learned depth in camera-live, no new detector, no threshold tuning, no safety claim, no cloud telemetry and no public-road enablement. Hardware/device comparison starts only after this measurement layer is verified.
