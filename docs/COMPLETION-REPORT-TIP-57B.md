# Completion report · TIP-57B hand contact and release dynamics

Date: 2026-09-24  
Status: **implemented and verified locally**

## Root causes closed

1. The real-time filter and the render rig smoothed phalange directions
   independently. Valid endpoint poses could therefore interpolate through a
   frame where PIP and DIP flexed on opposing planes.
2. Held props reconstructed a second pose from wrist coordinates. That pose
   did not match the already-smoothed rendered palm, leaving the phone beside
   the hand.
3. Ownership ended on any non-grip sample. There was no deliberate OPEN dwell,
   falling state or ground contact.

## Delivered

- A flexion-plane projection retains the measured proximal direction, fixed
  bone lengths and bounded joint angles while forcing PIP/DIP to bend on one
  stable plane. It runs after temporal filtering and after render interpolation.
- Phone/book attachment points are actual children of each rendered palm. The
  object receives that socket's world position, orientation and scale.
- Hand shells and props share opaque depth testing/writing, so mutual
  occlusion changes naturally with palm orientation without a 2D mask.
- Ownership survives ambiguous frames. Only a fully open, low-grip hand held
  for 120 ms releases the object.
- Release enters `falling`, applies bounded downward acceleration/spin and
  settles at a typed `resting` state on the stage.

## Requirement coverage

- Implemented: 7/7 acceptance criteria (100%).
- Deterministic tests cover open-hand preservation, opposing-DIP repair,
  open-to-fist render interpolation, socket transform/scale, release hysteresis,
  gravity and ground rest.

## Verification

| Gate | Result |
|---|---|
| TypeScript strict/no-unused | PASS |
| Unit suite | PASS · 248/248 |
| Production build | PASS · 74 modules |
| RoboHand WebGL2 browser E2E | PASS · acquisition, OPEN release, loss safety and zero runtime errors |
| Visual render evidence | PASS · phone centered on rendered palm; shared depth ordering active |

## Boundary

This is deterministic visual interaction, not force sensing or collision-grade
rigid-body physics. Correctness is limited by camera landmark visibility; when
the real hand hides every fingertip, the system retains ownership through a
short ambiguous interval rather than inventing a release.
