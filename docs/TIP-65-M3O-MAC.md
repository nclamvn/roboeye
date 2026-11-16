# TIP-65 M3O: isolate detection and correspondence before another motion fix

16/11/2026. Contractor: Vibecode Kit v6.3. Mac only, no app/iPhone changes,
no release or commit requested. Preserve all earlier trials and dirty user work.

## Outcome and falsifiable questions

M3N produced 0 TP / 17 FN and 0 FP / 6 TN. Silence is not useful detection.
Its reviewed object-approach labels are NOT ground-truth pixel flow. Independently
test (1) visible object detection/localization and (2) pixel correspondence,
then try a better evidence-producing method on new clips. No threshold loosening,
no inferred metres, no new tracker. Missing evidence remains unknown.

Hypotheses, not conclusions: exported detector misses/localization exclude some
objects; full-frame 640 processing loses small-object evidence; valid correspondences
can also fail current object geometry/association. Oracle geometry must be labelled
diagnostic, never a deployable result. Unknown rivals cannot simply be discarded.

## Roles, reuse and boundaries

Builder detector owns new m3o_detection module/tests: uncouple detector recall from
motion gates; distinguish exported detections from uncensored proposals; report
duplicates, wrong class, localization, and genuinely absent qualified boxes.
Sparse reviewed labels do not authorize calling every unmatched detection false.
Builder correspondence owns new m3o_correspondence module/tests: independent
known-map evaluation, correspondence quality versus verifier rejection; investigate
and propose a smallest alternative. Builder study owns new m3o_study module/tests:
causal join, bounded A/B replay and scoring after method selection. Contractor
owns data selection/review, actual model scheduling, independent verification.

Freeze M3N/M3M baselines. Keep confidence, IoU/margin, point support, FB/NCC,
geometry, camera and motion thresholds unchanged. An independent diagnostic IoU
curve is not a change to the warning scorer. State any changed evidence resolution
or sampling population explicitly. No new paid API or cloud-image submission.

Direct VLM/agent perception baseline is unmeasured here; a VLM is not a source
of flow, metres or motion ground truth. Simple bbox growth remains a diagnostic
negative baseline, not an authorized fallback. Keep local privacy and measure
quality and cost separately; tests do not certify field safety.

## Data frozen before RGB / outputs

New Boreas windows selected from camera timestamp/cadence and speed only:
1598991455097712 (50 frames, mean metadata speed 8.852),
1598987796079070 (50 frames, mean metadata speed 6.74351).
Both are four-second windows from the same recording/domain, not independent
cross-domain validation. Root will verify token non-overlap, review fixed visible
2D checkpoints before inference, and preserve unknown/occluded cases.
The initially chosen city1598989127031027, and metadata-only continuation
1598989133031027, fail the existing 3D-label timestamp coverage floor. Replaced
before any RGB download, label-value inspection or model output, not based on
semantic outcomes. Both final intervals have20 label timestamps.

Boreas CC BY 4.0, credit ASRL/UTIAS/University of Toronto and coauthors, disclose
derived labels/transforms, no endorsement. No nuScenes. Existing checkpoints only
unless a specific legal/technical need is confirmed. Other datasets' code licences
do not automatically clear underlying images or model-training rights.

Pixel reference: exact analytical transformations of attributed source photographs
can provide known correspondences and visibility, explicitly authored rather than
real dense-flow annotations. Natural clips still require their separate semantic
FP/FN evaluation. Do not equate camera poses or 3D boxes with dense flow truth.

## Method decision before held-out inference

Three field lanes, all using the exact frozen M3N source-texture/warped engine:
A: original shared global RAFT-small; B: the same RAFT checkpoint followed by
OpenCV VariationalRefinement in both directions at original working resolution;
C: independent OpenCV DIS MEDIUM, default parameters. T remains the original
camera/handle surface; S is bbox growth diagnostic only. B uses OpenCV defaults
(alpha20, delta5, gamma10, 5 fixed-point and5 SOR iterations, omega1.6, epsilon.001).
No fitting those parameters on the new results. Both A and B perform their own
actual model calls, serially sharing one resident model. C has CPU algorithm
calls, not learned-model calls. All verifier and warning floors unchanged.

This tests refinement of the existing working768-pixel image, NOT recovery of
native2448-pixel detail or elimination of the18px object-size floor. Unknown
rivals and genuinely inadequate source resolution remain explicit limitations.
The analytic audit will use OLD M3N source photographs, including object-centred
sealed points, before any new-clip model run. It does not inject its analytic
map or target coordinates into any inference provider.

Primary references: [OpenCV implementation and defaults](https://raw.githubusercontent.com/opencv/opencv/4.x/modules/video/src/variational_refinement.cpp),
[DIS](https://docs.opencv.org/4.x/de/d4f/classcv_1_1DISOpticalFlow.html),
[Boreas licence](https://github.com/utiasASRL/pyboreas/blob/master/DATA_LICENSE.md).
Spring's official dataset offers CC BY4.0 rendered correspondence data, but the
sample link was unavailable; not downloaded or called real-road ground truth.
KITTI/Sintel/Freiburg SceneFlow lack cleared commercial use for this task.
HPatches repository MIT alone does not settle every source image's rights.
No new dataset/checkpoint licence is silently inferred from code licence.

## Budget / stop

Before new large files check free disk >=10GiB. Reuse existing checkout/runtime;
no project copies or extra build directories. Maximum 100 new real exposures,
80 still-image controls; at most 3 actual correspondence lanes and 2 detector
providers on <=20 labelled checkpoints each. One resident learned model at a time.
Initial diagnosis uses cached M3N receipts; no repeated 100-frame development
inference by default. Known-map pilot <=48 field directions per learned provider.
Each actual replay <=30 minutes, telemetry records completed frames/calls on failure.
Before held-out replay, allow one five-exposure OLD M3N execution preflight
(<=32 learned directions plus separately counted refinement/DIS work). This is
execution QA only, not a semantic study, and cannot change thresholds.
One evidence-backed infrastructure repair allowed, never retune on held-out scores.

Only keep candidate in a future default if measured useful recall improves without
unexplained false alerts. If input evidence still fails, report NOT READY and the
remaining cause; do not claim silence, speed or a test count as product success.

## Completion / Verify

### Independent component diagnosis

The retained M3N receipt reproduces all17 misses. Six have no current qualifying
same-family export (2 vehicle,4 person), not necessarily an entirely silent model.
One person's best IoU is .345028, below the unchanged .35 floor, not a reason
to lower that floor. Eleven have current qualifying boxes (8 vehicle,3 person).
Among those:7 first hit association ambiguity,1 lacks fresh exposure after a
camera reset,1 geometry veto and2 direct grid-support vetoes. All comparisons
ending at those11 current targets are unsupported, so removing rivals alone has
zero demonstrated rescues. This is first-veto localization, not proof of dense
flow error or a single universal cause.

For the selected measured fresh hypotheses,14 directional populations contain
574 original seeds. Raw M3N B verifies165; warped C verifies142. C records115
centre-cycle,56 local-affine,227 patch-NCC and34 patch-cycle rejections. These
are hypothesized pairs, NOT GT-confirmed point identities. Three geometry-vetoed
hypotheses have corners but one side below18 working pixels; NCC was not attempted.
Do not call them NCC failure or rescue them by lowering the size floor.

See `docs/evidence/tip65/m3o-m3n-diagnosis.json` for all17 bound cases.

### Detector-only actual execution

20 reviewed checkpoints/provider:10 OLD M3N development and10 NEW M3O, no target
boxes/classes passed into inference. Existing YOLOv3FP16 CoreML versus existing
pinned RT-DETRv2 R18vd on MPS, no checkpoint/dependency install. RT-DETR freed
before CoreML subprocess starts. Both keep confidence.38; YOLO internal NMS.45
and existing RT-DETR dedup.65 are unchanged, not claimed identical architectures.
RT-DETR sees native PNG through640 preprocessing; YOLO sees staged JPEG through416.
Differences therefore belong to configurations, not isolated model superiority.

| Warning-assignment eligible target-keyframes | YOLO | RT-DETR |
|---|---:|---:|
| OLD approaching vehicle |8/10|8/10|
| OLD approaching person |3/7|4/7|
| NEW approaching vehicle |10/15|11/15|
| NEW approaching person |2/4|2/4|

RT-DETR rescues only1 of the6 original detection misses. On new data it rescues3
YOLO misses but loses2 targets to ambiguity: net12/19 to13/19. Its diagnostic
one-to-one IoU.35 positive coverage is15/19, NOT13/19 and NOT warning recall.
Sparse labels cannot establish detector precision; falsePositiveDetections:null,
precisionState UNMEASURED-SPARSE-GT. Unreviewed exports are not labelled FP.

The old detector-development startup may overlap the tail of an already-running
CPU authored test (Builder reported it); no detector speed-superiority claim.
NEW detector execution is serial after that test completed. Raw snapshots bind
all input, selected image, executable, checkpoint and source bytes before/after.
Actual receipts and separate source-bound score artifacts are retained.

### Known-map correspondence actual execution

Eight authored transformations of two OLD M3N photographs, source-selected points
inside one vehicle and one person region. No new clip used; all three providers
receive identical source pixels, points and targets withheld from inference.
Static, translation, scale/rotation and occlusion, explicitly NOT independently
labelled real object flow. 344 source seeds/provider,324 GT-visible points,
314 full-patch-scorable,0 invalid predictions. Root independently recomputed
endpoint errors from serialized coordinates; peer audit checked bindings/masks.

| Field | Mean GT-visible endpoint error (px) | Above1.3px |
|---|---:|---:|
| A RAFT |0.164679|0/324|
| B same RAFT + VR |0.093986|0/324|
| C DIS |0.143458|6/324|

B lowers EPE in8/8 pairs but does not increase warped verified counts in any
pair: baseline already clears the1.3px endpoint floor. C's6 errors occur in
the person occlusion case (6/26 visible points). Endpoint accuracy, reversibility,
photometric acceptance and object identity are distinct. Do not promote from
this synthetic pilot. Actual32 learned RAFT directions (16A+16B),16 CPU VR,
16 CPU DIS; one resident model. No failed pilot or hidden retries.

Execution-only preflight:5 OLD M3N exposures,5 actual detector calls,10 RAFT
directions per A/B,10 VR and10 DIS; every source/provider/cost/point contract
passes. No semantic score on this truncated prefix. Temporary staging auto-cleaned.

### Held-out video and final QA

Actual new100 replay completed,158.061s sequential wall including all lanes,
1.882s model startup. Independent peer recomputed legacy event scores without
calling the new scorer; root read the source-bound results and verified raw hashes.

| New reviewed target-keyframes | A RAFT | B RAFT+VR | C DIS | S bbox diagnostic |
|---|---:|---:|---:|---:|
| TP / FN |0 /19|0 /19|0 /19|9 /10|
| FP / TN |0 /2|0 /2|0 /2|0 /2|
| Unknown targets |3|3|3|3|
| Unmatched / unreviewed notices |0 /0|0 /0|0 /0|7 /128|

All A/B/C abstain100/100 frames. More supported pair records (55A,77B,90C,
of2707 comparisons each) do not establish useful motion recall. Actual calls:
244 RAFT A;244 RAFT+244 CPU VR B;244 CPU DIS C. Root and peer confirm all100
source hashes and500 frame/surface no-range checks; these are checks, not500 clips.
Paired deployed-path lower-bound p50/p95: A685.14/985.41ms,
B850.84/1242.78ms,C514.56/681.06ms; S239.90/366.45ms. Includes detector perform,
preparation, T and own lane only, not other ablation costs. Fixed A→B→C order
and warm state are not counterbalanced, so no universal speed-superiority claim.
No CPU scoring/test job overlapped this natural-video inference.

The refinement is NOT selected for a default: slower in this measurement and
no semantic gain. DIS is also NOT selected merely because it is cheaper or
quiet. Neither result resolves the original product failure. S is not a fallback.
No product acceptance inferred.

Frozen runtime
hashes: study6e6ee416b6e7ceafd6b5ecfc7bac549fe14acf7bf797933e40ac34f33bd44ab5,
correspondence16e561579aba269d80a934075c2a7c1c6cab0c7fc1686812ca31f4b88defc9cf,
detectorba115f7d494cba9b206351206fd25d7fff7ae2484d145e4fb691a05acead4f42.

### Posthoc new-case diagnosis, not hold-out tuning

`m3o-holdout-diagnosis.json` retains all19 positives and the complete competing
target matcher. Seven have no qualifying current detection;12 match, including
2 with current camera insufficient-background-agreement. Identical first vetoes
per A/B/C:7 current detector/handle criterion,6 fresh association ambiguity,
2 no fresh exposure after reset,2 current camera veto,1 anchor association
ambiguity and1 fresh support failure.

Of43 target-linked eligible pair records/lane, only A2/B1/C2 are supported.
B loses1 against A and gains0; C supports the same2 and gains0. The selected
fresh pools share450 original seeds:90 in2 size-vetoed populations are unknown,
not removed;360 in14 populations attempt photometry. Verified A99/B132/C204,
assigned97/129/202. More locally verified points still do not establish both
fresh and long-anchor support for a target.

Concrete cases: turn29 handle45 has A fresh FWD/-REV growth span.00491695,
B.00707762 (fails unchanged.005), C.00284927. All remain association-blocked;
long hypotheses fail support. Turn36 fresh passes all3, but long-anchor assigned
counts are A0/17 and0/16, B0/17 and2/16, C8/17 and8/16, below required12.
These old boxes are hypotheses, not independently labelled physical identities.
Do not call a failed hypothesized old/current pair proof the flow model is wrong.

Unresolved causal gap: Boreas approach is defined from3D reference, not ground
truth image expansion/correspondence or the visibility of a particular surface.
Global RAFT repeats grayscale into3 channels and uses working768→model640;
native data are2448x2048. These are confirmed code facts and plausible causes,
NOT measured native-RGB/native-resolution counterfactuals. The experiment does
not isolate them or establish flow EPE on natural scenes. No thresholds changed
after opening outcomes. No further model patch was added to rescue this holdout.

### Negative controls and independent verification

Actual80 new-source still-photo transforms complete in106.513s sequential wall.
A/B/C each0 all-scene false notices and80/80 abstentions; S49 false notices.
The absence of alerts does not compensate for0/19 TP. No exhaustive detector
precision is inferred from sparse target boxes. No CPU scoring/test job overlapped
control inference. Controls paired p50/p95: A501.11/622.41ms,
B690.27/820.57ms,C314.30/355.18ms; S74.39/112.18ms. Different image dimensions
and scene complexity from natural clips, not an equal-load speed comparison.

Recorded research execution, excluding authored CPU unit tests:960 actual RAFT
directions (pilot32 + preflight20 + natural488 + controls420),480 CPU refinement
and480 CPU DIS directions. CoreML calls205 (20 standalone +5 preflight +180
video/controls), RT-DETR20. No new model/dependency installs, paid API, phone
installation, native build, commit, push or deploy. The first metadata-only fetch
failed label coverage before image download; all actual model trials completed
without retries. An initial root inline verification used the wrong asset-root
key, failed before writing an artifact, then was corrected via existing load_input;
no model rerun or metric changes.

Root separately recomputed actual event scores with frozen legacy score_frame,
not the M3O scorer, verified180 raw source hashes and900 no-metre surface checks
(5 surfaces ×180 frames). See `m3o-root-verification.json`; peer independently
checked natural-video source/model/counter bindings and detector exports.
No identity/safety certification is implied by structural or model-based review.

At post-run inspection the Mac had32GiB free disk and12.0GiB swap in use.
Pre-run swap/peak RSS were not recorded, so neither causality nor peak memory
is claimed. These timings are local R&D observations under system conditions,
not real-time or phone guarantees. Do not delete OS swap or unrelated caches.

### Technical QA / disposition

Actual final collector receipt:
`docs/evidence/tip65/mac-readiness/runs/2026-11-16T09-51-15-751Z-a86d29de/summary.json`.
487 Python,121 Swift,11 Node policy tests PASS with0 skips; TypeScript PASS.
150 source files before/after hash
`b6d3ac2e967f94f99013669eb5fd718ef6719c76116295d5b4c58b103b3f0c5b`,
unchanged. Native device/build/thermal/latency acceptance NOT RUN, as requested.
releaseApproved:false; semantic NOT_READY. Current11 tracked dirty files remain
the user's existing changes; no task edits to those files.

Temporary staging auto-removed and verified absent: `codex-tmp-m3o-known-map-*`,
`codex-tmp-m3o-preflight-*`, `codex-tmp-m3o-detector-*`, `codex-tmp-assist-m3o-*`.
Keep the attributed dataset, labels and receipts needed for reproducibility.
No extra checkout, venv, model copy, build directory or Docker image created.

Requirement coverage: detector-only evaluation IMPLEMENTED (precision unmeasured
under sparse labels); correspondence known-map evaluation IMPLEMENTED (natural
dense-flow GT missing);17-case gate localization IMPLEMENTED (not a universal
physical root cause); alternative-method/new-video A/B IMPLEMENTED but quality
FAIL; false-alert controls IMPLEMENTED; no-threshold/no-metres/no-iPhone PASS.
Overall NOT READY for useful approach warnings. Keep the isolated research tools,
not the refinement/default change. The next evidence-producing direction is an
independently labelled correspondence benchmark plus source-identity and native
RGB/detail-preservation ablations; no further tracker or threshold adjustment.

## Evidence index

- `docs/evidence/tip65/m3o-m3n-diagnosis.json`: original17 misses.
- `docs/evidence/tip65/m3o-detection-development-score.json` and
  `m3o-detection-boreas-score.json`: standalone actual detector configurations.
- `docs/evidence/tip65/m3o-known-map-pilot.json`: actual controlled pixel study.
- `docs/evidence/tip65/m3o-execution-preflight.json`: truncated execution QA only.
- `docs/evidence/tip65/m3o-boreas-score.json`: raw receipt SHA
  `1b7eb6bf3edd6acd73a44f80b97d3cf48aae891519fb5747b7821977b9e8f91f`.
- `docs/evidence/tip65/m3o-controls-score.json`: actual negative control results.
- `docs/evidence/tip65/m3o-holdout-diagnosis.json`: all19 new positives and limits.
- `docs/evidence/tip65/m3o-root-verification.json`: independent event/source checks.

New reusable source: `scripts/assist_scene_m3o_detection.py`,
`scripts/assist_scene_m3o_correspondence_audit.py`,
`scripts/assist_scene_m3o_study.py`; separate posthoc-only diagnosis
`scripts/diagnose_assist_scene_m3o_holdout.py`. CPU tests are additive;
frozen M3N/M3M implementations remain unchanged.
