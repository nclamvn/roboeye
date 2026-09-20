# TIP-50R-B — RoadStructure benchmark contract

## HEADER
- Project: RoboEye / DriveSense
- Module: RoadStructure evidence
- Depends on: TIP-50R-A
- Priority: P0

## TASK

Implement a local, closed-schema corpus and deterministic scorer for typed road polylines and drivable polygons. Score lane/boundary detection, ego-corridor completeness, line error, drivable IoU, temporal lateral jitter, inference latency and stale evidence.

## ACCEPTANCE CRITERIA

- Truth and prediction IDs are independent; matching uses time, class/role and pixel geometry.
- Missed lines and false positives remain in denominators.
- Ego corridor counts only when both truth boundaries are present and matched.
- Evidence older than 250 ms is reported as stale.
- Rights, source hash and route/session split are mandatory; unknown fields/video bytes are rejected.
- Synthetic output is explicitly non-field evidence; CLI emits machine-readable JSON.

## CONSTRAINTS

No UI/model integration, no raw media storage, no field-quality claim and no tuning after seeing held-out results.
