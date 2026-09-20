# Completion Report — TIP-50R-D2

## Status

IMPLEMENTED AND MEASURED — QUALITY GATE FAILED.

The reviewed benchmark executed end to end on eight hash-bound frames. The
implementation is reproducible and fail-closed, but its lane geometry is not
good enough for RoadGraph or HUD integration.

## Evidence identity

| Item | SHA-256 / revision |
|---|---|
| Canonical ONNX | `be0ceeb002af577936e9b439b7194dc8df6c8e5bc84ecb9bbfcab68695c86d17` |
| Test1 task | `fbf30839fb1cc1f77c1c6671ac998487b085ff4793a2feadf7e2b99d55444123` |
| Test1 reviewed annotations | `592632c73da69ce115ba761e93a6baaa0895474def5f4a85c064678eb39e7b4b`, revision 3 |
| Test2 task | `7b6b4ebdc93f71eed7ac900444041a230b24ab392d5c0386192074c17a54db52` |
| Test2 reviewed annotations | `7b2399affcc10ce75317f1f3865ca7663d7b835f4d7a81fe5b545e40c8dbb3fd`, revision 2 |
| Vectorizer source | `4919bd43957857ff97665a55d94d88d9e6aedfd48fce02139aaac58ae39fc036` |
| Runner source | `2d1680e2c2e1a2c33d18b4ccc5565cda7dc5231d525e09a640385f1d8c747750` |
| Report | `837f22e76d5bb1ffba1306b7233d40f0877be32707929d855c882d3be0a48732` |
| Corpus | `008703285df9fff63c185c2b30d76a99a6a293a036c3a06502551c13ac7190c5` |

Both annotation sets were accepted by the human reviewer. They began as AI
pre-labels and are therefore explicitly classified as
`human-reviewed-ai-prelabels-local-research-only`, not independent expert truth.

## Measured result

| Scope | Drivable IoU | Lane match | Corridor recall | WASM p50 / p95 |
|---|---:|---:|---:|---:|
| Test1 | 0.5766 | 0 / 8 | 0 | 178.4 / 233.3 ms |
| Test2 | 0.6133 | 0 / 8 | 0 | 175.2 / 179.6 ms |
| Aggregate | 0.5949 | 0 / 16 | 0 | 178.3 / 233.3 ms |

All eight prediction frames were fresh under the benchmark's 250 ms gate.

## Root cause

The segmentation model emits road and marking evidence on all frames. The first
vectorizer, however, performs independent nearest-to-centre selection per image
row. Dashed gaps, neighbouring lane marks and perspective convergence make the
selected component switch identity. The resulting polylines contain large
lateral segments and fail the 20 px symmetric geometry gate. This is a topology
and association failure, not a missing-frame, review, UI or model-load failure.

## Files delivered

- `src/drive/road-vectorizer.ts`
- `scripts/benchmark-road-reviewed.ts`
- `tests/unit/road-vectorizer.test.ts`
- package command `benchmark:road-reviewed`
- eight local prediction previews plus machine-readable corpus/report under
  `/private/tmp/roboeye-road-tip50r-d2-r1`

## Verification

- Unit: 196/196 PASS.
- TypeScript: PASS.
- `git diff --check`: PASS.
- Real browser/WASM benchmark: completed on 8/8 reviewed frames.
- Promotion: FAIL-CLOSED; no RoadStructure output is connected to the driver HUD.

## Decision

Do not tune this vectorizer on Test1/Test2. Freeze the result and open TIP-50R-D3
with a separate validation set for continuity-aware path association. TIP-50R-E
and TIP-50R-F remain blocked.

## D3 metric amendment

D3 found that the original scorer used nearest sampled **point-to-point**
distance, so equivalent polylines with different sample counts could exceed the
20 px gate. The original report and hash remain preserved as historical
evidence, but its line-quality result is deprecated. A sampling-invariant
point-to-segment rescore gives D2 v1 `1/16` matches, F1 `0.0625`; the rejection
decision is unchanged. See `docs/COMPLETION-REPORT-TIP-50R-D3.md`.
