# Completion / verification — TIP-39

Date: 2026-09-13. STATUS: PARTIAL (implementation done; live-camera acceptance open).

## Root cause

Direction copying with different palm anchors and phalange lengths does not preserve
fingertip coincidence. No contact objective existed. Both filtering and render
interpolation could change inter-tip distances. Existing tests mostly checked
finite/fixed-length links, not precision manipulation. The user's "40%" describes
experience; no camera dataset establishes that numeric accuracy.

## Changes

- Added original TypeScript contact-first damped IK, with bounded corrections,
  fixed palm/lengths and planar PIP/DIP articulation for affected fingers.
- All ten pairs considered from world-space landmarks, normalized by palm width.
  Continuous proximity weighting; no canned gesture poses. Tiny separate contact
  endpoints avoid collapsing a three/four-finger group into a single point.
- Distal orientation is a secondary null-space objective, not a competing reason
  to lose fingertip contact. Broad, uncontacted articulation stays unchanged.
- Tip-target filtering plus constraint projection after filtering and during
  render. The diagnostic UI reports unresolved contact instead of implying success.
- Added Vietnamese summaries for multi-finger and non-index thumb contacts.
- Added independent analytical fixtures, a reproducible CPU benchmark and local
  before/after replay controls. Synthetic fixtures do NOT replace camera recordings.
- Refinery: four primary-source projects, seven sourced claims, raw snapshots,
  SHA-256 manifest, deterministic audit and five applicable negative gates passing.

## Quantitative results

Values below are fingertip *gap residual* relative to the 0.025 rig-unit separation
target; they are neither millimetres nor camera-recognition accuracy.

| Gesture | Direction-copy baseline | New filter + IK |
|---|---:|---:|
| Thumb–index | 0.164995 | 0.001173 |
| Thumb–middle | 0.133041 | 0.003526 |
| Thumb–ring | 0.057020 | 0.000849 |
| Thumb–little | 0.111254 | 0.000907 |
| Three tips | 0.164995 | 0.006264 |
| Four tips | 0.164995 | 0.017805 |
| Index–middle | 0.014770 | 0.007058 |

Median residual: 0.133041 → 0.003526 (~97% reduction on this selected synthetic set).
Do not report this as "97% hand-tracking accuracy".

Benchmark at 03:47 UTC: Apple M1 Max, Node 24.14.1, 100 warm-up + 1,200 measured
frames. Solve/filter p50 0.130 ms, p95 0.310 ms; rig update p50 0.082 ms, p95 0.204 ms.
Excludes camera capture, MediaPipe, GPU rendering and motion-to-photon latency.
Reproduce: `node --import tsx tests/robohand-precision-benchmark.ts`.

## Verify

- Requirement coverage: R1–R5 implemented (5/5, 100% implementation, not acceptance).
- Unit suite: 74 passed / 0 failed; seven new precision test groups.
- Precision contact: seven gestures; 84 mirrored/scaled/rotated variants; passing.
- Moving contact: checked final shell endpoints from the first rendered frame, not
  only solver points. Bone lengths remain within 1e-6.
- Open/free fingers unchanged, release, micro-motion continuity, noise attenuation,
  fast response, 3D versus 2D overlap and invalid observations: passing.
- Browser: forced-WebGL before/after, two/three/four tips and fist inspected. No
  console errors observed in the diagnostic tab. Whole-mesh collision certification
  is NOT implied by endpoint tests or screenshots.
- TypeScript: PASS, zero errors. Whitespace: PASS. Dedicated lint script: absent.
- Production build: PASS (`npm run build`, exit 0; Vite bundle completed in 64 s).
- Main application smoke check: local page initialized v1.5.0 with WebGPU ready;
  no console errors observed. Camera capture was not started during this check.

## Deviations and remaining acceptance

The old filter-isolation tests now omit task-space objectives explicitly: their
schematic DIP positions were not anatomical IK fixtures. Original filter assertions
were retained. Separate full-pipeline precision tests use articulated source hands.
An early global position fit bent uninvolved fingers; visual review caught this and
the free-finger invariant now prevents it. A competing orientation objective reopened
contacts; it was replaced with contact-first null-space orientation correction.

No cloud model, new dependency version, paid asset or GeoRT weights/code adopted.
GeoRT's documented non-commercial terms and rig-specific training are not silently
treated as production permission. Newer research is catalogued, not claimed deployed.

The environment had offloaded/dataless dependency files; exact lockfile tarballs
were restored from npm after SHA-512 verification. No lockfile or dependency-version
change was made. Initial build/start attempts waited on filesystem reads, not IK.

P0 still open: real-camera recordings with ground truth for occlusion, fast motion,
side-on pinches and different users. Contact is inferred from noisy 3D landmarks,
not measured force; the algorithm cannot recover hidden fingertips with certainty.
No full mesh self-collision solver, object collision, grasp forces, tactile contact
or physical robot safety controller. Active IK has conservative procedural bounds,
not a manufacturer's validated URDF joint/collision model.

Contractor status: READY for local testing; NOT READY for production acceptance of
precision manipulation. No commit/push/deploy in this turn.

Local replay: http://127.0.0.1:4190/tests/robohand-design.html?webgl=1
Local application: http://127.0.0.1:4190/
