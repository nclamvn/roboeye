# TIP-47A — independent validation corpus contract and scorer

## HEADER
- Project: RoboEye / DriveSense
- Module: field-validation foundation
- Depends on: approved PoC blueprint and TIP-46
- Priority: P0
- Scope: evidence tooling only; no vehicle-facing behavior change

## CONTEXT

`src/drive/benchmark.ts` accepts externally supplied model track IDs, so it does not by itself independently score detection, ID continuity or range on a labeled drive. There is no held-out journey/device manifest. TIP-46 recommends this as the next gate. No physical truth clips are present in the repository.

## TASK

Implement a strict, pure evaluation contract for a journey-split validation corpus and a CLI that scores a file of truth and predictions. The scorer must associate objects by timestamp + box overlap, not by copying the model track ID into the truth. Add a clearly synthetic fixture and deterministic tests; never publish synthetic scores as field quality.

## SPECIFICATIONS

1. Each journey declares a unique ID, split (`train|validation|test`), device/camera IDs, image dimensions, truth method, distance kind, rights/provenance and scenario tags. Reject missing, invalid, duplicate or mixed-split IDs; do not embed video bytes.
2. Truth objects have independent object IDs, normalized boxes and optional distance. Predictions have their own track IDs, boxes, optional distance of an explicit kind and request/result latency. Distance definitions must match before an error can be computed.
3. Within each journey, match one-to-one at a bounded timestamp tolerance and IoU gate. Count every truth object as a recall/coverage denominator, every unmatched prediction as FP; an unknown/mismatched-kind distance cannot enter MAE.
4. Report detection precision/recall, distance coverage/MAE/bias/P95 by predefined bins, ID switches, abstentions and latency P95, including honest nulls for absent truth. No scale fitting, target filtering after seeing results or random frame-level split.
5. CLI reads local JSON and emits machine-readable JSON; errors use nonzero exit. Synthetic fixture is labelled as algorithm test only. No raw/video/PII upload, model or external dependency.

## ACCEPTANCE CRITERIA

- Given truth IDs unrelated to model IDs, when boxes overlap at matching times, then scoring succeeds without consulting equal ID values.
- Given one missed truth and one roadside false positive, then recall and precision denominators include both.
- Given unknown or incompatible distance kinds, then distance coverage/quality do not invent metres.
- Given a track ID switch across one true object, then switch count increments once.
- Given duplicate journeys, split leakage, invalid coordinates, NaN or absent rights, then validation fails loudly.
- Given a synthetic fixture, the CLI produces deterministic expected numbers and clearly states it is not field evidence.
- Unit suite, typecheck/build if available, and diff hygiene are reported; pre-existing dirty files are preserved.

## CONSTRAINTS

Do not modify the driving HUD, detector, risk thresholds or current report schema in this TIP. Do not infer physical accuracy without independent field truth. Do not import user video or prepare an external model. Builder writes a completion report; Contractor verifies scoped output separately.
