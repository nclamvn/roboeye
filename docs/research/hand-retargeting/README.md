# Hand retargeting research — 2026-09-13

## Finding, not a leaderboard

The current RoboEye limitation is partly mathematical: copying bone directions
onto a different palm does not preserve endpoint coincidence. Repeated temporal
filters operate in bone space rather than the space of contact constraints. Neither
a new material nor a higher render FPS fixes that mismatch. This is code inspection,
not a claim extracted from papers. Camera occlusion is a separate upstream limit.

Four selected primary-source projects were captured in full. `claims.jsonl` contains
short verbatim spans; `domain.yaml` explicitly defines this selected sample, not the
entire research universe. Unknown RoboEye latency and unverified licenses stay null.
No project has been declared "the most advanced" based on incomparable benchmarks.

| Source | Relevant lesson | Application decision |
|---|---|---|
| [Dex Retargeting source](https://github.com/dexsuite/dex-retargeting/blob/main/src/dex_retargeting/optimizer.py) | Projects fingertip distances; separate enter/escape thresholds | Use explicit inter-tip objectives; original TypeScript implementation, not a Python dependency |
| [GeoRT official repository](https://github.com/facebookresearch/GeoRT) | Rig-specific training; non-commercial terms; authors warn about MediaPipe deployment distribution shift | Do not import weights/code or promise its reported speed on a webcam/browser |
| [AnyDexRT, July 2026 preprint](https://arxiv.org/abs/2607.08341) | Contact classifier refines learned retargeting | Contact is a separate objective, not a gesture label; no model adoption claimed |
| [C2Dex, August 2026 project](https://k-jie.github.io/C2Dex/) | Stable object-side contacts guide trajectory reconstruction | Relevant longer-term for hand-object motion, not a drop-in live fingertip tracker |

Implementation inference: add bounded task-space IK to the existing renderer and
preserve contact after filtering. This does not reproduce any entire paper, does
not infer forces, and is not a physically validated robot controller.

## Verification and reproduction

Run the installed refinery engine against this directory, then its `bites.py`.
On 2026-09-13: 7 claims / 4 entities; independent auditor and deterministic build
passed. Five applicable negative gates caught deliberately injected faults; other
gates are explicitly N/A. Snapshot SHA-256 values are recorded in `snapshots.sha256`.
The two author presentations of one project must never count as independent sources.

## Acceptance still needed beyond source research

Record locally, with user consent, open → pinch each pair → three/four fingertips →
fist → release, including moving contact, side views, partial occlusion and both
hands. Compare source landmarks, retargeted skeleton and rendered shell tips on the
same timestamps. Measure endpoint error and dropout separately from solver time.
Synthetic tests cannot certify recognition accuracy or motion-to-photon latency.
