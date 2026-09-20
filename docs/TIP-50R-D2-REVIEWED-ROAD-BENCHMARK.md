# TIP-50R-D2 — Reviewed RoadStructure benchmark

## Header

- Project: RoboEye / DriveSense
- Module: RoadStructure evidence
- Depends on: TIP-50R-B, TIP-50R-C, TIP-50R-D1
- Priority: P0 evidence gate

## Task

Turn the pinned four-class road-segmentation mask into deterministic typed
RoadStructure geometry, run it on the exact reviewed local frames, and score the
result through the existing closed benchmark contract. The first held-out run is
immutable evidence: its vectorizer must not be tuned after reading the reviewed
coordinates.

## Acceptance criteria

1. Only `reviewed` annotations with matching task, source and image hashes enter
   the corpus.
2. Model, task and annotation bytes are identified by SHA-256.
3. Preprocessing is explicit: BGR, `0..255`, `1×3×512×896`, direct resize.
4. Post-processing is deterministic and receives only the four-class label map.
5. Every miss and false positive remains in the line/corridor denominators.
6. The report records quality, latency, staleness, provenance limitations and
   renders one diagnostic preview per frame.
7. A poor result is recorded as a failed quality gate; it is never hidden by
   changing the metric or tuning on the held-out test split.

## Fixed first-run method

- Drivable area: scan road/mark pixels by row, take robust left/right extents and
  simplify the resulting polygon.
- Ego lines: extract class-3 mark components per row and choose the component
  closest to image centre on each side; bin and median-smooth the samples.
- Timing: browser/WASM session, one thread, same canonical OpenVINO ONNX used by
  TIP-50R-C/D.

This deliberately simple method was fixed before the first reviewed run. The
result exposes its failure mode: dashed markings cause row-wise association to
switch between physical lanes, creating discontinuous lateral jumps. Further
work therefore belongs to a new validation/tuning split and a new TIP, not a
rewrite of this result.

## Reproduction

```bash
npm run benchmark:road-reviewed -- \
  --model /private/tmp/roboeye-openvino-canonical/road-segmentation-adas-0001.onnx \
  --task-dirs /private/tmp/roboeye-road-gt-test1-v2,/private/tmp/roboeye-road-gt-test2-v2 \
  --out /private/tmp/roboeye-road-tip50r-d2-r1 \
  --vectorizer v1
```

The raw media and reviewed task directories are intentionally local-only.

## Result and decision

| Metric | First held-out result | Decision |
|---|---:|---|
| Drivable mean IoU | 0.5949 | Useful research signal; insufficient alone |
| Lane matches | 0 / 16 | FAIL |
| Lane precision / recall | 0 / 0 | FAIL |
| Ego-corridor recall | 0 | FAIL |
| Inference p50 / p95 | 178.3 / 233.3 ms | Low-frequency research only |
| Stale-frame rate (`>250 ms`) | 0 | PASS for these eight samples |

TIP-50R-D2 is complete as a measurement slice, but the candidate fails the
RoadGraph/HUD promotion gate. TIP-50R-E remains blocked.

## Next controlled slice

TIP-50R-D3 must create a separate validation split and replace row-local nearest
selection with continuity-aware component association (graph/dynamic
programming), curve fitting with confidence, dashed-gap bridging and temporal
tracking. The current two clips stay frozen as test evidence and must not become
the tuning set.
