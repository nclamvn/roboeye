# TIP-59 — Mobile detector continuity and CPU arbitration

## Incident

On iPhone 16 Pro Max, vehicle detections appeared but their boxes flashed off
before the next result. Labels and range values were therefore unreadable and
the primary vehicle could not retain a stable identity.

## Root cause

The tracker used the video capture timestamp for both association and visible
freshness. Its strong-evidence window was fixed at 400 ms. RT-DETR/WASM on a
phone can take longer than that, especially while DA2/WASM runs concurrently.
Consequently a valid result could already be older than the publication window
when it arrived. The same clock mismatch affected delayed metric results.

This was a scheduling and time-domain defect, not merely a drawing animation
problem. Increasing CSS persistence would have hidden the symptom while track
identity and range freshness still failed underneath.

## Implementation

- Keep media time for motion association and Kalman measurements.
- Use monotonic result-publication time for live overlay freshness.
- Derive bounded visual and association windows from measured detector latency
  and result cadence: never below a useful bridge and never above 1.8/2.6 s.
- Confirm moderate detections across slow but consecutive live results; retain
  the original strict 400 ms rule for offline evidence.
- Allow two bounded missed samples for visual identity while clearing distance,
  range velocity and range-derived risk immediately on the first miss.
- Timestamp accepted depth when it reaches the tracker and retain it only for a
  bounded adaptive window.
- When both pipelines use WASM, schedule depth at 1.2–2.5 s according to recent
  detector p50 latency. GPU-capable paths keep a faster bounded cadence.

## Acceptance evidence

- A fixture with 800 ms inference latency and 900 ms result cadence confirms a
  moderate-score vehicle, keeps one ID across the next interval and bridges one
  missed result without flashing.
- Three misses or the maximum hold removes the track.
- Offline replay still emits no box across a known missed sample.
- Unit suite, typecheck and production build must remain green.

## Safety boundary

TIP-59 improves presentation continuity and compute fairness. It does not make
uncalibrated monocular metres suitable for braking or driving decisions. Old
range evidence is invalidated independently of the visual continuity box.
