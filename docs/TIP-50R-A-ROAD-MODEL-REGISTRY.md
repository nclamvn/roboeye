# TIP-50R-A — Road model/data provenance registry

## HEADER
- Project: RoboEye / DriveSense
- Module: RoadStructure research gate
- Depends on: focused scan + RRI + approved software-only blueprint
- Priority: P0

## TASK

Create a typed candidate registry and a Refinery-backed source registry. Track code, weights, training dataset, revision/hash and web-runtime evidence separately. Missing evidence must block commercial promotion.

## ACCEPTANCE CRITERIA

- Official sources exist for every factual candidate claim.
- A permissive repository licence alone never yields `commercialEligible=true`.
- BDD100K commercial restrictions are visible on the YOLOPv2 gate.
- Unknown CULane/Cityscapes or weight rights remain honest null/blockers.
- Duplicate or dangling evidence IDs fail loudly.
- Refinery build is deterministic and its injected gate failures bite.

## CONSTRAINTS

Do not download weights, infer legal permission, add dependencies or modify the driving runtime.
