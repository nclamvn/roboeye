# TIP-49L-C — depth-order consistency across lanes

## HEADER

- Project: RoboEye / DriveSense
- Trigger: repeated inversions `70/56`, `57/52`, `51/45` and final-HUD `51/43` between the left-nearer and right-farther vehicles
- Depends on: TIP-45 learned metric range; TIP-49L-A/B local camera/video workbench
- Priority: P0 correctness
- Scope: fail-closed validation and research evidence; no new hardware/model download

## CONTEXT

The current Depth Anything V2 Metric Outdoor result is sampled independently inside each 2D vehicle box. Its perspective gate only compares strongly aligned boxes with horizontal overlap. Vehicles in different lanes therefore bypass the gate even when the lower ground-contact position says one vehicle is nearer while learned metric depth says the opposite. A browser trace from the actual `Test1.mp4` reproduced the defect: at frame 0 the left car had `y1=0.737302` and `51.226 m`, while the higher right car had `y1=0.729032` and `44.677 m`. The old normalized `0.012` contact gate required 8.64 px at 720p, so the real 5.95 px separation was incorrectly treated as ambiguous.

Monocular metric depth remains ill-posed and the current checkpoint is fine-tuned on synthetic Virtual KITTI. Current research for road vehicles uses ground-plane/vertical-position cues and uncertainty fusion rather than trusting a single learned depth value. The application must not repair an inversion by swapping or inventing metres.

## TASK

Add a conservative cross-lane publication invariant. For high-confidence, non-truncated detections in the reviewed vehicle family (`car`, `truck`, `bus`), use box-bottom ground-contact position as the ordinal cue on a locally planar road. Express contact resolution in source pixels, not a screenshot-tuned normalized ratio. Do not let raw detector subclass flicker bypass the gate: candidate suppression and tracking already treat those labels as competing interpretations of a vehicle. Apparent box height cannot veto the contact cue because physical vehicle height and occlusion vary. Once two contact rows are resolved, any reversed learned-metre order must abstain on both values and preserve an explicit reason. Enforce the invariant twice: on raw model results and again on the exact post-Kalman/interpolated tracks sent to HUD and risk, for both analysed replay and live camera.

## ACCEPTANCE CRITERIA

1. Regression fixtures normalized from the 17/09 screenshots (`70/56`, `57/52`, subclass-flicker `51/45` and final-HUD `51/43`) are detected as ordinal conflicts and neither wrong point estimate is published.
2. Contact rows less than two source pixels apart remain ambiguous; resolved contact rows cannot be overruled by apparent vehicle height.
3. Correctly ordered cross-lane ranges remain untouched.
4. `car`/`truck`/`bus` subclass flicker cannot bypass a ground-contact ordering claim; non-vehicle labels remain out of scope.
5. The implementation never swaps, averages or fabricates a corrected distance.
6. Existing same-lane compressed-depth, zoom, truncation, geometry-priority and replay tests continue to pass.
7. Live camera calls the same learned-range validator as offline replay before updating a track.
8. The exported policy identifier changes so reports cannot mix results from the old and new gates.
9. Focused tests, full unit suite, typecheck, production build, security audit and diff hygiene pass.
10. Post-filter and interpolated replay output is revalidated immediately before publication; an invalidated range cannot feed status, closing speed or range TTC.
11. Running the real `Test1.mp4` through the browser pipeline yields zero reversed pairs in sampled replay frames and in a 20 ms scan of displayed/interpolated frames.

## DEFERRED FOLLOW-UPS

- A/B DA2 against MoGe-2/Metric3D/GVDepth-like cue fusion on independent vehicle ground truth.
- Camera-profile or assisted ground-plane calibration, local road slope/roll compensation and tire/contact-point estimation.
- Temporal video-depth challenger after static ordering and metric accuracy are measured.
