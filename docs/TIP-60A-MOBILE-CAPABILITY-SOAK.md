# TIP-60A — Mobile capability and soak evidence

**Status:** ACCEPTED / BUILDING
**Scale:** Medium / runtime instrumentation + report contract + verification
**Owner approval:** explicit implementation request, 2026-09-27

## Header

- **TIP-ID:** TIP-60A
- **Project:** RoboEye DriveSense
- **Module:** live camera runtime evidence
- **Depends on:** TIP-48, TIP-59, mobile traffic perception scan 2026-09-27
- **Priority:** P0 before changing or promoting a mobile detector

## Intent

Turn the iPhone/Xiaomi observations into reproducible, pixel-free evidence. The
runtime must reveal where time and continuity are lost over a 20–30 minute
camera session without changing detection, tracking, range or warning policy.

This TIP does not claim distance accuracy or road safety. It creates the
measurement plane needed to choose the next model and execution path honestly.

## Requirements

| ID | Requirement | Acceptance evidence |
|---|---|---|
| REQ-60A-01 | Export actual camera width, height, frame rate, facing mode and resize mode through an allowlist; never export pixels, camera label, device ID or local path | Sanitizer/privacy tests |
| REQ-60A-02 | Record detector/depth requested backend, resolved backend, total load time and observable warmup time | Unit tests + app integration |
| REQ-60A-03 | Record presented-frame gaps, callback lateness and decode processing duration when the browser exposes them | Synthetic metadata tests |
| REQ-60A-04 | Record detector started/accepted/dropped/busy, request-to-result and frame-to-overlay latency in 0–5, 5–10, 10–20 and 20+ minute windows | Deterministic window tests |
| REQ-60A-05 | Record metric attempts/results, visibility/camera/worker interruptions and a clearly labelled track-set turnover proxy | Unit tests + exported report |
| REQ-60A-06 | Keep memory bounded for long sessions while retaining cumulative counters and histogram percentiles | 72,000-frame simulation |
| REQ-60A-07 | Add the evidence to the existing DriveSense JSON report without changing detector, tracker, range or risk decisions | Typecheck/unit/build/security gates |

## Contract decisions

- Clock is monotonic `performance.now()` milliseconds.
- Latency distributions use fixed 1 ms histogram bins from 0–5000 ms plus an
  overflow bin. Percentiles therefore remain bounded-memory and are rounded to
  millisecond resolution.
- Time windows are half-open: `[0,5m)`, `[5m,10m)`, `[10m,20m)`, `[20m,+∞)`.
- `presentedFrameGaps` is inferred only from monotonic
  `requestVideoFrameCallback.presentedFrames`; absence remains unavailable.
- Track births/losses are an **observational turnover proxy**, not ground-truth
  ID switches or MOT accuracy.
- Unsupported timestamps/warmup values stay `null`; absence is never converted
  to zero.
- Camera settings use a closed allowlist. Browser user agent remains in the
  pre-existing runtime report and is not duplicated here.

## Acceptance scenarios

1. Given a 21-minute synthetic session, events land in the correct four time
   windows and overall counters equal the sum of windows.
2. Given 72,000 frames, report size and in-memory trace state remain bounded
   while lifetime counters remain cumulative.
3. Given camera settings containing `deviceId`, `groupId` and `label`, only the
   approved numeric/enumerated fields appear in the report.
4. Given delayed detector and overlay timestamps, p50/p95/p99 are deterministic
   and no raw image content enters the report.
5. Given model fallback or worker/camera lifecycle events, the report keeps the
   attempted and resolved backends and counts the interruption.
6. Given the completed integration, existing perception tests and build gates
   continue to pass.

## Non-goals

- No detector or depth model replacement.
- No new road-warning threshold and no automatic hardware tier promotion.
- No collection of camera frames, faces, number plates, GPS or device identity.
- No claim that browser callback time equals physical sensor exposure time when
  the browser does not expose `captureTime`.

## Decisions log

- The mobile scan identified instrumentation as the first missing gate; model
  bake-off is deliberately deferred until this evidence exists on both target
  phones.
- Histograms are used instead of retaining all frame traces so a soak session
  cannot grow memory linearly.
- Existing `LiveTelemetry` remains intact for trace-level debugging and the
  acceptance gate. TIP-60A adds a complementary long-session aggregate.
