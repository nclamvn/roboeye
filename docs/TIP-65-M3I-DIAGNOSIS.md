# TIP-65 M3I: causal measurement audit of the old M3H failures

16 November 2026. Mac-only diagnostic work. No iPhone, deployment, model call,
dependency install, threshold change, label edit, or new M3I holdout access.

## TIP and scope

Explain all 21 positive target-checkpoint misses retained from M3H before
choosing a different motion measurement. Replay the existing `CohortWindowLoom`
lane B from original bound exposures, clocks and detections. Separate current
detector absence, current camera rejection, and the actual history that prevents
a current, supported 320 ms optical measurement. Do not claim that a veto name
is a root cause, and do not make a new tracker or relabel hard cases.

The diagnostic is [machine-readable here](evidence/tip65/m3i-m3h-diagnosis.json).
It contains all 100 replayed frames, selective helper-return observations,
all 21 unchanged positive targets, exact current-ID lineages, and separately
marked backward IoU diagnostic chains. The latter can switch physical identity
and are not human-adjudicated MOT labels. Exact runtime-ID history, not that
approximate chain, supports the concrete examples below.

## Exact replay and provenance

Fresh lane B state reproduces **100/100 frames with zero mismatches** in status,
events, tracks, epoch, track reasons, cohorts, retired cohorts, identity
decisions and background evidence. There remain 0/21 positive notices. Source
image hashes, frame tokens, index, timestamp and relative stream clock are
checked; JPEG quality-93 staging is reproduced in memory. All original receipt
algorithm hashes and the OpenCV version must match before replay. The tracer
reads function locals at return with `sys.setprofile`, never writes them, and
restores the prior profile hook. Diagnostic affine RANSAC runs only after each
original update has returned; the original RNG seed is restored by its normal
per-exposure reseeding on the following update.

Bound original artifacts:

| Artifact | SHA-256 |
| --- | --- |
| M3H input | `9bce2cb8eec27f4b029e8b747e09fa541efe719e535227e71aacb0e0ad919c4a` |
| Raw original M3H receipt | `b7a28585abc8f3f1199b64a12c7c0e2acaf219a340fd0584670c9d7e131aa913` |
| Reviewed truth | `46e6f2ed9b157ec83d9db817801986512e440c3e9a5fba4983da2390b34e0202` |

The raw receipt and reviewed truth hashes in the evidence JSON are authoritative;
the source-code and source-reference-file hash maps are retained there too.
Reference geometry is opened only after optical replay. No reference position,
metric range or label enters the tracker; only evaluation ratios are serialized.

Final diagnostic script SHA-256:
`b78d0b8bdb2d9eb206f81356129491caa66b9c265c46094f9599f0ce9973e5ec`.
Final audit JSON SHA-256:
`6d1615a9293864561010e43166811d9f9f4b6c16a6b65b4dfb0d74d5136571ef`.

## Current categories: necessary distinctions, not the entire chain

| First current category, exclusive | Positive checkpoints |
| --- | ---: |
| No same-family detector box at reviewed IoU >= 0.35 | 5 |
| Matching detection but current background/camera evidence invalid | 6 |
| Current camera/detection valid but small or truncated | 1 |
| Current identity not verified by appearance or fresh pixel certificate | 1 |
| Current identity retained, no currently supported mature measurement | 8 |

All 21 targets remain in evaluation. A detector match failure means absence of
the required matching observation, not necessarily an empty detector frame.
The object becoming easier to identify would not manufacture optical evidence.

## Camera rejection: measured residual and coverage failure

Across 98 inter-frame pairs, 20 reject the background agreement check. There
are 78 valid pairs, two first frames, and **zero scale-ambiguity vetoes**.
Failures of the individual background checks overlap: support fraction 18/20,
occupied cells 12/20, axis span 9/20, absolute agreed-point count 2/20.
The helper still has 92 to 248 photometrically plausible background pairs on
these failures, so a blanket explanation of missing image texture is false.

The six current-camera target misses occur at four exposures:

| Exposure | Positive targets | Plausible pairs | Pose-agreed pairs | Fraction | Residual median / p95, px |
| --- | ---: | ---: | ---: | ---: | --- |
| urban 20 | 2 | 234 | 67 | 0.286 | 2.104 / 2.848 |
| urban 28 | 1 | 241 | 138 | 0.573 | 1.707 / 2.557 |
| urban 43 | 2 | 247 | 70 | 0.283 | 2.205 / 3.792 |
| traffic 20 | 1 | 208 | 96 | 0.462 | 1.901 / 2.854 |

The actual epipolar threshold here is 1.8 px and required fraction is 0.70.
Urban 43 additionally has only four occupied cells and axis span 0.381, below
five cells and 0.40. For urban 20, 241/242 reversible LK pairs survive the current
foreground mask, 235/242 pass photometry, and their intersection is 234. Therefore
its large final rejection is specifically in pose agreement, not foreground
mask removal or lack of matching pixel pairs. The JSON records both mask and
photometric support separately for every frame.

Not every rejection is the same: traffic 33 has excellent pose fraction
110/113 = 0.973, median residual 0.216 px, but only four occupied cells; traffic
38 has 68/92 = 0.739 and five cells but axis span only 0.300. These reject from
insufficient *spatial distribution*, not the support fraction. Every invalid
camera pair resets all measurement history, including history for objects that
are still present in current detections.

The source-geometry audit rederives native intrinsics and the optical-origin
corrected camera pose from the original calibration/pose files and checks their
exact match to the manifest for all 100 exposures, including RGB/pose clocks.
This tests the import arithmetic and binding, **not independent correctness of
Boreas rectification, camera clock semantics, rolling-shutter behavior, or pose
accuracy**. Pixel/pose residuals alone cannot distinguish a latent calibration or
time convention error from moving foreground leakage and incorrect LK pairs.
No source geometry repair is justified from this trace alone.

## Why retained IDs do not yet yield a measurement

The eight retained-ID misses are six immature-cohort cases and two with no
cohort remaining. Their exact histories give substantially different causes:

| Target checkpoint (instance prefix) | Exact history and current loss |
| --- | --- |
| urban 36, `2e79d849` | ID 113 first appears at 35. Cohort 103 is only 78.534 ms old, two samples, 42 points. ID preservation works but the object has not been observed long enough. |
| traffic 13, `e3baa0ad` | ID 22 is 559.578 ms old. Cohort 21 died at frame 7 from box/point-scale disagreement: box log growth 0.18929 vs pixel log growth 0.03951, difference 0.14979 > 0.12, despite 62/64 pixel pairs surviving. Cohort 26, seeded at 9, has five samples and 44/60 points but age 319.431 ms < 320. Cohort 32 is 79.920 ms old. |
| traffic 28, `db5e6ff7` | ID 74 is 640.827 ms old. Cohort 67 fails at 26 with 35 points < 0.60 x 59 = 35.4. Cohort 61 fails at 27 with 19 < 0.60 x 33 = 19.8. New cohort 83 fails similarity at 28: 31/48 inliers < 33.6. Only cohort 76 remains, age 239.173 ms. |
| traffic 36, `8dba1e1f` | Camera resets at 30, 31 and 33 destroy earlier windows. Current ID 144 starts at 33; cohort 99 fails similarity at 34 (34/50 < 35), replacement 104 fails at 36 (27/49 < 34.3), leaving none. |
| traffic 36, `246abe7f` | Current ID 158 starts at 35 after a small/truncated observation at 34. Cohort 107 is 78.686 ms old, two samples, 57 points. |
| traffic 36, `8d1721b1` | Current ID 154 starts at 34 while too small to seed. First cohort 108 is seeded at 35 and is only 78.686 ms old, two samples, 44 points. |
| traffic 44, `246abe7f` | Camera reset at 41 creates ID 207. At 44, older cohort 131 loses support: 55 previous points become 46 after FB, 36 after photometry, 34 after current-box filtering, below required 38.5. Current cohort 139 survives with 42 points but age only 78.529 ms. |
| traffic 44, `8d1721b1` | Camera reset at 41 creates ID 206. At 44, cohorts 130/138 retain 57/60 and 62/64 through FB/NCC/current-box checks. Overlapping other detections remove 34 and 31 points, leaving 23 < 42 and 31 < 44.8. Both cohorts die even though identity is retained. |

Numbers above are actual runtime populations, not fabricated extension of ID
age into measurement age. The 319.431 ms case identifies a cadence boundary;
it is not an argument to tune the floor on a seen checkpoint.

The remaining identity failure, urban 12 person `11f885d3`, has appearance
correlation 0.67850 < 0.70. Its independent one-pair identity probe starts with
28 points; after FB, NCC, box and overlap checks only 12 remain, below the
required 19.6. A new ID/cohort is created rather than borrowing an old age.
The small/truncated traffic 44 vehicle `31a6698f` is retained as a hard case;
its current detector box touches the protected image edge.

## Measurement model versus correspondence survival

Across all 100 frames, excluding disposable identity probes, the original
measurement validator runs 324 times: 252 supported, 47 insufficient point
support, 10 similarity-incoherent, eight box/point-scale disagreement, and
seven localized support. These are repeated cohort calls, not 324 independent
objects or benchmark samples.

Of the 47 insufficient-support calls, 40 fall below the original-seed fraction,
24 below the current-pair fraction, and four below nine absolute points (these
counts overlap). Nine already enter with a previous population below the
original-seed floor, so even perfect survival of that population cannot recover
the cohort on the next pair. Among these 47 failed calls, incremental losses are
68 at forward/backward checking, 125 at photometry, 25 at the current box, and
455 from overlapping other detections. Earliest threshold crossings are
recorded per call; the final counts should not be described as only texture
failure. No weakened support policy was tested or proposed as a causal proof.

Diagnostic-only unrestricted affine RANSAC uses **the same already accepted
pixel pairs** as each deployed similarity fit, with the same 1.2 px threshold,
250 iterations and 0.99 confidence. It meets the same inlier-count requirement
for nine of the ten similarity-incoherent calls. This is evidence that the
similarity model can reject coherent anisotropic/sheared image geometry, not
proof that every affine fit is physically correct. A six-parameter affine fit
has more freedom than a four-parameter similarity and can overfit.

Examples:

| Traffic frame / cohort | Similarity support | Diagnostic affine support | Median residual similarity -> affine, px |
| --- | --- | --- | --- |
| 18 / 47 | 19/30, needs 21 | 30/30 | 0.782 -> 0.308 |
| 28 / 83 | 31/48, needs 33.6 | 35/48 | 0.626 -> 0.436 |
| 34 / 99 | 34/50, needs 35 | 42/50 | 0.545 -> 0.298 |
| 36 / 104 | 27/49, needs 34.3 | 35/49 | 1.041 -> 0.533 |

Perspective change is a plausible source of local anisotropy, but this audit
does not identify a unique 3D cause or estimate a projective plane. Nor does a
passing affine fit mean that downstream age, visibility, growth, conflict and
camera requirements would pass. The 47 support failures remain support failures
even when an affine model fits the remnant points.

## Physical label versus optical direction

All 21 positive checkpoints have valid three-label reference histories. All
21 decrease in camera-to-object-center norm **and** optical Z over the reference
interval; zero have range closing while optical Z is stationary/increasing.
Thus that possible semantic mismatch does not explain these 21 misses. The
ideal rigid fronto-parallel inverse-Z scale factors span approximately 1.07 to
1.98, but are not measured surface growth, and do not establish rigidity,
visibility, silhouette behavior or correct image correspondences. Labels stay
unchanged and no metric distance is emitted or used by runtime.

## Completion / Verify and disposition

- Outcome: all 21 previous misses retained and individually traceable; first
  veto labels are replaced by computed camera, support, shape and history facts.
- Coverage: 100/100 old exposures replayed; all nine selected original surface
  fields agree; 21/21 positive references checked. No new benchmark was opened.
- Technical checks: diagnostic unit tests 6/6, original cohort tests 20/20 and
  original runner tests 8/8; exact frozen-source checks, finite JSON serialization,
  machine recomputation of replay/reference/source-geometry assertions and
  `git diff --check` all pass.
- Value evidence: partial, mechanistic development evidence only. No new recall,
  FP safety, direct-LLM advantage, end-to-end latency or generalization claim.
- Decision: a different *surface measurement* is justified for a bounded trial,
  especially one not forcing all local motion into similarity or box-scale
  equality. Another ID layer is not justified by these failures. Camera agreement
  and disappearing/occluded evidence require separate treatment and must not be
  hidden by the new fit. This diagnostic does not implement the candidate.
- Overall product status remains **NOT READY**. No runtime algorithm or label
  was changed, and this is not a release gate for a new method.

Disk preflight: 53 GiB available, no install, new venv, project copy, Docker or
build output. The final generated audit replaces its own diagnostic drafts;
no user data is removed. Existing dirty-worktree files are preserved.

Reproduce using the existing scene-qa venv and a new output pathname:

```sh
native/ios/.build-xcode/scene-qa/venv/bin/python scripts/diagnose_assist_scene_m3h_measurement.py --input native/ios/.build-xcode/scene-qa/boreas-m3h/input.json --receipt native/ios/.build-xcode/scene-qa/m3h-boreas-receipt.json --truth native/ios/.build-xcode/scene-qa/boreas-m3h/truth-reviewed.json --source native/ios/.build-xcode/scene-qa/boreas-m3h-slice --output NEW-OUTPUT.json
native/ios/.build-xcode/scene-qa/venv/bin/python -m unittest discover -s tests -p test_assist_scene_m3h_measurement_diagnosis.py -v
```
