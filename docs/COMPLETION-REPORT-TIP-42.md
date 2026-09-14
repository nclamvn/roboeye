# Completion report — TIP42 DriveSense replay PoC

Date: 2026-09-13. Sequential Vibecode: focused scan → scoped TIP → implementation
→ unit/build → actual-video browser acceptance. Full driving safety acceptance
is separate from recorded-video functional acceptance.

**Follow-up correction (TIP43):** The user's sign-as-vehicle report exposed
incorrect focal-model decoding and cross-class duplicate/weak-track retention.
The playback/export observations below remain a historical functional record,
NOT evidence that detection quality passed. See TIP43 for fixes and revalidation.

## Changes

Created `src/drive/replay.ts` and `tests/unit/drive-replay.test.ts`. Modified
DriveSense app, HTML, CSS, user guide and shared detection worker error reporting.
Existing RoboHand modifications left untouched.

- Local video selection automatically loads detector, then analyses decoded frames
  at 5Hz into a bounded cache (maximum 120s/601 samples).
- Fresh-worker WASM retry once after failed default initialisation. Raw errors now
  preserve attempted backend/dtype rather than only the final numeric exception.
- Native playback uses timestamped samples. Same-ID adjacent bbox interpolation
  is explicitly labelled; gaps/different IDs are never silently bridged.
- Missing calibration no longer visually implies a failed detector: positive boxes
  remain cyan, while metric labels say `chưa đo` and explain missing information.
- Profile changes recompute cached ranges without new inference. Reports preserve
  real AI samples, model/backend, per-frame latency and total analysis time.
- Cancel, stop, file change, generation guards and decoded-seek abort handling.

## Executed technical checks

- 93/93 whole working-tree unit tests pass (includes user's uncommitted RoboHand
  test changes). DriveSense subset 19/19: 13 baseline + 6 replay groups.
- Build/typecheck pass. Existing release verifier passes. `git diff --check` pass.
- New replay tests: bounded sample timeline/tail, calibration recomputation,
  non-mutating interpolation, no cross-ID/missed-frame/long-gap fabrication,
  deterministic seek boundaries, invalid range suppression, decoded-seek abort.
- No new package dependency. No camera permission used. No video added to repo.

## Browser verification log

Input: user's existing `/Users/os/Downloads/Videotest1.mp4`, locally selected.
Chrome extension chooser was denied file URL access; no permission was changed.
The integrated browser chooser worked normally, without uploading the clip.

First run reproduced default model load error; fresh WASM worker succeeded.
Analysis reached 33/99 frames; Cancel stopped the job and did not expose a partial
replay as complete. A fresh run on the updated production build required only
selecting the video: it automatically retried WASM and started the 99-frame job.

Updated-build automatic run completed 99/99 decoded samples, timestamp 0–19450ms
for the 19.5s clip, in 181821.8ms (UI rounds to 182s). The selected backend was
WASM. Actual-video screenshot showed cyan vehicle boxes and `chưa đo` labels;
these were not synthetic demo boxes. Native playback advanced to 7.493s, and the
display switched to explicitly labelled adjacent-sample interpolation. Home/End
seeking reached 0/19.5s with the same completed cache, without another AI run.
Stopping the model preserved replay: video reached its end with eight cached
tracks, and a subsequent playback advanced to 4.925s while backend read `AI chưa
tải`. The deliverable browser tab was finally paused at 0s with six tracks and
the completed 99-sample cache, ready for the user to press Play.

UI export produced `/Users/os/Downloads/drivesense-report.json`, inspected locally:
version 2, `analysed-replay`, RT-DETRv2 R18/WASM, 99 raw samples, 897 tracked sample
observations, 22 unique track IDs, zero dropped results. Capture-to-result median
1753.4ms; P95 1938.5ms. These are processing timings, not camera/display latency.
The clip has no labelled detection ground truth: counts are not accuracy scores,
and 22 track IDs do not establish 22 distinct physical vehicles. Visual inspection
also shows dense labels around distant vehicles; class/ID continuity is not yet
independently scored.

Profile and all distance values remain null; references=0, metric coverage/MAE/
bias/P95 error remain null. No fabricated metric warning was shown. Export is
kept outside the repository alongside the user's local files, not published.
Input SHA256: `83a2ee31d6bbdd205531f5c684b29d23d2573011ac988b12efb8058ffb9de93f`.

Responsive test during analysis: 375×812 viewport, document scrollWidth=375px
(no horizontal overflow), video and stage both 347px wide, source remains
1280×720. Progress/cancel/transport remain visible. Viewport override reset after
test. This is layout testing, not a mobile-device inference/thermal benchmark.

## Contractor verification / acceptance

| Requirement | Evidence / status |
| --- | --- |
| P1 automatic workflow | Pass: actual file selection → automatic fresh WASM recovery → 99/99 ready; cancel exercised at 33 samples, then a new run completed. |
| P2 bounded decoded sampling | Pass: unit bounds/seek/abort tests plus real 0–19450ms exported sample timeline. |
| P3 replay / seek | Pass: native playback and Home/End seek preserve cache; interpolation/gap/ID rules covered by units. No realtime inference claim. |
| P4 lifecycle | Partial browser coverage: cancellation and clean-worker recovery exercised; source-generation/error guards reviewed and seek-abort tested. Camera and rapid cross-file races not browser-tested. |
| P5 calibration separation | Pass for unknown state and pure recomputation tests. Real calibrated metre accuracy remains OPEN; no measured profile supplied. |
| P6 truthful report | Pass: exported JSON inspected; backend, mode, timings and null accuracy fields match this run. |
| P7 actual-video verification | Pass: user's clip locally analysed, played, sought and exported; technical checks above pass. |

Technical health: build, typecheck, release verifier and 93 working-tree unit tests
pass; no additional dependencies. Existing unrelated RoboHand changes preserved.
Overall: recorded-video detection/replay PoC is demonstrable locally. **Full
distance-warning PoC is NOT accepted yet**: it needs independent measured camera
calibration/ranges, detector/tracker scoring and performance validation on target
hardware. No commit, push or deployment performed in this task.

## Known limits / separate acceptance

- Processing before playback does not speed up inference. It makes a useful
  recorded-video PoC without pretending WASM is realtime.
- No independently measured range/calibration supplied for this video. Meter
  accuracy, road pitch compensation, tyre-contact localization, lane/cut-in,
  TTC/FCW and public-road safety remain unaccepted.
- Calibration geometry still assumes a flat road and stable mount; plausible wrong
  values are possible if those assumptions fail. No safe-driving decision support.
- Cache is in-memory only; reload/source change loses it. No offline model pack,
  model bake-off winner, persistent video store or remote inference added.
- Shared model error diagnostics changed; no detector threshold/weights changed.

Model/runtime reference checked this turn:
[RT-DETR ONNX card](https://huggingface.co/onnx-community/rtdetr_v2_r18vd-ONNX/blob/main/README.md),
[Transformers.js dtypes](https://huggingface.co/docs/transformers.js/guides/dtypes).
Documentation is not evidence of measured latency/accuracy on this device.
