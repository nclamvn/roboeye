# TIP-65 M3Q: independent correspondence verification and complete references

17/11/2026. Personal Vibecode Kit v6.3. Contractor root; Builders correspondence,
reference data and replay integration. User authorizes local Mac implementation
and A/B on new clips, not iPhone, release, commit, push or deployment.

## Outcome and preregistered decision

M3P RGB640/RGB768 did not improve selected-pair support over gray RAFT-small.
Do not repeat input resizing as a purported solution. Test a genuinely different
correspondence method: independent full-frame RootSIFT descriptor matches,
strict reciprocal uniqueness, actual pixel verification and retained RAFT
consistency checks. No persistent tracker. Keep all existing geometry, camera,
temporal growth and association quality floors.

Baseline A is frozen M3O laneA textured-warped RAFT-small. Candidate B changes source
features to SIFT and independently matches descriptors, then applies strict
verification. This is a compound method comparison, not an isolated attribution
of any improvement to one verifier line. Same detector, staged pixels, pose,
intrinsics, checkpoint, update count, clip cadence and warning schedule.

## Contracts and budgets

Source-only inventories are sealed before pair matching. Maximum5000 global SIFT
features with fixed reported OpenCV defaults; at most one highest-response point
per fixed8x8 object-interior cell. Every original selected point stays in its
denominator, including ambiguous, unmatched or footprint-invalid features.
RootSIFT bidirectional nearest matches must pass ratio<.70 and reciprocity.
Actual7x7 NCC>=.70 and norm product>=784 remain mandatory; orientation/scale
warps must satisfy existing local shape limits. No fitting intensity or changing
the source/target boxes to manufacture agreement. Descriptor support outside
an object's own box cannot count as evidence for that object.

Keep RAFT backward return<=1.3px at the independently selected endpoint and
also require agreement with the RAFT forward endpoint<=1.3px. Descriptor
reciprocity is not relabelled as independent flow cycle measurement. Reuse
min9 points, support.70, spatial spread/hull, RANSAC1.2px, association margin.08,
estimator span.005 and all current/anchor growth and camera gates unchanged.
Missing evidence means unknown, never guessed motion or metres.

Two road intervals fixed from metadata only before RGB and inference:

- city1598989140031027:50 exposures1598989140055117..1598989143976364,
  19 official label timestamps.
- turn1598987802079070:50 exposures1598987802127370..1598987806049624,
  20 official label timestamps.

Both are disjoint from all M3C–M3O source windows. Same Boreas recording/domain,
not cross-domain validation. The traffic continuation with only21 frames was
rejected using metadata, not after model output. Camera metadata SHA256:
1a4a066acd7a008d3dccfff4c7656519d66c6eb81a040d41a3a9266cbe54bac6.

Pre-inference extension: the two negative candidate units in the first two
clips project onto a far vehicle mostly hidden behind a foreground sedan.
They may be unscorable after visual review, not true negatives by default.
Add a third natural low-speed interval1598991318015344,50 exposures
1598991318076129..1598991321994969 and20 official labels; mean camera speed
0.0193577m/s from metadata. No third-clip pixels/results seen before selection.
HEAD total134,026,516 bytes. Combined planned road images523,495,815 bytes.
Third preregistration SHA2566653a032243d61a0832cef163aff4acbd0cea17ce4e43e2a8bdbd6559bee256e.
This adds a genuine natural negative-control opportunity without selecting a
successful model output. Low camera speed does not itself label every object
stationary or non-approaching; use its official reference and visual review.

Dataset rights: existing Boreas CC BY4.0 clearance; nuScenes remains unused.
Complete RGB/pose/official3D input plus reviewed2D evaluation targets must exist
before road A/B. Fix target checkpoints5,8,11,14,17 per clip, retain all candidate
units and explicit unknown/omission denominators, never just detector survivors.
Labels enter scoring only, not runtime inference. AI visual review is not human
or dense-flow ground truth. Record metric truth generated from official3D/pose
as reference only; inference must not emit metres.

For independent pixel verification, seek a complete externally labelled small
reference. The original Spring sample URL is dead404; do not repeat failed
DaRUS archive transfers. A complete planar-photo homography reference is allowed
with verified dataset rights, but cannot be called dense dynamic-object flow or
road-motion truth. Missing external EPE must not be faked from authored warps.

Before pixels: use HPatches i_londonbridge andv_abstract, images1→2 andH_1_2,
first lexical illumination/viewpoint sequences marked original to HPatches in
its references.txt (exclude inherited third-party sequences). Official dataset
README links the Hugging Face full-sequence mirror; dataset card MIT and
official MIT notice retained. Pin HF revision594f211e80b75081ad84a396c93960c8653235f8.
Estimated planar homographies are external annotations, not dense nonrigid
flow/occlusion labels. Only geometrically visible planar sample points can be
scored. Preserve occlusion uncertainty and do not call outside-image absence a
wrong-match label. Refusing an otherwise visible match is separately a miss.

Primary method/data sources reviewed:
[OpenCV descriptor matching](https://docs.opencv.org/4.x/d5/d6f/tutorial_feature_flann_matcher.html),
[SIFT original paper](https://www.cs.ubc.ca/~lowe/papers/ijcv04.pdf),
[HPatches official dataset](https://github.com/hpatches/hpatches-dataset),
[HPatches licence](https://github.com/hpatches/hpatches-dataset/blob/master/LICENSE).
Learned matching was also compared at design stage:
[LightGlue official](https://github.com/cvg/LightGlue) offers a viable future
candidate, but its weights/extractor/runtime would add another variable. Use the
already installed deterministic descriptor method first; no claim it is SOTA.

Reuse existing checkout, venv, weights and qa scratch roots. Disk floor10GiB;
58GiB free initially. Initial180MiB road-image estimate was corrected to500MiB
before fetching/viewing pixels: prior100-frame source sets were398/469MB. HEAD
sum must fit the revised hard budget. After the pre-inference third-clip
extension, total road-image budget is700MiB (actual planned523.50MB).
External reference<=40MiB,
no full archive/model download, cloud inference or new environment. One justified
infrastructure repair per retrieval phase. One frozen method, one actual A/B
road replay<=150 frames/1800s; stop on resource limit and preserve valid evidence.
No tuning after holdout results. Serial model use; no heavy tests during timing.

## Implementation and measurement

Builders add M3Q-only correspondence, data/replay/scoring modules and tests.
Do not change frozen M3M–P inference, evidence policies or the pre-existing11
native/package edits. No monkeypatch of frozen globals. Additive class adapters
may reuse unchanged camera/temporal/geometry logic.

Measure complete denominators TP/FN/FP/TN/unknown and coverage per lane, detector
misses separately from correspondence and temporal vetoes. Component match
correctness/accept-wrong and EPE against external reference are separate from
end-user approach alerts. Preserve source and policy hashes and actual calls.
Report synchronized per-frame/component elapsed time, cold startup separately;
no realtime claim from a few warm pairs. No alert smoothing that carries stale
unverified evidence. Require improved useful recall without more false alerts
before any candidate promotion; otherwise keep research-only.

Road evaluation scope follows the pre-existing deterministic strata/max9 target
selection at each checkpoint, not every object in the scene. Record all source
target counts, selection exclusions and explicit visual-review omissions. Report
unmatched/unreviewed notices separately; zero FP on selected targets must not be
advertised as zero false alarms over the whole scene. Promotion also requires
no unresolved unreviewed approach notices.

Simple baseline is current measured geometric pipeline, not a cloud comparison.
Direct LLM/agent perception baseline remains unmeasured and does not supply
motion/range truth. No claim of universal superiority or user safety.

## Completion / Verify

### Reference completeness before inference

Complete HPatches reference retrieved:2 image pairs, both external homographies,
six archive members plus five attribution/rights snapshots. Root independently
rechecked all11 file SHA256/byte counts, explicit MIT card/notice and original
sequence references. Manifest SHA256:
049adf30ccfa019988fc1bcdaa3a9fcbf461459f3ebb5a52fa4f8198602d0d7f.
Actual final fetch10,633,640 bytes, reserved10,982,699,26.83s; earlier research
metadata/directory probes approximately0.35MiB additional. No full1.3GB archive.
The identity homography in illumination pair i_londonbridge is genuine external
annotation; viewpoint v_abstract is nonidentity. Neither is road motion GT.

Road preregistration HEAD totals389,469,299 bytes for100 images, below500MiB.
Plan SHA256fea84ca3dd48b5fbd7cb1093a3572c3c3a104b928d1e03ef2a25d2aa784bac91.
Third clip completed too: total150 original PNGs523,495,815 bytes;59 official3D
label files265,074 bytes. No image/label transfer retries/failures. Metadata reuse
and earlier research/HEAD traffic are additional, not silently counted as zero.

All73 preselected candidate units visually decided before road inference:
44 retained,29 explicit unscorable/occluded. Fifteen source-bound review sheets
viewed by Contractor; independent AI reviewer viewed/hash-checked all sheets
without seeing Contractor decisions first. Shared major projection failures
were excluded by physical identity, not corrected onto foreground occluders.
Minor unresolved tiny-object disagreements remain unscorable. AI review is not
human certification. Final reference31 approaching,8 not-approaching,5 unknown
target-keyframes, not31 independent approach events or exhaustive scene labels.

Combined runtime input SHA256:
7c377d6a6a344a64d34cbbb1fe4b3319e2fe9856e051a889c3148bcd0b2f9986.
Reviewed truth SHA256:
3e0668037090c65ea93964b843df1e083e759f0f7e6c86f0b2bb5df1c7e6fa20.
Coverage SHA256:
7134e3eb86b85cd5a453cd47f85190ea7b295e57ae3350d5edb90c9383d43204.
Root independently verified all150 original file hashes, no exposure overlap
with prior slices, unchanged policies and complete decision counts.

### External-reference actual trial and disputed annotation

Actual local MPS component trial completed in8.476s,4 actual RAFT directions,
2 raw field archives12,008,813 bytes. Baseline A and candidate B consume the
same fields, with all original source points retained. Different source selectors
mean their point denominators differ. Receipt SHA256:
9d41e038a2417c3d05c2b19522afc88f3428d4d74b35485254afdf90aed2be0d.

Reference i_londonbridge has publishedH=I, but A's accepted111 points all exceed
the fixed1.3px error floor. B has2 accepted-correct,46 accepted-conflicting and
59 missing of107 selected points. Independent raw/Sobel phase correlation shows
approximately(+.25,+1.70) working-pixel shift with responses.903–.919, agreeing
with both methods' approximately1.8px endpoints rather than published identityH.
This is REFERENCE-DISPUTED at this strict tolerance, not proof of111 true wrong
correspondences. Do not fit/replaceH, raise the floor, remove the case or quote
these conflicts as a demonstrated false-match reduction.

Viewpoint pair v_abstract against its external estimated projectiveH:
A107 accepted-correct,1 accepted-conflicting,20 missing of128 original points;
B42 accepted-correct,1 accepted-conflicting,82 missing of125. This does not
support the candidate improving component coverage. It is not dense nonrigid
flow, independent nonocclusion truth or end-user warning recall.

The component receipt remains bound to original candidate sourcecb24574f...
preserved exactly under ignoredqa/m3q-component-source. Later diagnostic-key
rename distance→descriptorDistance avoids the unchanged no-range schema guard;
exact text comparison proved only those serialized key/read names changed.
No component result is relabelled as the subsequent road implementation.

### One hard-floor restoration and interrupted road attempt

Root source audit found candidate SIFT selection/NCC norm did not explicitly
guarantee the existing per-source7x7 variance16 floor. The first road run was
terminated deliberately (SIGTERM143). Last printed counter24 actual directions
at frame30; final direction count is unknown and no completed/prefix receipt
recovered. This interrupted attempt is not a quality result or zero-cost run.
See m3q-road-interruption.json for source hashes and cleanup details.

One execution repair restores actual fractional-center sourcePatchVariance>=16.
Every failure stays UNKNOWN in its original source denominator. Adds numeric
proof checking and low-texture/fractional/tamper tests. All other method and
quality floors unchanged; input/truth/coverage unchanged. Pre-repair source is
preserved under ignoredqa/m3q-road-aborted-source. Final candidate d4bad07d...,
runner a11eaf9c.... R1 external runtime limit1650s plus initial<124s remains
inside the1800s road-execution budget. No further numerical retuning authorized.

### R1 actual A/B and independent verification

Complete150 frames,150 actual CoreML detector calls in3 batches,740 actual
RAFT directions (370 per arm,185 pairs each). CounterbalancedAB/BA, no cached
directions presented as inference. External wall392.521s, raw receipt202,664,796
bytes under256MiB cap. Both runtime/code seals unchanged. Final raw receipt SHA:
0c4198fd153cb9acddee1dd18d7911f5be60dcd35153f73a63c98c8a07e863d0.
Official score SHA:
35e3f8623fed9fe706ee3680eca4833fc01f107f19a7e43275a4499dbbbcbf44.

| Method | TP | FN | FP | TN | Unknown reference | Silent frames |
|---|---:|---:|---:|---:|---:|---:|
| A, frozen warped RAFT |0|31|0|8|5|150/150|
| B, RootSIFT plus strict verification |0|31|0|8|5|150/150|

Both have0 unmatched/ambiguous/unreviewed approach notices. This is an all-silent
failure, not evidence of usable safety. Bbox-only diagnostic S detects11/31 but
has15 unmatched and188 unreviewed notices; it is not an approved fallback.

Per-frame paired-product timing (detector observation, staging/shared decoding,
camera and own method, excluding outer proof validation/receipt encoding):
A p50/p95795.97/1551.14ms; B1967.71/3780.14ms. B is substantially slower with
no useful recall gain. Whole392.521s includes both research arms, not a measured
single-app UI throughput. No realtime, visual smoothness or thermal claim.

Independent reviewer recounted events using its own matcher, not the new scorer;
verified all runtime/source seals,150 detector calls,740 directions and600
no-range surface checks. Independent artifact SHA:
77f7a86396830bddeeefb32af6bd506ba0ee866c355311b108fa18f569dc99ad.

Observed first-veto partition of31 positives, identical across arms:
4 current detector/handle-criterion failures,2 camera vetoes,7 missing fresh
source exposures and18 ambiguous/unverifiable rivals. These sum to31; they are
observed first gates, not proof that each gate is the sole causal failure.
Of27 positives matched by the current detector,14 have fewer than9 current
SIFT source points. This is an overlapping secondary observation, not14 extra
misses. Descriptor footprints leaving object bounds are the largest linked
point-rejection category. Failed points and unresolved rivals remain in original
denominators; neither the min9 nor unknown bounds were loosened.

The31 labels describe radial physical approach in official3D reference.
Cross-street approach need not produce the frozen projected-affine expansion
signature. No independent per-object expansion labels certify a particular
RAFT/NCC root cause. These remain real product misses, not reclassified wins.

Posthoc source-pixel checking found all91 accepted old-component B points meet
the restored variance16 floor (minimum16.5065). This does not recertify the
historical component as a complete current-candidate run; disputed LondonH and
different old/current source hashes remain explicit.

### Final technical health, requirement coverage and disposition

Full unchanged structural gate passed: Python587/587 with0 skips, Node policy
13/13 with0 skips, Swift121/121 and TypeScript typecheck. Python101.249s stays
inside the original180s limit; no timeout enlargement or thread-policy change
was made to hide the prior M3P timeout. Both prior failure and current pass
remain separate receipts. Current QA source fingerprint identical before/after:
fad050a0189f01e3cfedb015df27c1cf6b17e2f715fb075281b7c01295a201ad,
174 files. Receipt:
`docs/evidence/tip65/mac-readiness/runs/2026-11-17T08-11-18-261Z-15a90e9c/summary.json`.
`git diff --check` passes. Structural success is not semantic acceptance.

Requirements: new method IMPLEMENTED+actual run; complete scoped road-reference
and new-clip A/B COMPLETE; quality-floor restoration VERIFIED; no metres/phone
PASS; useful recall improvement FAIL; realtime/smoothness NOT DEMONSTRATED.
Direct LLM/agent baseline remains unmeasured. No commercial or safety superiority.

Disposition: **reject RootSIFT candidate for default integration; NOT READY**.
Do not spend another phase merely accelerating this all-silent path. Next
bounded design investigation should target object-level association, evidence
to distinguish genuinely incompatible rivals from unknowns, and sufficient
small-object information, with independent labels for physical approach versus
projected expansion. This is a next hypothesis, not a promised solution or
permission to weaken current floors. Preserve both failures and all evaluation
tools as research-only, no app/default change, commit, push or deployment.

Disk57GiB free; no model/dependency download this milestone. All generated staging
for R1 auto-cleaned. Aborted-run cleanup removed only50 own generated JPEGs,
approximately7.8MiB, regenerable from retained original data. Thin historical
source snapshots and raw evidence remain intentionally under the existing
ignored qa directory, not temporary leftovers. No extra build output directory,
project copy or unrelated deletion. All11 pre-existing native/package edits
remain233 insertions/23 deletions, separate phone UI untouched.

Compact Contractor handoff: `docs/evidence/tip65/m3q-verification.json`.
