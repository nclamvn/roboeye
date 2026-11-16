# TIP-65 M3I: independent post-holdout statistical audit

16 November 2026. Read-only inspection of the released M3I receipt, reviewed
truth and score. No image processing, model inference, heavy test, threshold
change, source edit, label edit or post-holdout tuning. This is stored-evidence
attribution, not causal image replay or an independent human review.

## Outcome and binding

The frozen candidate does not improve the selected user outcome on this holdout.
On the same 32 positive target-checkpoints, A has 3 TP / 29 FN; B and C each have
1 TP / 31 FN. Their one TP is shared with A. Both miss A's other two TP at urban
36: person `9eff4f1e` and vehicle `bfb04c06`. No claim of statistically established
population regression follows from these sparse, repeated-object checkpoints.

All 100 frames have B tracks and epoch exactly equal to A, and C tracks and
epoch exactly equal to A. The receipt's 17 source hashes match the actual files,
and its source-hash map equals the score's map. In particular:

- Region method: `bcd0219a7f7303bb533f8bc90d5a221a5efed7379235ce00b142c27257eb72d7`.
- Runner: `65975246ddbd975b58b0f4089a328e0aa26de76ef9c82408edbf7553006f457b`.
- Receipt: `49c320389f9d454973082b0a20650719fd20ad6aa94cd8d9fa5ae66a643532e6`.
- Reviewed truth: `baf71855938f12d9245f09d09fdfdfd601ad020863bedf73d847f5429c2c61ec`.
- Score: `7f132db8564a7f03818f8f1595bab4b8e9bd3d5f00161c37e9d637d09d040423`.

The input hashes agree across all three artifacts; the score's receipt/truth
digests match the supplied files. This audit covers the 100 real-video exposures
only. The separate 80 control exposures and their hash checks are outside this
statistical audit; their results belong to the Contractor's main verification.

## Exclusive first-current-veto accounting

For every positive target, the order is: scorer-matched TP; no same-family
detector box reaching IoU 0.35; invalid current A camera/source; small/truncated;
new/unverified A identity; missing/rejected/nonexpanding fresh pair; no eligible
long anchor; rejected/conflicting/insufficiently expanding long anchors.
The target is matched to the largest-overlap current track of its family;
TP assignment uses the scorer's event-to-target IoU/margin logic.

| Exclusive category | B ECC | C flow-affine |
| --- | ---: | ---: |
| TP | 1 | 1 |
| No same-family detector match at IoU >= 0.35 | 13 | 13 |
| Current source-camera invalid | 0 | 0 |
| Current small/truncated object | 1 | 1 |
| Current identity new/unverified | 3 | 3 |
| Fresh measurement rejected | 7 | 8 |
| No eligible 320-800 ms direct anchor | 2 | 2 |
| Every attempted long anchor rejected | 5 | 4 |
| Other fresh/long/conflict category | 0 | 0 |
| Total positive target-checkpoints | 32 | 32 |

The 13 detector-match absences are not necessarily empty detector frames.
No target was dropped or relabelled after results were opened. All ten selected
checkpoint exposures have a valid A source-camera status. Across all 100 frames,
A has 88 valid, ten insufficient-background-agreement, and two first-frame
statuses. The ten invalid frames are urban indices 1, 3, 4, 5, 6, 7, 9, 14, 48
and 49. Therefore a current camera veto is absent at the reviewed positive
checkpoints, but camera resets remain present in the surrounding histories;
zero in the exclusive current category does not mean zero causal history impact.

Fresh B failures are four insufficient photometric/cycle-support results, two
shape changes and one unavailable registration. Fresh C failures are seven
insufficient-flow-support results and one box disagreement. These are actual
stored reasons, not a demonstration that removing the corresponding gate is
safe.

The five B long-anchor failures comprise ten direct-anchor attempts: three
registration unavailable, three ECC correlation failures, two insufficient
photometric/cycle support and two shape changes. The four C failures comprise
eight attempts: six insufficient flow support and two insufficient final
photometric/cycle support. Anchor-attempt counts are not independent target or
video-sample counts.

## All 32 positives retained in accounting

Codes: T = TP; D = detector match absent; S = small/truncated; I = new/unverified
identity; F = fresh measurement rejected; W = no eligible long anchor yet;
L = all attempted long anchors rejected. Instance prefixes identify original
unchanged target IDs, not new object labels.

| Clip | Frame | Instance prefix | B | C |
| --- | ---: | --- | --- | --- |
| urban | 13 | `05ec9a42` | W | W |
| urban | 13 | `9eff4f1e` | D | D |
| urban | 21 | `05ec9a42` | F | F |
| urban | 21 | `bfb04c06` | W | W |
| urban | 21 | `9eff4f1e` | D | D |
| urban | 21 | `0353af0c` | D | D |
| urban | 28 | `bfb04c06` | T | T |
| urban | 28 | `9eff4f1e` | F | F |
| urban | 28 | `0353af0c` | D | D |
| urban | 36 | `9eff4f1e` | F | F |
| urban | 36 | `bfb04c06` | L | L |
| urban | 36 | `0353af0c` | F | F |
| urban | 44 | `0353af0c` | I | I |
| urban | 44 | `bfb04c06` | L | L |
| following | 12 | `93bc3c36` | F | F |
| following | 12 | `fafcf03f` | F | F |
| following | 12 | `cfd41f0d` | D | D |
| following | 20 | `93bc3c36` | F | F |
| following | 20 | `092d6d93` | I | I |
| following | 20 | `cfd41f0d` | D | D |
| following | 28 | `66f17f6e` | I | I |
| following | 28 | `38c026d0` | L | L |
| following | 28 | `cfd41f0d` | D | D |
| following | 28 | `8ab9fec8` | D | D |
| following | 36 | `38c026d0` | L | F |
| following | 36 | `c08e43cb` | D | D |
| following | 43 | `a65ca282` | S | S |
| following | 43 | `cfd41f0d` | D | D |
| following | 43 | `f33355c3` | D | D |
| following | 43 | `a596d6dd` | L | L |
| following | 43 | `01a52b69` | D | D |
| following | 43 | `7c95bd7a` | D | D |

The shared TP, urban 28 `bfb04c06`, has supported direct anchors of 641.340 ms
and 480.206 ms. B's corresponding linear log growth is 0.14513 / 0.10306; C's
is 0.15221 / 0.11254. Both also have positive current-pair evidence. At urban
36 the same ID still has current evidence, but B's two long comparisons both
return registration unavailable and C's both fail final photometric/cycle
support. This is a measurement availability limit, not an ID mismatch.

For person `9eff4f1e` at urban 36, B retains 26 of 45 seeds, below 0.70 x 45 =
31.5; C fails its pre-fit flow support. At following 12 the B fresh pair on
`93bc3c36` retains 45 of 65, below 45.5; following 20 retains 58 of 83, below
58.1. These narrowly failed floors remain unchanged. They are not permission
to retune on the holdout.

## False notices and unknowns

| Stored result | A | B | C | S box-only |
| --- | ---: | ---: | ---: | ---: |
| Positive TP / 32 | 3 | 1 | 1 | 10 |
| Positive FN / 32 | 29 | 31 | 31 | 22 |
| FP / two labelled negative checkpoints | 0 | 0 | 0 | 0 |
| Unmatched reports at reviewed frames | 0 | 2 | 1 | 6 |
| Reports at unreviewed frames | 29 | 39 | 15 | 130 |
| Total notices over 100 frames | 32 | 42 | 17 | 146 |

There are also three unknown targets, with zero notices matched to those unknown
targets in these results. The two B unmatched reports and one C unmatched report
are unresolved: sparse target labels do not establish whether they are true or
false notices. The unreviewed-frame reports are likewise neither certified TP
nor certified FP. Therefore the supported wording is "no observed FP on the two
labelled negative target-checkpoints," not "no runtime false positives" and not
"safe." The box-only lane's larger TP count does not establish better overall
quality, given its numerous unresolved notices and separate control behavior.

## Disposition

Independent ID equality is proven on the stored 100-frame surfaces; improved
approach recall is not. A different direct-region measurement remains a failed
candidate for the selected holdout outcome, with no evidence-based reason to
promote it to the app. Keep the result, report the unresolved notices, and leave
source, labels, policy and thresholds frozen. No new safety, real-time,
cross-domain, metric-distance or general product-readiness claim is supported.
This is opt-in Mac research only. The app has not been updated, and this
candidate is rejected for promotion. No source, label or threshold was tuned
after opening the holdout.
