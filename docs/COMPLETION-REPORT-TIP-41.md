# Completion report — TIP-41 DriveSense foundation

Date: 2026-09-13. Sequential Vibecode contractor → builder → contractor review.
Status: **D1/D2 baseline implemented; field accuracy, realtime acceptance and
full safety feature NOT accepted.** D3/D4/D5 remain open.

## Delivered

- R1: separate `drive.html`, video file / opt-in rear camera, no video upload,
  source cleanup, timeline generation guards and seek reset. Main RoboEye modes
  preserved; pre-existing TIP37–39 edits were not reverted.
- R2: validated camera schema, inverse Brown–Conrady, ray/ground intersection,
  pitch/roll, first-order sensitivity, conservative invalid/unknown gates.
- R3: Huber Gauss–Newton mount refinement with held-out check and reject gate.
- R4: existing pinned RT-DETRv2 R18 worker, drive-only low detection threshold,
  two-stage Hungarian association, range/velocity Kalman and age gates.
- R5: bbox/top badge, experimental distance colors, per-track reason/uncertainty,
  independent-reference JSON and bounded observations/timing report. Indexed
  report matching avoids scanning every observation for every reference.
- R6: synthetic analytic replay, 13 new unit groups, opt-in real model smoke page.
  Unknown calibration stays null instead of inferred meters. Real video paused
  on the same frame permits slow analysis; moving streams drop results >1s.

## Evidence

| Check | Result | Scope |
|---|---|---|
| `npm run test:unit` | 87/87 pass | Whole repository incl. 13 DriveSense groups |
| `npm run build` | pass | TypeScript + Vite multi-entry production |
| `git diff --check` | pass | Tracked changes whitespace check |
| `node scripts/verify-release.mjs` | pass | Existing package/release checks; not full DriveSense E2E |
| Fixture fetch + SHA256 | 3/3 verified | Existing T14 corpus, ignored cache only |
| Browser model load | WASM ready on dev and production | First default attempt failed numeric runtime error; explicit WASM retry worked |
| Real bus fixture → model → tracker | pass | Bus score ≈0.958; missing calibration → null range; not accuracy percentage |
| Browser demo | pass | Two boxes/IDs/meter labels; stagger labels; no camera access |
| Browser clear calibration | pass | Tracks remain but no numeric range |
| Browser stop source | pass | 0 tracks, stopped worker, empty intrinsic fields |

Initial cold-ish static-image inference was 1980 ms on this in-app browser.
This is **not realtime acceptance**, not sensor-to-display latency. The smoke
page supports one warmup + three measurements so subsequent runs are repeatable.
Measured repeat run: warmup 2107.6 ms; subsequent 1848.2, 1767.5, 1784.2 ms
(median 1784.2 ms, maximum 1848.2 ms; only three samples). This confirms the slow
path persists after warmup, not just initial model setup. All are static bus-image
worker times at 480×640 input, not road replay or device-independent benchmarks.

Unit coverage includes independent forward projection through 108 geometry
combinations; distortion roundtrip; missing/invalid/clipped/tiny/horizon inputs;
mount-fit outlier and degenerate/holdout rejection; non-greedy assignment;
low-confidence track recovery; stale/missing/reordered time; Kalman outlier/jitter;
reference null metrics/coverage, temporal window and 20k report matching.

## Explicit open gates / risks

- No user road video + independently measured distances supplied. No MAE/P95
  claim on real camera. No live camera or mobile thermal test performed.
- File upload, camera permission/revocation, source-switch while inference,
  media resize and mobile viewport need fuller automated browser coverage.
  Lifecycle is implemented and inspected; do not label unexecuted tests pass.
- RT-DETR WASM timing is inadequate for moving-stream distance HUD on tested
  setup. Measure WebGPU and lighter detector alternatives in D3; do not hide lag
  with stale boxes or lower fail-closed age thresholds.
- Bbox bottom center is not a reliable tire keypoint in every frame. Static
  planar geometry does not compensate road slope, vibration or dynamic pitch.
  Wrong real-world assumptions may still yield plausible wrong meters.
- No bumper-offset model, path/lane/cut-in policy, dynamic ground estimator,
  metric-depth fusion, calibrated confidence interval or FCW/TTC acceptance.
- No offline model package added; first model download requires internet.
- No full app E2E/security audit run this turn; no commit, push or deployment.

Next gate: collect controlled replay/ground truth, benchmark detector and metric
depth candidates under identical conditions, then choose accuracy/latency/license
tradeoff. Do not claim “best open-source algorithm” before this comparison.

Usage: `docs/DRIVESENSE-USER-GUIDE.md`; architecture: `docs/BLUEPRINT-DRIVESENSE.md`;
research provenance: `docs/research/drive-distance/`.

## Commit preparation verification

The DriveSense-only staged snapshot was checked separately from the working
tree's uncommitted TIP37–39 RoboHand changes: typecheck passed and **75/75 tests
passed** with `node --import tsx --test tests/unit/*.test.ts`. The 87-test working
tree result above includes 12 additional RoboHand tests outside this commit.
All 18 immutable research snapshot SHA-256 checks passed. Publisher whitespace
is preserved in raw snapshots via a scoped Git attribute, not rewritten.
