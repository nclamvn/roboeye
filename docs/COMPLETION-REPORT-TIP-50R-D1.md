# Completion Report — TIP-50R-D1

## STATUS

DONE — annotation infrastructure and two blind local tasks are ready. The original D1 delivery ended with model-output-blind AI pre-labels awaiting review; both sets were subsequently accepted by the human reviewer and frozen for TIP-50R-D2.

## FILES CHANGED

- `src/drive/road-annotations.ts`
- `scripts/prepare-road-annotation-task.mjs`
- `scripts/serve-road-annotator.ts`
- `scripts/inspect-road-annotations.ts`
- `tools/road-annotator.html`
- `tools/road-annotator.css`
- `tools/road-annotator.js`
- `tests/unit/road-annotations.test.ts`
- `tests/road-annotator-e2e.mjs`
- `package.json`
- RoadStructure TIP/report/task-graph documentation

## TEST RESULTS

| Acceptance criterion | Result | Evidence |
|---|---:|---|
| AC-D1-01 prediction blindness | PASS | Closed task/annotation schemas reject extra prediction fields; both browser tasks expose only `predictionBlind` |
| AC-D1-02 exact binding | PASS | Task/source/frame SHA-256 checks; negative unit tests for changed task and image hashes |
| AC-D1-03 typed geometry | PASS | Workbench and parser support five line classes, four lane roles and drivable polygons; invalid physical-boundary roles fail |
| AC-D1-04 review gate | PASS | Draft conversion and self-review fail; distinct accepted reviewer passes |
| AC-D1-05 local boundary | PASS | Raw assets live under `/private/tmp`; localhost-only server; safe names, byte limit and atomic save |
| AC-D1-06 real-video readiness | PASS | 4 Test1 + 4 Test2 frames, 1280×720, every image hash valid; Chrome E2E reports zero browser errors on both tasks |

Technical gates: TypeScript PASS; unit tests 194/194 PASS; build PASS; security audit PASS; `git diff --check` PASS.

## LOCAL EVIDENCE

| Task | Source SHA-256 | Task SHA-256 | Frames | State |
|---|---|---|---:|---|
| `tip50r-d-test1-v2` | `83a2ee31d6bbdd205531f5c684b29d23d2573011ac988b12efb8058ffb9de93f` | `fbf30839fb1cc1f77c1c6671ac998487b085ff4793a2feadf7e2b99d55444123` | 4 | reviewed, annotation revision 3 |
| `tip50r-d-test2-v2` | `85d59cccacf5e968df17d92dad570ddbb1a72854e2221e1842a669fdb8cf575d` | `7b6b4ebdc93f71eed7ac900444041a230b24ab392d5c0386192074c17a54db52` | 4 | reviewed, annotation revision 2 |

Rights basis is `consented`: the user supplied the local footage for this evaluation; ownership and redistribution rights are not inferred.

Both reviewed tasks have `V 4/4` drivable areas and `L 4/4` ego-left/ego-right pairs. Test1 preserves the user's frame-1 polygon; all remaining geometry is explicitly attributed as `codex-ai-prelabel`. No benchmark-model mask or overlay was exposed during pre-labelling. Later review/save activity advanced Test1 to revision 3 and Test2 to revision 2.

## ISSUES

- The review gate was closed after the user inspected and accepted the complete pre-label set; D2 still labels the evidence as human-reviewed AI pre-labels rather than expert truth.
- Multi-tab lost updates are now prevented by optimistic annotation revisions; a stale tab fails instead of overwriting newer geometry.
- The current research model produces a segmentation tensor; deterministic vector post-processing into benchmark lines/polygons is the next builder TIP after labels are reviewed.

## DEVIATIONS

- None from the approved evidence architecture.

## SUGGESTIONS

- Completed next step: TIP-50R-D2 froze both annotation hashes and ran the first held-out mask-to-RoadStructure benchmark; the candidate failed its lane/corridor quality gate.
