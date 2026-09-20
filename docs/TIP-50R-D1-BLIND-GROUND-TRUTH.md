# TIP-50R-D1 — Blind road ground-truth workflow

## HEADER

- Project: RoboEye / DriveSense
- Module: RoadStructure held-out evidence
- Depends on: TIP-50R-B, TIP-50R-C
- Priority: P0

## CONTEXT

The canonical research artifact has run on eight sampled frames from `Test1.mp4` and `Test2.mp4`, but visual overlays are not quality evidence. Ground truth must be drawn from raw frames without exposing predictions and must remain cryptographically bound to the exact local source/task.

## TASK

Build a local-only annotation workflow that extracts raw frames, records source/image hashes and rights, supports typed road geometry, and requires a distinct second-pass reviewer before annotations can enter the benchmark.

## ACCEPTANCE CRITERIA

1. **AC-D1-01 — Prediction blindness**
   - Given an annotation task,
   - when its schema and UI payload are inspected,
   - then no model output, overlay, confidence, prediction frame or inferred mask is present.

2. **AC-D1-02 — Exact evidence binding**
   - Given a task and its annotation file,
   - when task bytes or any raw frame changes,
   - then SHA-256 validation fails before benchmark use.

3. **AC-D1-03 — Typed geometry**
   - The workbench supports normalized drivable polygons and polylines typed as lane marking, curb, median, barrier or guardrail.
   - Lane markings support ego-left, ego-right, adjacent or unknown roles; physical boundaries are forced to unknown.

4. **AC-D1-04 — Review gate**
   - Draft annotations cannot become benchmark truth.
   - Reviewed annotations require an accepted review with a reviewer role different from the annotator role.

5. **AC-D1-05 — Local data boundary**
   - Video and extracted frames stay outside the repository in a caller-selected local directory.
   - The server binds to `127.0.0.1`, validates paths and payload size, and writes annotations atomically.

6. **AC-D1-06 — Real-video readiness**
   - Four raw 1280×720 frames from each supplied video are extracted, hash-verified and load in Chrome without browser errors.

## CONSTRAINTS

- Do not relabel AI-generated masks as truth.
- Do not upload or commit user video/frames.
- Do not mark TIP-50R-D complete until reviewed labels and quantitative benchmark results exist.
- Do not connect RoadStructure outputs to the driver HUD in this TIP.

## DECISIONS LOG

- Reused the approved RoadStructure benchmark geometry rather than creating a second metric schema.
- Kept the workbench outside the product Vite entry because it is evidence tooling, not a driver-facing feature.
- Skipped a new Blueprint checkpoint: this TIP implements the already-approved held-out evidence gate and does not change product architecture.
