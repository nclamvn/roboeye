# TIP-57C · True chirality and stable micro-grasp

## Header

- Priority: P0 visual correctness and fine-hand interaction
- Depends on: TIP-57B
- Working directory: repository root

## Root-cause contract

1. MediaPipe already publishes per-hand handedness, image landmarks and world
   landmarks. Replacing the detector cannot repair a renderer that discards
   chirality.
2. The pose solver may keep one canonical articulation space, but the render
   boundary must restore the missing reflection for the left hand.
3. A chirality transition must never interpolate the palm through zero width.
4. A pinch requires corroborated 3D evidence; screen-space crossing alone is
   never contact.
5. One missing contact frame must not tear a real pinch apart; sustained open
   evidence must still release it.
6. Fist closure must use continuous measured curl, not a gesture-selected
   canned pose.

## Acceptance criteria

1. Simultaneous left/right observations render with opposite determinant
   signs and thumbs on opposite screen sides.
2. A transient duplicate handedness label is resolved to two unique identities
   for the single-operator, two-hand studio contract.
3. Handedness changes are applied as a discrete chirality boundary while
   positive hand scale remains smooth and non-zero.
4. Grip-socket scale remains positive for phone/book props under a reflected
   left-hand hierarchy.
5. Contact uses world distance plus optional image proximity only when depth
   and broad world-space gates agree.
6. Contact hysteresis bridges one dropped frame and clears after sustained
   opening.
7. Continuous per-finger curl preserves a compact occluded fist while fingers
   participating in contact remain governed by contact IK.
8. Typecheck, complete unit suite, production build and browser E2E pass.

## Model decision

The tracking model is retained. The official Google AI Edge Hand Landmarker
contract exposes handedness, 21 image landmarks and 21 world landmarks for
multiple hands; those are the required observations for this phase. The defect
was downstream geometry and temporal contact handling, not absence of model
output. A future skinned left/right asset may improve surface aesthetics, but
is not required to correct chirality or fingertip contact.

Reference: <https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker>

## Boundary

- Visual teleoperation, not force/contact sensing.
- No discrete canned fist or pinch animation.
- No 2D-only contact inference.
- No new runtime dependency or cloud inference.
