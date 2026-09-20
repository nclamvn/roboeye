# Completion Report — TIP-50R-D3

## Status

DONE — RESEARCH/DEVELOPMENT ONLY. PRODUCT PROMOTION REMAINS BLOCKED.

Continuity-aware v2 vectorization, versioned replay and a sampling-invariant
polyline scorer are implemented. Synthetic validation passes and the frozen
local clips show a large post-hoc development gain, but they are no longer an
independent held-out set and quality remains below a product gate.

## Files changed

### Created

- `docs/TIP-50R-D3-CONTINUITY-PATHS.md` — approved task contract.
- `docs/COMPLETION-REPORT-TIP-50R-D3.md` — this report.
- `docs/VERIFY-TIP-50R-D3.md` — contractor verification.

### Modified

- `src/drive/road-vectorizer.ts` — preserves D2 v1; adds v2 global path
  hypotheses, robust quadratic refinement, confidence and abstention.
- `src/drive/road-benchmark.ts` — changes line geometry from point-to-point to
  symmetric point-to-segment distance and makes bottom-point selection
  independent of array order.
- `scripts/benchmark-road-reviewed.ts` — explicit `--vectorizer v1|v2`, unique
  corpus/evidence classes and versioned report metadata.
- `tests/unit/road-vectorizer.test.ts` — dashed curves, adjacent distractors,
  horizontal/short evidence and ambiguity scenarios.
- `tests/unit/road-benchmark.test.ts` — equivalent polyline resampling/order
  invariance.

## Requirement result

| Requirement | Result | Evidence |
|---|---:|---|
| REQ-D3-01 versioned v1/v2 | PASS | Both exports retained; runner requires an explicit recorded version |
| REQ-D3-02 bridge dashed gaps | PASS | Synthetic curved/dashed corridor stays continuous despite alternating adjacent marks |
| REQ-D3-03 perspective/curve bounds | PASS | Direction, slope, curvature, normalized finite-point and side checks |
| REQ-D3-04 confidence diagnostics | PASS | Support rows/span, RMS, confidence, accepted/reason per side |
| REQ-D3-05 fail closed | PASS | No hypothesis, weak geometry and ambiguous competing paths abstain |
| REQ-D3-06 independent synthetic validation | PASS | Deterministic mask tests; no D2 coordinates enter vectorization |
| REQ-D3-07 evidence versioning | PASS | v1=`frozen-d2-baseline-rescore`; v2=`post-hoc-development-diagnostic` |
| REQ-D3-08 no product wiring | PASS | No RoadGraph/HUD integration |
| REQ-D3-09 sampling-invariant metric | PASS | Sparse reversed truth and dense forward prediction match at <1e-9 px |

## Corrected before/after diagnostic

The same corrected scorer and the same eight reviewed frames were used for both
rows. This comparison is **post-hoc development evidence**, not a new held-out
quality claim.

| Vectorizer | Predicted | Matched | Precision | Recall | F1 | Ego-corridor recall | WASM p50 / p95 |
|---|---:|---:|---:|---:|---:|---:|---:|
| D2 v1 | 16 | 1 | 0.0625 | 0.0625 | 0.0625 | 0 | 181.2 / 240.6 ms |
| D3 v2 | 11 | 6 | 0.5455 | 0.3750 | 0.4444 | 0.3750 | 185.6 / 232.3 ms |

Drivable IoU remains `0.5949`; D3 changes line association, not road-area
segmentation. V2 deliberately abstains on five unsupported line instances.

## Evidence identity

| Item | SHA-256 |
|---|---|
| v1 corrected rescore report | `7ddf6edb451fd5294bb25b534572525958580f6ca072dfdecfbc6049925579f8` |
| v2 post-hoc report | `830f40abe838fb3a61d7f5efa1955f861ed06c7be424c35899497e89d53234d0` |
| v2 corpus | `61f88ce8bf8bc8eb54f00e4eb0e14224a514e74458d7b29943af84b724fbaff8` |
| vectorizer source | `c37307d12acd082a6d55e3351e2c5f19d31a39efeb8f7e0b742d1908f1f8445b` |
| scorer source | `76131b950158ac8d51b8eb282a3072c88ef47d5291fdd8375fe91fbf2f6ca1ae` |
| runner source | `5e0ca9970cbd3aa58c6ed9014ec3b819d626c0b1b678c5c89ee4233a5e4fb964` |

Local evidence paths:

- `/private/tmp/roboeye-road-tip50r-d2-rescore-final`
- `/private/tmp/roboeye-road-tip50r-d3-posthoc-final`

## Issues discovered

- **P0 evidence:** no independent third video/journey exists for a clean D3
  held-out run.
- **P0 quality:** recall `0.375` and ego-corridor recall `0.375` remain far too
  low for RoadGraph or a driver HUD.
- **P1 evidence:** labels are human-reviewed AI pre-labels, not expert lane
  annotation.
- **P1 product:** model/training-data commercial rights remain unresolved.

## Deviations

- Added a benchmark-metric amendment after visual verification exposed sampling
  bias. This corrects the evaluator rather than changing model thresholds. The
  original D2 report remains preserved and explicitly deprecated for line
  quality.
- Temporal tracking was not added; by architecture it belongs to TIP-50R-E and
  must not compensate for weak per-frame evidence.

## Suggestions for Chủ thầu

- Acquire a third, rights-cleared source and annotate it independently before
  any further metric-driven tuning.
- Audit the current ego-boundary label policy with lane-annotation examples;
  distinguish physical mark centreline, inferred lane boundary and drivable
  envelope so the model and ground truth measure the same object.
