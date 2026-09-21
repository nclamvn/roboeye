# Verification — TIP-56B Common Evidence Plane

**Verified:** 2026-09-21
**Environment:** local macOS/Node/TypeScript; synthetic contract fixture
**Runtime model changed:** no

## Requirement coverage

| Requirement | Evidence | Result |
|---|---|---|
| REQ-56B-01 closed versioned contract | Strict parser rejects unknown fields; SHA/artifact/config/rights/annotation gates | PASS |
| REQ-56B-02 identical frame plan | Exact journey/SHA/dimensions/sample/time checks; omitted frame rejected | PASS |
| REQ-56B-03 deterministic matching | Fixed IoU + existing Hungarian assignment; repeatable fixture result | PASS |
| REQ-56B-04 detection/tracking quality | Precision, recall, class accuracy, continuity, ID switch and fragmentation assertions | PASS |
| REQ-56B-05 primary-target quality | Correct/miss/false-selection/transition/churn metrics asserted | PASS |
| REQ-56B-06 runtime evidence | Nine distributions publish samples, unavailable, coverage, p50, p95 and max | PASS |
| REQ-56B-07 promotion boundary | Blocked synthetic challenger scores better but remains ineligible; automatic winner is null | PASS |
| REQ-56B-08 uploaded-video seam | Pure adapter exports sample/time/boxes/tracks/primary/telemetry; no pixels/path | PASS |
| REQ-56B-09 CLI workflow | Assemble and evaluate smoke completes with exclusive output files | PASS |
| REQ-56B-10 no regression | Typecheck, 241 unit tests, build and security audit pass | PASS |

**Coverage:** 10/10 = 100%.

## Scenario results

- Control fixture: recall/precision 6/7, one FP, one FN, one ID switch, one
  fragmentation, primary churn 1/3; missing memory/display telemetry remains
  null with zero coverage.
- Challenger fixture: perfect synthetic 2D/continuity result and complete
  telemetry, but its commercial gate is `blocked`; it remains ineligible.
- Dropped/reordered timestamp, altered SHA/dimensions, missing journey, hidden
  path, duplicate candidate, foreign environment and unbound primary ID all
  fail closed.
- Reviewed truth plus approved commercial gate changes only
  `promotionReviewEligible`; it still never creates an automatic winner.

## Technical health

| Gate | Result |
|---|---|
| Focused TIP tests | 7/7 pass |
| Full unit suite | 241/241 pass |
| `npm run typecheck` | PASS — 0 type errors |
| `npm run build` | PASS — 73 modules transformed |
| `npm run security:audit` | PASS — 0 critical; two pre-existing accepted-risk advisories |
| Assemble CLI smoke | PASS |
| Evaluate CLI smoke | PASS |
| `git diff --check` | PASS |

## Missing/deferred evidence

- Reviewed 2D truth from the user's original videos: deferred until the exact
  original bytes are selected and annotated.
- Actual RF-DETR/YOLO26 candidate runs: deferred; no model acquisition was
  authorized by TIP-56B.
- Physical range accuracy and realtime capture-to-display evidence: separate
  TIP-56D/TIP-48 gates.

## Contractor verdict

**READY with explicit external inputs deferred.** The Common Evidence Plane is
complete and safe to use. It does not demonstrate that any challenger beats the
control and does not authorize a model promotion.
