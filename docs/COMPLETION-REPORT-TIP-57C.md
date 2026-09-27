# Completion report · TIP-57C true chirality and stable micro-grasp

Date: 2026-09-24  
Status: **implemented and verified locally**

## Root causes closed

1. The solver correctly retained `Left`/`Right`, but canonicalized both hands
   into the same local articulation coordinates. The renderer then instantiated
   the same unreflected procedural mesh twice and ignored handedness, so both
   visible hands had the same chirality.
2. Pinch constraints were reconstructed independently on every frame. A brief
   landmark miss removed contact immediately.
3. Deep fist observations could temporarily flatten when fingertips were
   occluded. The geometric conditioner had no continuous curl evidence to
   preserve closure.

## Delivered

- The renderer restores left-hand chirality with a reflection plus orientation
  compensation. Chirality switches discretely, while size smoothing remains
  strictly positive, preventing a collapsed-palm transition.
- The studio assigns two unique identities even during a transient duplicate
  handedness label, so one operator's two rigs cannot both receive the same
  chirality.
- Grip sockets normalize reflected world scale before driving phone/book props.
- Contact evidence fuses world proximity with image proximity only when depth
  consistency and a broad 3D gate agree.
- Per-pair contact hysteresis acquires quickly, bridges a transient dropped
  frame and decays on deliberate opening.
- Five continuous measured curl values survive the pose/filter contract. They
  regularize occluded fists, while active contact fingers remain controlled by
  contact IK to avoid competing constraints.

## Verification

| Gate | Result |
|---|---|
| TypeScript strict/no-unused | PASS |
| Unit suite | PASS · 252/252 |
| Chirality regression | PASS · opposite determinant and thumb sides |
| 2D-crossing safety regression | PASS · no false contact |
| Contact dropout/release regression | PASS |
| Occluded-fist continuous-curl regression | PASS |
| Production build | PASS |
| RoboHand browser E2E | PASS |

## Model replacement decision

No detector replacement is justified for this defect. MediaPipe already emits
the required multi-hand handedness and 3D observations. Replacing it would add
latency and deployment risk without repairing the downstream reflection,
constraint and temporal-state errors. A later paired skinned asset is an
aesthetic upgrade, not a prerequisite for correct left/right or micro-grasp.

## Boundary

Self-occlusion can still remove all useful evidence. In that state the system
holds a bounded prior and then releases/abstains; it does not claim tactile or
force-level contact accuracy.
