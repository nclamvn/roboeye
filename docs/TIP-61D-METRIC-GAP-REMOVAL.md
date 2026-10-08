# TIP-61D — Remove evidenced mobile metric gaps

Approved: owner's 2026-10-08 instruction “triển khai xoá gap như phân tích và đề xuất”. Contractor and Builder roles executed sequentially using Vibecode Kit v6.2.

## Scope and evidence

Depends on TIP-61R and the owner report SHA-256 `de9b54013220c0ce7a09ee607fac61ca4ec541f5a8802e9b43472688ce410932`.
The observed WebGPU sessions produced 35 depth results: 15 accepted, 15 ROI-rejected, 2 binding-rejected, 3 stale. HUD admission availability was 12.83%. This is not a missing-GPU diagnosis. Exact rejected object subgates were not recorded.

## Requirements / execution order

1. D1: bounded, pixel-free per-object extraction/policy/binding/filter/publication records, plus immutable capture/source/model/transform identity. Cumulative reason accounting survives detail eviction. Old journal imports remain readable.
2. D2: independently export a **static portrait 224×392** graph from the same pinned outdoor metric weights, compare ONNX with native output, pin actual byte count/hash, stage locally. Select shape from decoded source geometry (not CSS). Reset in-flight measurements and load the matching graph on orientation change. No transpose/reshape shortcut and no silent landscape fallback.
3. D3: diagnose central connected depth support versus mixed/occluded interior patches; this is a depth-support heuristic, NOT semantic segmentation or proven tyre contact. Add robust temporal continuity at variable cadence, explicit outlier abstention without filter amnesia, workload/deadline-aware scheduling. Preserve conservative cross-vehicle publication checks until independent road-plane evidence exists.

## Acceptance / verification

- Every completed joined attempt explains each eligible object's terminal stage/code and records raw/policy/filter/published metre values or explicit nulls. Late/reset results cannot become accepted.
- Detail/pending/object counts and stored report bytes stay bounded; no images, location or hardware identifiers. Unknown terminal failures remain explicit rather than guessed.
- Portrait and landscape each pass native/export numeric parity; portrait uses ~98% rather than ~32% input area at 720×1280. Worker rejects incompatible shape and model identity. Rotation/source change invalidates old measurements.
- Mixed-depth, centre occlusion, insufficient samples, zoom/crop, reversed ordering, weak/missed observations, stale measurements and abrupt jumps have regression tests; unknowns do not drive alerts.
- Constant synthetic depth/timing tests are labelled mechanism tests, never physical-device or distance accuracy evidence. Test actual browser workers separately from mocks.
- Typecheck, unit suite, production build, browser orchestration/recovery/journal/regression and release checks pass, or report concrete limitations.

## Invariants / exclusions

Keep capture TTL **1200 ms**, strong score threshold and immutable same-frame binding. Never generate fresh metres from overlay prediction, never swap distance labels, never infer phone focal length or fabricate calibration. No new paid API, cloud upload, hardware purchase, native rewrite, public-road test, Git push or deploy in this TIP. Model assets can be exported/staged locally; no invented release URL for the portrait asset.

Physical iPhone performance, independent 3–50 m truth and sustained thermal/coverage targets remain separate unpassed gates. If browser DA2 still cannot meet them, report the failed gate before pursuing an approved model bake-off/native phase.
