# Task Graph — DriveSense RoadStructure

| TIP | State | Exit evidence |
|---|---|---|
| TIP-50R-A | VERIFIED | Provenance registry, separate code/weight/data rights, commercial fail-closed audit, Refinery gates/bites |
| TIP-50R-B | VERIFIED | Closed-schema corpus, lane/boundary/drivable/latency scorer, deterministic synthetic CLI/tests |
| TIP-50R-C | VERIFIED (RESEARCH) | OpenVINO artifact pinned and byte-reproducible after canonicalization; operator inventory bound; WebGPU failure and WASM M1 Max pass recorded; commercial gate remains closed |
| TIP-50R-D1 | VERIFIED | Prediction-blind, hash-bound ground-truth workbench; 8 raw local frames; distinct review gate |
| TIP-50R-D2 | VERIFIED — QUALITY FAIL | Reviewed labels frozen by hash; deterministic first held-out run: drivable IoU 0.5949, lane/corridor 0; candidate rejected |
| TIP-50R-D3 | VERIFIED — DEVELOPMENT GAIN, FIELD GATE FAIL | v2 continuity paths + corrected scorer; post-hoc F1 0.0625→0.4444 and corridor 0→0.375; independent source still missing |
| TIP-50R-D4 | LOCAL EXPERIMENTAL UI | User-authorized visualization; real model worker, media-time expiry, lane-only video/camera test; no promotion to risk/metric/field use |
| TIP-50R-D5 | QUIET EXPERIMENTAL HUD | Fixed icon, temporal acquisition/recovery, gray on missing/stale evidence; side-only image-space proximity indication; not validated LDW |
| TIP-50R-D6 | VERIFIED UI LAYOUT | Compact lane icon is anchored to the decoded video's contain rectangle across resize/fullscreen/source-aspect changes; no perception change |
| TIP-50R-D7 | VERIFIED UI CONTROL | In-video distance/lane toggles restore explicit feature control and serialize competing heavy inference; 7/7 browser interactions reverified in STAB-01 |
| TIP-50R-D | IN PROGRESS — CANDIDATE NOT PROMOTABLE | v2 is cleaner and fail-closed, but recall/corridor 0.375 and commercial-rights gates remain open |
| TIP-50R-E | BLOCKED BY D | RoadGraph temporal fusion, 250 ms expiry, ego-corridor abstention invariants |
| TIP-50R-F | BLOCKED BY E | Sparse HUD, lane-departure shadow events, replay/live QA and rollback |

## Promotion policy

1. A code licence cannot clear weights or training data.
2. No source-reported FPS/F1 enters the product scorecard as a comparable measurement.
3. No candidate may enter operational driving/risk HUD before passing quality and rights gates. D4 is an explicit user-authorized local research overlay, separate from risk and metric computation; research eligibility is not commercial eligibility.
4. No field or safety claim may use the synthetic fixture.
5. No physical boundary is silently relabelled as a lane marking.
6. No AI output or overlay may be used as ground truth; task, source and raw-frame hashes must remain exact.
7. Test1/Test2 are frozen after the D2 first run and may not be used to tune D3.
8. D3 results on Test1/Test2 are post-hoc development diagnostics; the next quality decision requires a new source/journey.
