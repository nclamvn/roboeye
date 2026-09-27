# TIP-57B · Hand contact and release dynamics

## Header

- Priority: P0 demo correctness
- Depends on: TIP-57
- Working directory: repository root

## Root-cause contract

1. Deep flexion must not allow PIP and DIP to reverse onto opposing planes.
2. A held prop must attach to the rendered palm, not to an independently
   reconstructed wrist coordinate.
3. Hand/prop visibility must be resolved by the shared 3D depth buffer.
4. Ambiguous gesture frames must retain ownership; only a stable fully open
   palm releases the prop.
5. A released prop must transition through falling and settle on the stage.

## Acceptance criteria

1. Open articulation remains unchanged; a deep fist has fixed bone lengths,
   bounded joint angles and no PIP/DIP flexion-plane reversal.
2. Phone/book transforms come from a palm grip socket after rig smoothing.
3. Opaque hand and prop meshes both read and write depth.
4. One OPEN frame cannot release a prop; OPEN held for at least 120 ms does.
5. Release produces `falling`, downward acceleration and `resting` at floor.
6. Existing two-hand manipulation, contact IK and single-hand compatibility
   remain green.
7. Typecheck, unit tests, production build and RoboHand browser E2E pass.

## Constraints

- No screen-space masking or hard-coded camera-only occlusion trick.
- No canned fist pose; conditioning preserves measured proximal direction.
- One renderer, one animation loop, no cloud inference or new dependency.

