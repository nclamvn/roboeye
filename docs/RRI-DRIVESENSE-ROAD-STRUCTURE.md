# RRI REPORT — DriveSense RoadStructure

Date: 2026-09-17. Questions already answered by the codebase and conversation are recorded, not asked again.

## REQUIREMENTS MATRIX

| ID | Requirement | Source/persona | Priority |
|---|---|---|---|
| RS-01 | Detect lane markings and physical road boundaries as different evidence classes | User + driver | P0 |
| RS-02 | Build an ego-lane corridor from temporal evidence; abstain when one/both boundaries are weak or stale | QA + safety | P0 |
| RS-03 | Do not use screen X alone as road topology; preserve perspective, calibration and source-frame coordinates | Prior range incident + developer | P0 |
| RS-04 | Compare candidate models on identical held-out clips/hardware with line, area, temporal and latency metrics | User + developer | P0 |
| RS-05 | Track code, weights and dataset rights independently; unresolved rights block commercial promotion | Business/legal | P0 |
| RS-06 | Keep inference local and bounded-age; worker lag degrades to unknown, never to a confident stale lane | Driver/operator | P0 |
| RS-07 | Support road markings, curb/con lươn/median, barrier and guardrail with Vietnamese scenario tags | User + product | P1 |
| RS-08 | UI remains sparse: translucent ego corridor and short boundary cues, no text wall | Prior UI feedback | P1 |

## AUTO-ANSWERED

- Browser remains the local development/replay target; vehicle hardware investment is deferred.
- Existing vehicle detection/range stays intact and must not be replaced by a multi-task demo model.
- Product policy is advisory/shadow-first and fail-closed.
- The first proof uses uploaded video, laptop/phone camera and synthetic contract fixtures before any road deployment.

## DECISIONS LOG

| Decision | Chosen | Rationale |
|---|---|---|
| RS-D01 | Separate `RoadStructure` worker | Different cadence/failure mode; detector/range regression is unacceptable. |
| RS-D02 | Two-head bake-off: lane line + semantic boundary | Lane-only models cannot reliably represent curb/median/barrier; segmentation alone can blur lane identity. |
| RS-D03 | Same-corpus promotion gate | Source-reported FPS/F1 across GPUs/datasets are not comparable. |
| RS-D04 | Licence provenance before download/integration | Repository licence does not automatically cover weights or training data. |
| RS-D05 | Honest null when corridor is incomplete/stale | A confident wrong lane is worse than no lane in a driver-assistance product. |

## OPEN QUESTIONS — NON-BLOCKING FOR TIP-50R-A/B

- Which first commercial dataset licence will be purchased or negotiated?
- What exact camera/lens and Vietnamese pilot routes will define the operational domain?
- What field truth method will validate physical-boundary and lane-departure events?
