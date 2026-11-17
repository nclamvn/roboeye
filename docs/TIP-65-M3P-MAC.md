# TIP-65 M3P: pixel evidence and source identity before smooth warnings

17/11/2026. Vibecode Kit v6.3, Contractor/Builder separation. Mac only. User asks
to continue towards high-quality, smooth behavior. No phone, commit, deployment,
threshold loosening, invented metres, tracker addition or default promotion.
Preserve all11 pre-existing tracked edits and the separate phone UI work.

## Outcome, hypotheses, stop

M3O remains0/19 positive target-keyframes for all three full warning lanes.
Repeating an expensive full replay without new evidence is not progress.
This milestone first separates source identity from correspondence and audits
the actual model input. Hypotheses: repeating gray into RGB loses useful colour;
working768→model640 loses texture; a selected old box may be a different object.
These are hypotheses, not explanations certified by their plausibility.

Smallest change: two isolated field adapters sharing the pinned existing RAFT
checkpoint, RGB640 (colour-only ablation) and RGB768 (remove extra downsample),
versus frozen gray640. Exact same model/update count and original-working pixel
coordinate convention. All downstream evidence floors remain frozen. RGB768
is not native2448 detail recovery and may increase cost; measure it explicitly.

Before another end-to-end trial, require independent pixel reference and review
selected physical source/current identity. Use a legally usable externally labelled
flow subset if retrievable within budget. Clearly labelled rendered scenes are
acceptable for component diagnosis, never described as real road footage. Analytic
author-created transforms are controls, not a substitute for that independent GT.
Reference flow and identity annotations never enter production inference.

## Roles / deliverables

- Builder pixels: additive m3p_field module/tests, RGB640/RGB768 geometry,
  strict pixel/channel/weight/source provenance, original coordinate fields.
- Builder data: primary terms/retrieval, bounded reference-fetch module/tests
  if a viable licensed dataset is available; no full archives/account signup.
- Builder identity: hash-bound source/current review sheets and annotation audit
  for all12 currently matched M3O positive cases, fresh/anchor hypotheses including
  distinct A/B/C choices. No model calls, new associations or hidden GT fallback.
- Contractor: TIP, independent image/identity review, actual serial inference,
  component verdict, bounded next implementation decision and final verification.

Runtime invariants: same checkpoint C_T_V2 hash01064c6d...,12 updates/direction,
2 directions/pair, explicit MPS, no implicit CPU fallback, one resident model.
Same source-only selections and min9/support70%/NCC.70/FB1.3/fit1.2 and unchanged
geometry/camera/growth/association thresholds if the warning engine is exercised.
No repainting guessed or stale alerts to appear smoother.

## Evidence / value

Simple baselines: frozen gray640 and bbox growth diagnostic, not a fallback.
Direct LLM/agent baseline for motion/metres remains unmeasured and is not treated
as geometric truth. Independent flow EPE, invalid/missing predictions, retained
visibility denominators, accepted-wrong matches and growth bias must be separate
from warning FP/FN. Physical approach, projected affine expansion and visible
identity are not interchangeable reference labels.

Measure per-pair actual synchronized total time including preprocessing, cold
startup separately; source-sized geometry and peak memory if instrumented.
No concurrent model runs or heavy scoring during timed inference. A method
that only makes smoother or faster wrong output is rejected. Counterbalance
lane order on component pairs where practical; disclose any remaining bias.

## Budget / rights

Disk floor10GiB, currently65GiB free. Reuse checkout, venv, model weights/cache;
no project copy or per-task build directory. Primary data research12min; bounded
reference download<=250MiB and at most4 independent image pairs with GT. No paid
API, new account or acceptance of unapproved terms. Boreas CC BY4.0 already
allowed, nuScenes remains uncleared. Checkpoints' training rights remain distinct
from code licence. Retain attribution/licence/version and raw file hashes.

Necessary decoder exception: install only the pinned binary wheel h5py3.16.0
into the existing qa/venv, --no-deps, existing uv-cache. PyPI cp312 macOSarm64
wheel is3,061,940 bytes, SHA256
42b012933a83e1a558c673176676a10ce2fd3759976a0fedee1e672d1e04fc9d.
No new venv or numpy upgrade. This reads Spring HDF5 ground truth, not an app.

Actual component trials: maximum4 external pairs plus at most24 selected OLD
M3O source/current timestamp pairs, three field arms, max168 model directions.
No full100+80 replay until input evidence shows a defensible improvement; do not
silently use component GT as runtime rescue. One evidence-backed execution repair
per phase, stop on resource limit or unproductive strategy. Old-data trials are
development, not new road validation. Fresh external flow data are component
holdout only, not unseen road warning proof.

## Completion / Verify

Actual component evidence is recorded below. Overall quality is NOT READY until useful recall and
false alerts are demonstrated together; unit tests alone cannot change this.

### Source identity evidence, before RGB model trials

Contractor viewed all12 original-source-bound sheets:16 distinct selected
hypotheses across8 nonempty cases, with4 cases having no selected source.
Visual decisions:11 same,3 different,2 unknown. A second AI visual review of
all16 hypotheses agreed, independently of the saved root decisions. Neither
is human certification or dense flow ground truth.

Clear mismatches: silver SUV instead of dark Audi; recording-vehicle hood
instead of cross-street pickup; foreground VW instead of pickup. These are
selected *unsupported hypotheses*, not emitted wrong warnings. They do not
explain all19 misses. The two dark right-side pedestrian pairs remain unknown.

The fixed review-fixture manifest SHA is
934c2d886b2bcc23c5e1411479869db4e050a62f7e1d58a248f19735d57610e2.
Rendering used identity-tool b5ef305e6d766e82dce0e548321c5700b4da1e9302f153fdf7315d32c3ecd324.
Subsequent coverage/K/pose hardening produced identical12 records and16 units
without rerendering; current identity tool is2a045a1927146f3f47312411b535cf562893f2bffd67c8f7771768c085124c34.
No earlier generator hash is relabelled as the hardened version.

The predeclared real-pair component fixture has12 unique timestamp pairs and
16 distinct box hypotheses. Three field arms compute each timestamp pair once,
24 directions/arm,72 total. Frozen per-pair pixel verification is measured
separately from identity labels, which enter only the scorer. No full rival
association or temporal warnings are claimed by a supported individual pair.

### Actual RGB/detail component trial

Frozen adapters: `assist_scene_m3p_field.py` SHA
dd50924309bdd09e7cc3fc533610fbe0289d4d03bb8e1d1fbc9bb693bdf77646.
Frozen pair runner: `assist_scene_m3p_pair_study.py` SHA
429b29e939668f8d88400108e052e422bddf9398950263d1d49844f316dcbfac.
No algorithm/floor changes after the trial. Root ran one actual MPS study;
no runtime repair/retry was needed. One resident pinned RAFT model,12 unique
OLD M3O timestamp pairs,24 directions/arm,72 actual directions total. Equal
JPEG93 input exposures, same original-working-pixel geometry, exact source-only
selections sealed before fields; only colour and processed input size differ.

| Pair component, not approach warnings | A gray640 | B RGB640 | C RGB768 |
|---|---:|---:|---:|
| Same-object hypotheses supported |2/11|1/11|2/11|
| Different-object hypotheses supported |0/3|0/3|0/3|
| Unknown identity hypotheses supported |0/2|0/2|0/2|

C supports exactly the same two units as A, gains0. B loses the turn29 fresh
pair because the unchanged FWD/-REV growth span floor is not met. This does
not prove RGB is universally worse or useless; it falsifies the proposed
improvement in this fixed development sample. No new warning-recall score
is manufactured from these pair results. No identity label enters replay.

The true source-pair fields for all12 A pairs exactly reproduce M3O field hashes.
This rules out a silently changed baseline in this comparison. Retained raw
forward/backward NPZ archives:36 files,261,250,742 bytes, below300MiB. Runtime
receipt hash9ff27849545381f2628d8a73499025bba179197f5216452308298a76ff3f7543;
score92b4df0c9733c0338564f2df7c08d785597bdb435f89c86c20364970b86a7e76.

Paired component time means source preparation+own field+verification, not
archive compression, detector, camera/identity association, temporal warning,
UI or device frame latency. Whole research replay31.446s includes all arms,
compression and3.739s startup. Measured p50/p95 per pair: A532.3/2144.2ms,
B533.6/737.5ms,C553.9/1328.5ms. All lane positions are balanced4 times in the
12-pair cycle, but cold shape/runtime cost remains, especially the first A
pair. Exploratory warm11 medians527.4/534.6/549.0ms are not a preregistered
speed-win criterion. No speed or smoothness improvement established. Swap
was0 before and after; peak RSS/GPU/thermal behaviour was not measured for
this run. No heavy scoring/test job overlapped its model inference.

Two peer verification passes and root direct recount confirmed source/model/
code/clock/policy bindings,15 distinct source PNG hashes,36 raw field archives,
24 grayscale exposure bindings and exact actual calls. Six selected arm/pair
proofs were reconstructed from original PNG→JPEG and saved flow arrays; source
selection/patch/directional proof values matched. Eight RGB preprocessing/padding
hashes were recomputed. These are structural/model-output checks, not physical
flow accuracy or human product certification. A synthetic analytic positive
case still passes the pair verifier; it does not certify the natural cases.

### Independent Spring reference: rights resolved, retrieval failed

Official DaRUS API verified RELEASED Spring v2.0, dataset CC BY4.0 and unrestricted
archive IDs/sizes. This is stronger evidence than inferring dataset rights from
the Blender asset or a GitHub code licence. Attribution is retained in metadata.
Primary sources: [official dataset](https://doi.org/10.18419/DARUS-3376),
[official FAQ](https://www.spring-benchmark.org/faq),
[official flow reader](https://github.com/cv-stuttgart/flow_library/blob/master/flow_IO.py).

The additive ZIP64 fetcher reads only exact206 Content-Range records, validates
archive ETag, size/CRC/member paths/decompression limits, and refuses a complete
13–47GB archive transfer. Sequence0001/0002 left frames1→2 were fixed from
filenames before pixels/model results. First attempt downloaded one6,232,017-byte
PNG, then the second image timed out. One authorized infrastructure repair used
512KiB exact ranges and retained the first verified file. It also timed out;
no third attempt. Cumulative actual fetch receipts:7,694,882 bytes received,
12,705,523 reserved,19 requests and2 failed transfers. Earlier metadata-only
research probes are additional network traffic and are not falsely included
in this ledger. No full archive, model or new checkout was downloaded.

Final reference `complete:false`, `completeReferencePairs:[]`: **no flow file
and no complete labelled pair available**. Spring model executions0, pixel
EPE/false-match accuracy UNMEASURED. Incomplete inputs reject before model
allocation, independently checked even with a nonexistent checkpoint argument.
Partial valid data and both attempt receipts remain for a future authorized
targeted continuation; no unsupported accuracy claim is hidden by unit tests.

Prepared independent benchmark preserves the official convention: GT vectors
are already native-HD pixel units despite their2H×2W sampling grid. Error uses
minimum norm over the four GT samples, not vector averaging or division by2.
Fl outlier uses EPE>3 AND EPE>5% of the maximum GT vector norm. Native match maps
are logical RGB, first two channels OR; invalid GT and invalid prediction
denominators remain distinct. Prediction vectors are rescaled by actual axes
when restoring from working to native coordinates. The benchmark is not an
official withheld-subsampling leaderboard submission. Primary implementation:
[evaluation.py](https://github.com/cv-stuttgart/springwebsite/blob/b27a29c3af0c85f40f05a439311a6e02f706f764/springeval/management/commands/evaluation.py),
[map and GT grouping](https://github.com/cv-stuttgart/springwebsite/blob/b27a29c3af0c85f40f05a439311a6e02f706f764/subsampling/create_evalfiles.py).

One necessary local decoder package h5py3.16.0 installed in the existing venv,
HDF52.0.0, numpy2.5.4 unchanged. The initial uv process stalled on its wheel;
root terminated only that process and a bounded no-retry installation completed.
No source build, app installation or extra environment. The decoder cannot
turn a missing flow file into valid reference evidence.

### Disposition

No RGB candidate promoted. No full new100+80 replay: the preregistered component
improvement condition failed, so another expensive all-silent replay is not
justified. No easing of thresholds, new tracker, guessed metres or repainting
stale output to appear smooth. Old full-warning quality remains M3O0/19, not
retested or relabelled here. No phone, native app mutation, deploy, commit or push.

Requirement coverage: input/colour/detail adapters IMPLEMENTED+actual trial;
source-identity audit IMPLEMENTED+AI visual review; independent labelled-flow
benchmark IMPLEMENTED but accuracy BLOCKED by incomplete source retrieval;
useful warning recall/smoothness NOT IMPROVED. Direct LLM/agent perception
comparison remains unmeasured; no cloud superiority claim.

The next decision must test a genuinely different source-identity/correspondence
method on a complete independent reference, rather than another RAFT speed or
colour tweak. The selected-source audit now distinguishes incorrect hypotheses
from correct-identity pairs lacking valid geometric evidence. These are separate
failures to address. Until that evidence exists, the user-facing approach feature
is NOT READY. Technical QA status is reported separately below.

### Retained evidence and hygiene

`docs/evidence/tip65/m3p-identity-{manifest,decisions,reviewed}.json`,
`m3p-real-pair-score.json`, `m3p-root-verification.json`,
`m3p-spring-{dataset-metadata,fetch-attempt1,fetch-incomplete}.json` retain sources
and limitations. Actual fields/receipts and attributed images remain under the
existing ignored qa directory, not in Git. The pair-runner's own
`codex-tmp-m3p-pair-*` JPEG staging auto-cleans; no scratch project or extra
build directory was created. Current disk free62GiB, no unrelated deletion.

### Regression QA, separate from model quality

The complete structural gate did **not** pass. Receipt:
`docs/evidence/tip65/mac-readiness/runs/2026-11-17T04-13-04-316Z-b90e14d2/summary.json`.
Node policy12/12 passed; complete Python discovery reached its180s limit
(180,034ms, SIGTERM). No assertion failure was reported before termination,
but an incomplete run is not a pass. Swift/typecheck were not reached by that
fail-closed gate. The541 discovered tests are not reported as541 passes.

A focused existing M3O DIS-positive test passed with explicit OpenCV
setNumThreads(1) in6.703s (reported actual thread count10), and with
setNumThreads(0) in23.676s (reported1). These are diagnostic executions under
different host load, not a controlled speed benchmark or proof of the timeout's
cause. No thread-policy or timeout change was promoted to make QA green.

Targeted M3P46/46 and flow-reference8/8 tests passed. A supplemental receipt at
`docs/evidence/tip65/mac-readiness/runs/2026-11-17-m3p-supplemental/summary.json`
records these checks, policy12/12, Swift121/121 and successful TypeScript
typecheck. All supplemental stages passed, with unchanged before/after source
fingerprints; no tests skipped. Its targeted status cannot replace the failed
full-discovery gate. Semantic acceptance and release approval remain false
independently of structural test results. `git diff --check` is clean. The11
pre-existing tracked edits retain233 insertions/23 deletions; the separate phone
UI remains untouched. No own scratch directory remains;61GiB free at final check.
