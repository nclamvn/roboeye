# Completion report · TIP-57D occlusion-resilient continuity

Date: 2026-09-24  
Status: **implemented and verified locally**

## Root causes closed

1. Handedness was treated as a per-frame track id. During a crossing or
   duplicate label, the two physical hands could swap controllers.
2. A missed observation returned the exact same pose for 220 ms. The deliberate
   static hold looked like a jam, then the hand disappeared abruptly.
3. Reacquisition resumed directly at the new measured pose, creating a visible
   pop after the frozen interval.
4. All modes shared default MediaPipe confidence thresholds even though
   RoboHand has a different continuity objective from AirSketch/AirDesk.

## Delivered

- Added a two-track observation-centric identity layer. It predicts wrist
  motion, scores palm-scale consistency, evaluates both possible assignments
  and treats handedness as soft evidence only after initialization.
- Added velocity estimation and exponentially braking root prediction for the
  first 180 ms of missing evidence. Prediction is computed from the last live
  pose, capped at 0.28 scene units and never recursively compounded.
- Extended the finite continuity envelope to 420 ms. The middle interval is an
  explicit hold; after the envelope the pose is removed.
- Added three-frame root/scale/orientation blending on reacquisition.
- Added continuity telemetry for predicted frames, held frames, reacquisitions
  and maximum observed gap.
- Added a RoboHand-only Hand Landmarker profile: detection 0.50, presence 0.42,
  tracking IoU 0.35. AirSketch/AirDesk keep 0.50 defaults.
- Added a seven-method provenance registry and documented alternatives that are
  deferred or blocked for the current commercial browser runtime.

## Verification

| Gate | Result |
|---|---|
| Full unit suite | PASS · 256/256 |
| Crossing + flipped-label regression | PASS |
| Bounded prediction/expiry regression | PASS |
| Reacquisition blending regression | PASS |
| TypeScript + production build | PASS · 74 modules |
| RoboHand browser E2E | PASS · 16 checks |
| RoboHand profile browser contract | PASS |
| Security audit | PASS · 0 high / 0 critical |
| Refinery build/auditor/idempotency | PASS |
| Refinery adversarial bite suite | PASS |

The source repository resides in a macOS Documents-backed location where one
TypeScript process stalled at 0% CPU during filesystem traversal. Verification
was rerun from the existing checksum-synchronized hydrated workspace in `/tmp`;
the checked source hashes matched before build.

## Honest boundary

No monocular RGB tracker can guarantee landmarks through total occlusion or a
hand that has left the field of view. TIP-57D bridges short evidence gaps and
fails closed after 420 ms; it does not fabricate indefinitely. A real-camera A/B
corpus remains required before the confidence profile can be called optimal
across devices and lighting conditions.
