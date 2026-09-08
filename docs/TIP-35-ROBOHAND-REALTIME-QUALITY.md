# TIP-35 · RoboHand realtime quality

## Context

Raw 21-point output is responsive but visibly noisy. A fixed strong smoother
reduces jitter by adding unacceptable lag, while a weak smoother makes the
mechanical rig vibrate. Tracking loss and handedness flicker also need temporal
contracts rather than frame-local decisions.

## Tasks

- Add speed-adaptive vector and quaternion filtering while preserving fixed
  segment lengths.
- Add bounded root prediction based only on measured source-frame age.
- Stabilize handedness and visible gesture labels across frames.
- Hold the last valid pose for 220 ms, then ease the rig to rest.
- Measure camera-frame-to-render-submit latency and render cadence with p50/p95.
- Add deterministic jitter, motion, gesture, loss and metric benchmarks.

## Acceptance criteria

- Stationary direction jitter is reduced by at least 55% in the synthetic gate.
- A fast intentional movement retains at least 65% of its displacement on the
  first filtered sample.
- Every filtered segment keeps its declared fixed length.
- A one-frame handedness or gesture glitch does not change the stable label.
- Loss below 220 ms holds; loss above 220 ms releases to rest.
- Runtime snapshot exposes sample count and p50/p95 latency/render metrics.

## Constraints

- Prediction horizon is capped and never applied to finger articulation.
- Filtering uses capture timestamps, not worker reply cadence.
- Gesture labels are observability only; they never gate retargeting.

