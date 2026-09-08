# TIP-33 · RoboHand pose pipeline

## Context

RoboHand needs a deterministic contract between MediaPipe's 21 landmarks and
any visual robot rig. Normalized image landmarks alone cannot preserve palm
orientation or finger depth, while feeding raw world coordinates directly to a
mesh creates scale drift and rubber-like fingers.

## Tasks

- Return `worldLandmarks`, handedness score and source-frame timestamps through
  the existing hand worker boundary.
- Build a hand-centric orthonormal basis from wrist, index MCP, middle MCP and
  pinky MCP.
- Convert all source segments to fixed-length local kinematic chains.
- Export a renderer-independent `RobotHandPose` contract for 20 segments.
- Add deterministic fixtures for open, fist, handedness and degenerate input.

## Acceptance criteria

- Exactly 21 solved points and 20 finite, normalized segment directions.
- Fixed segment lengths do not change when source landmark scale changes.
- Mirrored left/right fixtures retain the same canonical finger articulation.
- Degenerate or incomplete landmark sets return `null` rather than NaN.
- Existing unit tests, typecheck and build remain green.

## Constraints

- No Three.js dependency in the solver.
- No main-thread inference and no frame queue.
- The worker protocol remains backward-compatible for AirSketch and AirDesk.

