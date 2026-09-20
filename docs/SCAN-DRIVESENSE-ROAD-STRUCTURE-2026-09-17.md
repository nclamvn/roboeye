# SCAN REPORT — DriveSense RoadStructure

Date: 2026-09-17. Scope: focused scan for lane/road-boundary perception. This does not change or certify the existing vehicle-range pipeline.

## TECH_STACK

- Strict TypeScript, Vite, browser workers, ONNX Runtime Web with WebGPU/WASM paths.
- Existing hot path: RT-DETR vehicle detector → tracker → range evidence → risk/HUD.
- Existing evidence path: closed-schema local corpus, deterministic scorer, unit tests and CLI.

## REUSE

- `src/drive/validation.ts`: rights-aware, journey-split corpus pattern.
- `src/drive/live-telemetry.ts`: bounded-age telemetry pattern.
- `src/worker/drive-detect-worker.ts`: one-in-flight browser worker pattern.
- `scripts/evaluate-drive-corpus.ts`: local, machine-readable benchmark CLI pattern.
- `docs/research/`: provenance snapshots and fail-loud registry pattern.

## GAPS

1. No lane, drivable-area, curb, median, barrier or guardrail contract.
2. No same-corpus benchmark for line quality, road-area IoU, ego-corridor completeness, temporal jitter or stale evidence.
3. No separation between code licence, pretrained-weight rights and training-dataset rights for road models.
4. No browser operator-compatibility evidence for candidate ONNX graphs on the M1 Max.
5. No Vietnamese road-structure corpus with rights, route/session holdout and difficult cases.

## HEALTH / CONSTRAINTS

- The working tree contains active DriveSense and RoboHand changes; RoadStructure must be additive and must not reset them.
- Current distance publication deliberately abstains when ground-contact ordering conflicts; RoadStructure must consume, not weaken, that invariant.
- No model may reach a commercial build from a repository licence alone. Code, weights and training data are separate release gates.

## RECOMMENDED FIRST SLICE

TIP-50R-A: provenance/rights registry. TIP-50R-B: strict benchmark corpus and scorer. Actual model export/integration follows only after those gates pass.
