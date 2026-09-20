# Verify Report — TIP-50R-D3

## Requirement coverage

- Total requirements: 9
- Implemented: 9
- Missing: 0
- Deferred inside TIP: 0
- Coverage: 100%

## Scenario results

| Scenario | Result | Severity if failed |
|---|---:|---:|
| Continuous four-class corridor remains supported | PASS | P0 |
| Dashed curved corridor beats adjacent-lane switching | PASS | P0 |
| Short/horizontal evidence abstains | PASS | P0 |
| Competing equivalent paths abstain | PASS | P0 |
| Empty/invalid shape fails closed | PASS | P0 |
| Polyline resampling and point order do not alter matching | PASS | P0 |
| v1/v2 reports disclose evidence class | PASS | P0 |
| Corrected same-scorer before/after run completes 8/8 frames | PASS | P0 |

## Technical health

- TypeScript: PASS, 0 errors.
- Unit: 200/200 PASS.
- Focused D3/scorer: 9/9 PASS.
- Browser/WASM reports: v1 and v2 completed 8/8 frames.
- Build: PASS.
- Security audit: PASS; 2 high `sharp` advisories are time-bounded accepted risks, and source/browser-bundle exposure remains 0.
- `git diff --check`: PASS.

## Critical findings

1. D2's original point-to-point line metric was sample-density biased. Its
   `0/16` historical result remains immutable but is deprecated for line-quality
   comparison. Corrected v1 is `1/16`.
2. D3 improves corrected F1 from `0.0625` to `0.4444`, but recall and complete
   corridor recall are only `0.375`.
3. The two clips were already observed while designing D3. Their improvement is
   post-hoc development evidence and cannot authorize promotion.
4. Synthetic validation proves algorithm contracts, not Vietnamese-road field
   performance.

## Overall status

READY for research codebase integration and a new independent validation/test
cycle. NOT READY for RoadGraph, HUD, safety, realtime or commercial claims.
