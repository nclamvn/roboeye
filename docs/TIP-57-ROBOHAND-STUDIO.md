# TIP-57 · RoboHand Studio

## Header

- Priority: P0 demo feature
- Depends on: TIP-33 → TIP-37
- Working directory: repository root

## Task

Extend the existing single-hand RoboHand pipeline into a low-latency two-hand
studio with independently filtered rigs, multi-hand proof overlay and stateful
phone/book manipulation.

## Acceptance criteria

1. A MediaPipe result containing two hands reaches two independent robot rigs.
2. Losing one hand does not reset or relabel the other hand.
3. Overlay renders 21 landmarks for each tracked hand with distinct colours.
4. Pinch or fist can acquire the nearest in-range phone/book and release it.
5. The other hand can produce a phone swipe or book page-turn event.
6. All interaction thresholds are normalized by the hand/palm contract and
   covered by deterministic unit tests.
7. Existing single-hand worker fields remain populated.
8. Typecheck, unit suite, production build and RoboHand E2E pass.

## Constraints

- One renderer and one animation loop.
- Latest frame wins; never queue camera frames.
- No cloud inference, remote asset or unreviewed dependency.
- Gesture labels do not drive canned finger animation.
- No claim of real force, collision or sign-language understanding.

## Report

Create `docs/COMPLETION-REPORT-TIP-57.md` after verification.

## Result

Implemented. TypeScript, production build, 244 unit tests and the dedicated
two-hand browser E2E are green. See `docs/COMPLETION-REPORT-TIP-57.md`.
