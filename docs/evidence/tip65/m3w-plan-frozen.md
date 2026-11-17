# TIP-65 M3W: pixel/pose known-control factor isolation

17/11/2026. Mac only. Vibecode v6.3: Contractor design/verify; separate data
and diagnostic Builders; independent Reviewer. No iPhone, commit, deploy,
models, dependencies, external downloads or edits to existing runtime.

## Outcome, baseline, stop rule

M3V did not isolate13FN: only12/72 conditional-static references,11geometry
unknown and1fail. Wide AI rectangles cannot become exact reference by agreement.
M3U actual traffic remains0TP/13FN/0FP/18TN/2unknown,10positive detector matches
camera-vetoed and3detector/handle failures. Cached re-score is not new inference.

Smallest next step: authored rendered controls with exact known camera geometry
and independently computed material-point endpoints, plus TWO existing real
HPatches pairs for correspondence-only estimated-H reference. Existing TUM
RGB-D/mocap remains approximate sensor evidence, NOT exact pixel truth.
No complete independent external dense-flow/pose slice exists locally: Spring
fetch incomplete; official sample404. Do not repeat large downloads or use
non-commercial Sintel. User's commercial-R&D constraints remain.

This diagnostic can separate software/measurement failures in controlled cases.
It cannot identify physical Boreas K/time errors or repair13trafficFN by itself.
If exact nominal geometry works but real data still disagrees, stop adding
diagnostic abstractions: acquire an independent public precise reference or
narrow the product claim. LLM/agent-direct and human accuracy baseline unmeasured.

## Fixed authored controls: reference Builder

New script `scripts/assist_scene_m3w_controls.py` and matching test only.
Read two fixed licensed RGB sources from existing TUM M3T (sequence0frame0 and
sequence1frame0), verify retained source manifests/hashes. They are TEXTURES
ONLY: their sensor depth/pose does not become groundtruth for the new scenes.

Produce12pairs at640x480,6analysis and6holdout (different texture identity,
fixed different plane layout/sign, no selection by score). Source time1,000,000us,
target+100,000us. Continuous trajectories queried for nominal and fixed both-end
offsets −40,−10,+10,+40ms; true pose timestamps retained. No renaming shifted
poses to make skew zero. Fixed K around fx520/fy515,cx319.5/cy239.5.

Six motion types per split: stationary; constant lateral translation; constant
body twist; accelerating pan/translation; changing translation direction plus
rotation; faster pan revealing/occluding static surfaces. Changing angular
velocity/direction is needed for timing observability. Constant body twist is
explicitly synchronization-unobservable; horizontal epilines may hide K errors.
No claim that every injected error is detectable.

Render static frontoparallel multi-depth finite panels with an infinite far
background, nearest positive ray-plane intersection, opaque z-buffer and
bilinear texture sampling. No dynamic object/metres inference. Geometry units
are declared authored scene coordinates, not measured real-world ranges.
Export images, per-frame camera poses/K, finite plane bounds/material transforms,
trajectory parameters and a manifest with hashes. Do not use flow/pose outcomes
to select texture, frames, points or scenes. Export explicit occlusion/out-of-view
truth via ray visibility; no hole-filling or new convenient feature backfill.

Use TWO separate manifests: RGB-only (IDs/split/imagepaths/SHA/shape/timestamps),
and gold (plane/camera/trajectory/observability/HPatchesH). Gold SHA may bind the
RGB manifest without opening gold in observation. observe process must not load
combined metadata or parse scenario labels from IDs. No truth/material mask
enters GFTT/LK. Test observation with a poisoned gold opener; after observation
seal, evaluation binds both source manifests and current code hashes.

Renderer and evaluator may share DATA SCHEMA/constants, not projection/warp
implementations. Evaluator must independently ray-intersect and project world
material points; test with hardcoded3D fixtures and analytic plane homographies.
Any additional renderer-defined parameter choices must be frozen and reviewed
before actual rendering/matching.12pairs remain even if difficult or unobservable.

## Diagnostic and reference separation: method Builder

New `scripts/assist_scene_m3w_factor_audit.py` and matching test only. No old
source edits. Reuse frozen M3U source-only GFTT/LK/FB/NCC, original up-to256
seed denominator, unchanged1.3px/24points/.70support/5cells/.40span and
cheirality/parallax criteria. No tracker, detector, RAFT or parameter fitting.

Two-phase CLI: observe RGB ONLY first, writes/seals all12pairs with source
seeds, forward/back endpoints/status, cycle, NCC/patch metrics and actual call
counts. Only then evaluate against exact scene oracle and sealed metadata.
One actual LK execution/pair, atmost24directions on authored640x480 pairs.
If HPatches uses separate native scaling, preregister it, atmost8directions
for2existing pairs. No actual data execution until code/data and Reviewer GO.

Arms, sharing unchanged RGB/observations:

1. Exact oracle endpoints + nominal pose/K: geometric/model sanity, not a
   measured correspondence or product run. All original seeds retained; invalid,
   occluded, out-of-view and mixed-footprint samples get separate unknown strata.
   Oracle-supported masks are explicitly reference counterfactuals, not measured
   LK evidence. Optional common-scale STEP veto gets fresh state per independent
   pair and separate output, never a claim of640ms temporal qualification.
2. SAME oracle endpoints, ONLY assumed fx×1.05 or cx+8, then ONLY both pose
   clocks±10ms or±40ms. Hard-invalid40ms tests contract rejection separately
   from geometric sensitivity. Within-contract10ms tests plausible mis-sync.
   Do not rerender images or gold when changing assumed metadata.
3. Actual RGB-only frozen LK vs independent exact oracle: endpoint error,
   missed valid correspondence and accepted wrong correspondence at unchanged
   1.3px; raw FB/NCC provenance retained. Occluded/boundary cases stay denominator.
4. Fixed wrong endpoint controls: +8px perpendicular to epiline and +8px along
   epiline, with exact EPE labels. Epiline compatibility is1D, not match proof.
   These are synthetic false compatibility controls, never trafficFP.

Independently use source/target material identity and subpixel visibility; a
patch crossing a surface boundary is a separate stratum, not silently certified
as one surface. Exact center projection does not certify a finite7/21px patch.
Pure rotation/constant-twist/unobservable controls cannot prove K or time correct.
Bound fault labels by supplied known injection, distinguish detected/rejected,
accepted, abstained and not-identifiable. No best-offset/calibration selection.

HPatches existing2pairs: H is an estimated planar reference, no3Dpose/time or
occlusion gold. Freeze source pair identities/native transforms before execution,
report transfer error as conditional on H, not exact physical correspondence.
No pooling with exact renderer or claiming new unseen real videos.

## Metrics and budgets

Pre-render review clarification: nominal texture scales are fixed to
[.12,.08,.14,.045] for near/mid/center/far panels to reduce undersampling.
This precedes any actual rendered-image/flow result; it is not score tuning
and does not certify alias-free images. Earlier numeric-plan draft is retained
as superseded. Keep all motion coefficients unchanged. Frozen `.025` is
sin(ray,baseline), an epipole exclusion, NOT sin between the two view rays.
No larger translation was justified by confusing those two angles.

Report per split/trajectory/arm original seed count, usable-reference coverage,
definite endpoint right/wrong/missed and unknown. Also gate-qualified vs rejected
and corresponding component FP/FN definitions. Calib/time fault acceptance is
not natural moving-object FP. Known-unobservable cases remain explicit.
No new traffic model changed: cache-only0TP13FN0FP18TN2unknown remains unchanged;
never replace it with the synthetic score. No user-facing metres or warning.

Reuse current checkout/venv. Disk floor10GiB (now28GiB). Generated authored
assets<=48MiB; observation/evaluation receipts<=32MiB; preparation<=120s,
one bounded observation<=180s; one evaluation<=120s. One justified execution
repair maximum, retain failure prefix and valid earlier artifacts; no retries
for a better metric. No imported whole project, new build dir, Docker or installs.
OpenCV requested/reported threads are observations, not worker-count proof.
No separate speed tuning experiment in this milestone.

Reviewer checks independent geometry/oracle, observability, data seals, all-seed
denominators and call counters before actual run; verifies result afterwards
without replaying flow. Contractor runs full Mac regression once after source
freeze and scopes conclusions honestly. No runtime promotion from syntheticQA.

## Completion / Verify

In progress. No actual M3W geometry/flow or quality measurement yet.

## Primary source checks

- TUM RGB-D [format/calibration](https://cvg.cit.tum.de/data/datasets/rgbd-dataset/file_formats)
  and [CC BY4.0 notice](https://cvg.cit.tum.de/data/datasets/rgbd-dataset#license).
  Registered depth and mocap are sensor evidence, not exact pixel flow.
- HPatches [estimated-H protocol](https://github.com/hpatches/hpatches-dataset)
  and retained MIT/citation notices. Use already acquired two pairs only.
- [Spring FAQ](https://spring-benchmark.org/faq): externally rendered dense flow
  with camera data, but local retrieval is incomplete; no fabricated complete run.
