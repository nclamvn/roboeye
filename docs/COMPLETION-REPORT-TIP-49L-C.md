# Completion report — TIP-49L-C depth-order consistency

Date: 2026-09-17

## Contractor verdict

**ACCEPTED for ordinal publication safety after a real browser replay of `Test1.mp4`; absolute metre accuracy remains unaccepted.** The incidents at 10:02, 10:16, 10:21, 10:25 and 10:32 were not stale UI: policy v6 was running, but its normalized `0.012` ground-contact threshold required 8.64 px at 720p. The actual left/right separation was only 5.95 px even though it was visually and numerically resolved. Policy v7 replaces that screenshot-derived gate with a two-source-pixel resolution floor and makes reversed ordering an invariant rather than a tolerated model error. No physical distance ground truth was supplied for these frames.

## Builder delivery

- Added a conservative cross-lane publication invariant for strong, non-truncated detections in the reviewed `car`/`truck`/`bus` family.
- Resolves bottom-contact order in source pixels with a two-pixel floor; apparent vehicle height does not override a resolved contact row.
- Invalidates both learned ranges on any reversed learned-metre order. It does not permit a smaller wrong order onto the HUD.
- Never swaps, averages or synthesizes a replacement distance.
- Applied the same validator to live camera metric results and analysed replay.
- Revalidates the exact post-filter/interpolated tracks before HUD and risk; clears closing speed and range TTC with an unsafe metre.
- Bumped report policy to `ground-contact-publication-invariant-v7`.
- Added `tests/diagnose-drive-runtime.mjs`, which uploads the actual local video through the browser, exports the app report, rebuilds replay and scans both exact and 20 ms interpolated output.
- Updated the user guide and incident report to distinguish contradiction detection from physical metre accuracy.

## Research evidence

- Curated registry: 39 claims / 20 entities or methods.
- Added primary-source evidence for ground-contact/vertical-position cue fusion and ground-plane geometry.
- Raw snapshots re-hashed with SHA-256: all pass.
- Refinery build: `d2fc759b02610d12`; idempotent PASS; auditor PASS.
- Bite suite: positive control PASS and every applicable gate bit correctly.

## Verification

| Gate | Result |
|---|---|
| 10:02 screenshot `70/56` | PASS — both inverted values become unknown |
| 10:16 screenshot `57/52` | PASS — equal-height pair is caught by contact ordering |
| 10:21 screenshot `51/45` | PASS — car/truck subclass flicker cannot bypass ordering |
| 10:25 final HUD `51/43` | PASS — post-Kalman publication is revalidated |
| 10:32 actual `Test1.mp4` frame-0 trace `51.226/44.677` | PASS — exact source pixels reproduce and reject the defect |
| Correct `56 m / 70 m` ordering | PASS — values remain unchanged |
| Contact separation below 2 source pixels | PASS — no ordinal claim |
| Different apparent vehicle height | PASS — cannot override resolved ground contact |
| Non-vehicle label | PASS — remains outside vehicle-family policy |
| Edge-truncated vehicle | PASS — no ordinal claim |
| Real browser replay, 50 sample frames | PASS — 0 exact inversions |
| Display scan every 20 ms, including interpolation | PASS — 0 displayed inversions |
| Full unit suite | PASS — 177/177 |
| TypeScript | PASS — `tsc --noEmit` |
| Production build | PASS — Vite 7.3.6 |
| Diff hygiene | PASS — `git diff --check` |
| Security policy | PASS — 0 critical; two reviewed `sharp` advisories, no sharp/libvips source or browser-bundle exposure |

## Residual risk and next gate

The change increases precision of the metres that are shown by reducing unsafe coverage: on this 19.5 s clip, published measured observations fell from 130 under v6 to 60 under v7. It does not recover the true distance and deliberately shows `Chưa đo` for both members of a contradiction instead of swapping or fabricating metres. The next accuracy TIP must A/B the current model with a camera-aware challenger and a calibrated ground-contact/ground-plane estimate on independent physical references, reporting MAE, bias, P95, inversion rate and coverage by range bucket.
