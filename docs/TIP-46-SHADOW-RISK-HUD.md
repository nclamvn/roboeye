# TIP-46 · Camera-only shadow risk HUD

## Header

- Module: DriveSense
- Depends on: TIP-42–45
- Priority: P0 software-capability gate before vehicle hardware
- Safety scope: local video, synthetic proof and controlled camera test only

## Task

Turn isolated detector/range outputs into an explainable shadow forward-risk
pipeline without claiming production FCW or controlling a vehicle.

## Requirements

1. Derive scale-free TTC from temporal bounding-box expansion after multiple
   strong observations; reset it on a miss or weak-only evidence.
2. Combine optical TTC with range-derived TTC while exposing agreement/conflict.
3. Classify tracks against a transparent perspective driving corridor and select
   exactly one primary in-path threat.
4. Add speed-aware time-headway and the fixed good-condition distance table from
   Circular 38/2024; abstain below 60 km/h or above 120 km/h.
5. Refuse a critical state when TTC signals materially conflict or evidence is
   insufficient.
6. Draw corridor, primary-target brackets, metre-only vehicle badges and a
   high-contrast risk console without covering the source video. TTC remains an
   internal risk signal and must not be presented as a distance alternative.
7. Add opt-in, rate-limited local audio and a bounded shadow-event log.
8. Export risk config, event evidence and latest snapshot in report schema v4.
9. Preserve video-local privacy, existing distance provenance and all earlier
   fail-closed behavior.

## Acceptance

- Deterministic tests prove optical TTC without metric range, reset after miss,
  side-target rejection, TT38 mapping, critical selection and conflict downgrade.
- Synthetic product demo visibly separates a side vehicle, selects the lead
  vehicle and exposes vehicle distance, reference distance, reason and evidence.
- Unit suite, typecheck, production build, security audit and browser walkthrough
  pass.

## Explicit non-goals

- No automatic brake/steer/throttle integration.
- No claim that the perspective corridor is detected lane geometry.
- No validated probability interpretation for the evidence percentage.
- No public-road or accuracy claim without independent synchronized ground truth.
