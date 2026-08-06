# BLUEPRINT · Detection Stabilization

## PROJECT INFO

| Field | Value |
|---|---|
| Project | RoboEye Edge Perception Studio |
| Cycle | Detection stabilization |
| Date | 06/08/2026 |
| Approval | Homeowner direction confirmed; no architecture change |

## GOAL

Turn the existing detection/annotation implementation into a typed, recoverable and testable first-class workflow without adding a backend, model, mode or metric-depth claim.

## ARCHITECTURE

The current browser-only dual-worker architecture remains intact.

```text
detect-worker.ts ── typed messages ──► main.ts ──► shell/scene
                                            │
                                            └── annotations.ts ──► downloads
                                                     │
                                                     └── unit tests
```

Planned structural changes:

- `src/detection-types.ts`: shared engine, box and worker message contracts.
- `src/annotations.ts`: pure COCO/YOLO/3D conversion functions.
- `src/main.ts`: orchestration only; download side effect stays here, conversion moves out.
- `tests/unit/annotations.test.ts`: deterministic converter tests.
- `README.md`: user/operator documentation.

## BEHAVIOR CONTRACT

- Detection is disabled at boot and starts only when the user opts in.
- A successful detection replaces the current in-memory box list unless frozen.
- A frame error clears the main-thread busy flag and shows an error status, allowing a later frame or user action to recover.
- COCO uses pixel `xywh`; YOLO uses normalized `class cx cy width height` and a deterministic class list.
- 3D JSON always declares `scale: relative`; a missing 3D fusion result remains `null`.
- Export with no boxes remains a no-op in the UI.

## REQUIREMENT MAPPING

| Blueprint area | Requirements |
|---|---|
| Worker contract and recovery | REQ-D01, D02, D03 |
| Annotation module | REQ-D04, D05 |
| Unit tests | REQ-D06 |
| Documentation | REQ-D07 |
| Regression verification | REQ-D08 |

## TASK GRAPH

`TIP-08 Detection Stabilization` is one cohesive TIP because all changes share a single contract and verification cycle.

No product feature outside REQ-D01–D08 is included.
