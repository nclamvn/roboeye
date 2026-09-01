# TIP-29: AirSketch Continuity and Visible-cursor Pickup

## Evidence and root cause

This is an interaction-state defect, not a missing drawing model or an
arbitrary confidence threshold problem.

1. Drawing entered only when the pointer pose passed, but it also continued
   only while that pose passed. `pointerPose` depends on the three non-index
   fingers looking folded. During a real pinch, slight rotation, blur or
   self-occlusion can classify them as extended for one sample. The code then
   ended a stroke although thumb and index were still pinched.
2. A null hand result was held for 120 ms. At the configured 30 fps that is
   only three to four samples, shorter than routine blur/occlusion gaps during
   a brisk drawing movement.
3. The displayed cursor is latency-compensated while pickup used a separate
   unpredicted coordinate. A user can therefore put the visible cursor on a
   drawing and still miss its hidden hit test. Using that display coordinate as
   the movement anchor would instead make the object jump on the next stable
   sample.

## Implementation contract

- Require pointer pose only to start a stroke. Once started, a non-fist held
  thumb–index pinch keeps ink down; releasing the pinch ends it.
- Keep a controller-owned 240 ms loss window, then release safely. This is a
  bounded continuity policy, not interpolation of unseen hand movement.
- Hit-test with the visible predicted cursor and store drag offset from the
  stable cursor. Thus selection agrees with the UI and the first stable move
  preserves object position.

## Acceptance

1. A pinched stroke survives a one-sample `open-pinch` pose misclassification.
2. A loss after 180 ms is retained; at 240 ms the active controller releases.
3. A predicted-cursor hit followed by the same stable anchor leaves the object
   in place, then later stable motion moves it normally.

## Non-goals

This does not claim hand tracking under complete occlusion, and it does not
change the classifier, model, or life-safety scope.
