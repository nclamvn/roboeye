# COMPLETION REPORT — TIP-49L-B

**Date:** 2026-09-17
**Builder status:** DONE
**Contractor verdict:** ACCEPTED for deterministic offline planning/profiling;
the real-clip throughput gate was closed on 2026-09-20.

## Outcome

Uploaded video no longer has one hidden fixed workload. The operator chooses Detail (5 Hz), Balanced (2.5 Hz, default) or Fast (1 Hz) before analysis. For a three-minute video those plans schedule 901, 451 or 181 samples respectively while retaining time zero and the decodable timeline tail.

The existing ordered overlap is preserved: detector work for the next timestamp may overlap depth for the prior timestamp, but depth pixels are snapshotted before the next seek. The resulting replay retains the plan that produced it, and the JSON report exports the explicit tradeoff plus detector/depth/seek/sample-wall timing.

An exact in-memory session cache avoids repeating an unchanged run for the same browser `File` object, preset, backend choice and model hashes. It is tab-local, stores analysed samples rather than video bytes and never labels cache reconstruction as measured inference throughput.

## Delivered files

- `src/drive/offline-plan.ts`
- `src/drive/replay.ts`
- `src/drive/analysis-job.ts`
- `src/drive/app.ts`
- `drive.html`
- `src/drive/drive.css`
- `tests/unit/drive-local-workbench.test.ts`
- `tests/unit/drive-replay.test.ts`
- `docs/TIP-49L-B-OFFLINE-ACCELERATION.md`

## Acceptance coverage

| Criterion | Result |
|---|---|
| Three-minute plans are exactly 901 / 451 / 181 samples | PASS |
| Unsupported/non-integral sampling steps fail closed | PASS |
| Timeline start/tail preserved | PASS |
| Plan is attached to completed replay/report | PASS — implementation review and typed build |
| Detector/depth overlap stays ordered and same-frame | PASS — existing offline-pipeline regression |
| Exact session cache includes preset/backend/model hashes | PASS — implementation review |
| Cache does not fabricate throughput | PASS — throughput fields are null on cache hit |
| Report exposes P50/P95 detector, depth, seek and sample-wall timing | PASS — schema v7 implementation review |

## Verification evidence

| Gate | Result |
|---|---|
| Focused DriveSense scenarios | PASS — 39/39 |
| Full unit suite | PASS — 171/171, 0 fail |
| TypeScript check | PASS |
| Production build | PASS — 67 modules transformed |
| Security audit | PASS — 0 critical/high; Sharp exposure 0 |
| Diff hygiene | PASS — `git diff --check` |

## Honest performance status

The scheduled inference count is reduced by 50% in Balanced and about 80% in Fast relative to Detail for a three-minute clip. That is a workload reduction, not a measured wall-clock speedup claim: decode, model startup, backend and per-frame detector/depth time still matter.

The two user-selected clips were rerun under all three presets on 2026-09-20;
their bytes and screenshots remain outside the repository. On the 186.7-second
clip, Detail/Balanced/Fast completed in 165.4/41.0/23.8 seconds. Balanced was
observed 4.0× faster and Fast 7.0× faster than Detail. Across all six runs,
depth failures and dropped results were zero.

This closes the missing empirical throughput gate, not the accuracy gate. Fast
retained only 79 metre-bearing observations on the long clip versus 350 for
Balanced and 717 for Detail; it can miss short events as disclosed. The
hash-bound, privacy-preserving evidence is in
`docs/evidence/TIP-49L-B-REAL-CLIP-PROFILE-2026-09-20.json`.
