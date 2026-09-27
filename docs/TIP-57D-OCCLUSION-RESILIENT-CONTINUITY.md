# TIP-57D · Occlusion-resilient hand continuity

## Header

- Priority: P0 realtime interaction quality
- Depends on: TIP-57C
- Research registry: `docs/research/hand-tracking-continuity/`

## Problem contract

The detector can miss one or more observations during fast turns, motion blur,
self-occlusion or two-hand overlap. A static pose hold makes the robot hand look
jammed; immediate deletion makes it blink out and reappear; trusting the raw
handedness label can swap two physical hands during a crossing.

## Architecture decision

1. Retain MediaPipe Hand Landmarker as the browser detector/tracker. Its VIDEO
   contract already performs lightweight tracking and re-runs palm detection
   when presence or tracking confidence fails.
2. Retain the timestamp-aware 1€ filters for measured landmarks.
3. Add an observation-centric two-track association layer. For two hands,
   exhaustively evaluating both assignments is deterministic and avoids a
   general tracking dependency. Predicted wrist trajectory and palm scale are
   primary; handedness is soft evidence, not a frame-local identity.
4. Replace the static short-loss hold with bounded, exponentially braking root
   prediction. Prediction never compounds and is capped in time and distance.
5. Blend the first three reacquired root/orientation samples from the predicted
   output to prevent a one-frame snap.
6. After the finite continuity window, remove the track. A missing hand cannot
   be reconstructed honestly forever from monocular RGB.
7. Use a RoboHand-only confidence profile: keep initial detection at 0.50,
   lower presence to 0.42 and tracking IoU to 0.35 to reduce unnecessary
   full-frame re-detection during fast motion. AirSketch/AirDesk remain at the
   prior 0.50 profile.

## Acceptance criteria

1. Two physical identities remain stable through a crossing even if handedness
   labels flip for one observation.
2. A missing observation within 180 ms continues along a bounded, braking
   trajectory instead of freezing.
3. The track may hold between 180–420 ms, then must expire—no ghost hand.
4. Reacquisition after a gap blends rather than teleports.
5. Prop ownership survives the bounded continuity interval.
6. No input queue is added; camera capture remains video-frame-synchronous,
   latest-frame-wins and worker-isolated.
7. Typecheck, unit suite, production build, RoboHand browser E2E and security
   audit pass.

## Rejected/deferred alternatives

- **Lucas–Kanade optical flow:** useful only as a later measured bridge; the
  official OpenCV guide explicitly notes failure on large motion, exactly the
  difficult case here.
- **HaMeR:** strong monocular 3D reconstruction research, but its large Vision
  Transformer is not a low-latency drop-in for this browser path.
- **WiLoR:** PyTorch/CUDA/MANO runtime and CC-BY-NC-ND model terms make it an
  unsuitable commercial browser dependency.
- **RTMPose/RTMW:** a valid later whole-body-context benchmark, not an immediate
  replacement for the current dedicated hand worker.

## Boundary

- This improves continuity; it does not invent occluded fingertips or promise
  zero loss under total occlusion.
- No tactile, force or collision-grade claim.
- Thresholds remain product parameters and require a recorded A/B camera corpus
  before being called universally optimal.
