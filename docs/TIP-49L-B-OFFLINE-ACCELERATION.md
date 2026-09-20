# TIP-49L-B — explicit offline acceleration and profiling

## HEADER

- Project: RoboEye / DriveSense
- Role split: Contractor specifies and verifies; Builder implements
- Depends on: current full-timeline offline detector/depth overlap
- Priority: P0 software-first
- Scope: local uploaded video only

## CONTEXT

The earlier fixed 5 Hz plan requests 901 detector samples for a three-minute clip, with depth on every eligible detection. On the current M1 Max this can take close to one hour. The bottleneck is repeated model inference plus video seeking/decoding, not file upload. Reducing work invisibly would make results incomparable, so speed must be an explicit, reportable quality tradeoff.

## TASK

Add deterministic analysis presets, preserve the complete timeline, profile detector/depth/seek/wall time and reuse only an exact in-session result for the same browser `File` object and model/backend configuration.

## PRESETS

| Preset | Step | Three-minute clip | Meaning |
|---|---:|---:|---|
| Detail | 200 ms / 5 Hz | 901 samples | Existing density; slowest |
| Balanced | 400 ms / 2.5 Hz | 451 samples | Half the scheduled inference count |
| Fast | 1000 ms / 1 Hz | 181 samples | Speed-first; can miss short events |

Every plan includes time zero and the final decodable tail. Interpolation remains display-only and cannot bridge a recorded miss or fabricate metres.

## ACCEPTANCE CRITERIA

1. Preset selection is visible before analysis and remains attached to the resulting replay/report even if the UI selection later changes.
2. A three-minute clip deterministically produces 901, 451 or 181 scheduled samples as documented.
3. The detector/depth overlap stays ordered and snapshots depth pixels before the next seek, preventing cross-frame contamination.
4. The report includes preset, step, sample rate, cache status, detector/depth P50/P95, seek P50/P95, sample-wall P50/P95, elapsed time and media/processing ratio.
5. Cache is memory-only, scoped to the exact `File` object plus preset/backend/model hashes, and stores no video bytes outside the current tab.
6. Cache reuse never reports fabricated processing throughput.
7. Automated tests prove the plan/cache-adjacent contracts; actual speedup claims require rerunning the operator's real clips and comparing exported reports.
8. Unit tests, typecheck, production build, security audit and diff hygiene pass.

## NON-GOALS

- No claim that a lower sample rate improves model inference speed per frame.
- No frame skipping hidden from the operator, no persistent browser cache and no video upload.
- No realtime or field-accuracy claim from offline throughput.
