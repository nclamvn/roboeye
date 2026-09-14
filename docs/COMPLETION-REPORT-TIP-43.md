# TIP43 — DriveSense decode correctness / debug report

Date: 2026-09-13. STATUS: PARTIAL for the user's full distance-PoC goal;
the scoped decoding/duplicate/evidence-lifetime defects are fixed and verified.

## Root cause, with evidence

1. Installed Transformers.js 3.8.1 RTDetrImageProcessor delegates to generic DETR
   post-processing (verified both source and browser distribution). That routine
   softmaxes each query and drops the last class as background. The selected
   RT-DETRv2 config uses focal loss and has 80 foreground classes. The official
   Python v4.50.3 decoder instead uses sigmoid and top num_queries over all
   query/class pairs. A negative query [-8,-12,-13] illustrates the failure:
   generic softmax can return >97% for an object whose sigmoid score is <0.001.
   This is an integration defect, not proof that the model needs more training.
2. Per-class NMS lets near-identical car/truck boxes enter separate tracks.
   Original 99-sample local export contained 235 cross-class vehicle pairs at
   IoU≥0.85 / scores≥0.45, in all 99 samples. At t=0 three cars each had a second
   truck label (six tracks). This is not six physical vehicles.
3. No camera profile is supplied: all exported ranges and metric accuracy are
   null. A correct 2D rectangle does not determine metric scale by itself. The
   current UI lacks automatic/easy guided calibration. That is a product gap;
   the user should not have to discover it after opening a clip.

These defects explain why earlier box/playback-only acceptance was insufficient.
The exact sign in the user's screenshot needs visual re-check after fresh
inference. Do not infer that all false positives disappear from code/tests alone.

## Changes

Created `src/drive/detector-decode.ts`: focal decoder + instance-local validated
adapter. Installed only for DriveSense RT-DETR in the existing worker. Normal
RoboEye detection and OWL-ViT decoding unchanged, no node_modules edits.
Created `src/drive/vehicle-candidates.ts`: near-identical cross-vehicle hypothesis
suppression before tracking (IoU≥0.85, no containment-only suppression).
Modified tracking, report metadata and user guide. Created 8 unit groups.

First run held model, weights, dtype choices and thresholds unchanged: 0.15
candidate score, 0.45 track birth. It exposed another defect: low-score association
can perpetuate an old positive label indefinitely. Example new ID9 was born at
0.463/0.461 and kept at 0.18–0.425 through multiple seconds. R6 then added bounded
strong-evidence confirmation: two adjacent ≥0.65 samples or one ≥0.85 sample,
400ms weak grace; weak updates cannot produce a metric range. This deliberately
trades small/occluded vehicle recall for fewer unsupported positives. Thresholds
are conservative operating choices, not a statistically calibrated optimum.
No hand-coded exclusion region targeting the screenshot.
No camera numbers invented, no video added to repo, no commit/push/deploy.

## Executed checks

- Typecheck: PASS (0 errors). Build: PASS. Release verifier: PASS.
- Unit tests: 101/101 PASS whole dirty working tree, including unrelated pre-existing
  RoboHand tests. Drive subset: 27/27 PASS. `git diff --check`: PASS.
- Decoder fixtures: analytical sigmoid scores, last class, global top-K, target
  scaling, batch handling, finite/shape/threshold failures, instance isolation.
- Candidate fixtures: competing labels collapse, distinct adjacent/contained
  vehicles remain, non-mutating selection, invalid candidates rejected.
- Confirmation fixtures: weak flash does not birth a track; two adjacent strong
  observations confirm it, a missed observation breaks the tentative streak;
  weak associations preserve ID briefly but cannot refresh strong-evidence time.
  A previously calibrated strong track immediately loses its metre estimate on
  weak input. Old stale-data test now expects no track past the evidence window,
  rather than an indefinitely retained box with null distance.
- Optional native Node full-library diagnostic did not complete and was cancelled;
  no native-model result is claimed. Installed source/browser-bundle inspection,
  pure analytical tests and actual browser inference provide the reported evidence.
- Actual production bundle tested: `drive-BdT8NPbn.js`, new worker
  `detect-worker-DfSLaOXs.js`. Fresh local video selection, clean WASM retry, fresh
  99-sample analysis; no old decoded score conversion or old cache reuse. Final
  policy build `drive-BllfR-mT.js` uses the same corrected decoder worker.

## First corrected run and refinement

Export `/Users/os/Downloads/drivesense-report (1).json`, 99 samples, 188540.5ms
analysis, P95 capture-to-result 2038ms, 528 sample-track observations/14 IDs versus
897/22 before. Corrected decoder and v1 duplicate policy recorded in JSON.
Near-identical conflicting vehicle output pairs reduced to zero. t=0 has three
visible real cars and three boxes, not three additional truck duplicates.
At 17.55s the large left billboard has no truck box, but weak small hypotheses
still appear around other objects/occlusion; this is why refinement R6 was needed.

Reprocessing this run's raw samples with v2 confirmation (no extra inference,
explicitly not a fresh model result) gives 305 sample-track observations. At 10s
three strong cars remain and ID9 truck/sign hypothesis disappears; at 17s two
strong cars remain. At 19s a third partially visible car has sufficient evidence.
Counts alone are not detection precision/recall. Full new-build UI verification
is being run separately, not assumed from this CLI result.

## Final real-video verification

Fresh production run in integrated browser, same local Videotest1.mp4, completed
99 samples in 235465ms, P95 capture-to-result 2471.6ms, zero dropped results.
This run was slower than the preceding run; no speedup is claimed. Export via
the normal UI created `/Users/os/Downloads/drivesense-report (2).json` with the
correct decoder and `vehicle-exclusive-confirmed-v2` policy markers. Original
and intermediate reports remain untouched. Final export contains 305 sampled
track observations, five IDs, zero near-identical output pairs, null profile and
zero metric distances/references. Independently rebuilding replay from this
export gives exactly 305 observations. Counts/IDs are not precision/recall.

Visual acceptance: t=0 three visible cars have three boxes; t=9.75s the three
clear cars retain boxes and the roadside signs are not boxed; t=17.55s only the
two clear cars are boxed, with no truck box on the left billboard and no weak
small extra hypotheses seen in the earlier run. This is selected-frame visual
verification on one clip, not a scored dataset or an all-scenes guarantee.
Native seeking preserves analysed replay; missing calibration is still explicit.

## Contractor VERIFY REPORT

Requirement coverage: 6/6 scoped R1–R6 implemented (100%).

| Scenario | Result |
| --- | --- |
| R1 focal decoding | PASS — independent analytical logits/last class/top-K/scaling tests and real-model inference. |
| R2 isolated validated adapter | PASS — bad-contract fixtures, scoped call site, pinned model config accepted by browser run. Other detector profiles not requalified. |
| R3 competing vehicle labels | PASS — nearby/contained-object fixtures preserved; final sampled track output has no IoU≥0.85 pairs. |
| R4 truthful output / metres | PASS — exported version markers inspected; absent profile/reference/distance remain null. No old score conversion. |
| R5 actual clip / technical checks | PASS for stated selected-frame checks, native seek and export; no global precision/recall or distance accuracy claim. |
| R6 confirmation / weak evidence | PASS — bounded-retention, tentative streak, occlusion and weak-range tests; confirmed final browser result. |

Scenario results: 6 PASS / 0 FAIL within this bugfix scope. Technical health:
build PASS; type errors 0; 101/101 unit tests PASS; release verifier PASS;
diff whitespace check PASS. No separate lint command configured/run.

OVERALL STATUS: **NOT READY for the full distance-warning / realtime product.**
Remaining P0 gates: measured camera profile or independently measured control
points; real range-error validation; annotated multi-clip detection evaluation;
target-hardware latency. Small/occluded vehicles can be omitted by conservative
confirmation. High-confidence model mistakes are still possible. Also requalify
the generic RoboEye RT-DETR profile separately: this fix is DriveSense-only.
No new external service, model weights, private video publication or deployment.

## Primary sources

- [Selected model config](https://huggingface.co/onnx-community/rtdetr_v2_r18vd-ONNX/blob/main/config.json)
- [Official focal decoder, v4.50.3](https://github.com/huggingface/transformers/blob/v4.50.3/src/transformers/models/rt_detr/image_processing_rt_detr.py)
- Local installed 3.8.1 source and browser bundle as described above. Runtime
  adapter validates model_type and use_focal_loss, refusing an incompatible model.
