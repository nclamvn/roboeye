# Completion and verification — TIP-38

Date: 2026-09-08. Local implementation complete; camera acceptance still open.

## Root causes and corrections

- Moving camera-derived MCP origins did not match the static palm shell. The
  solver and renderer now share fixed robot palm anchors; human articulation is
  retargeted from those sockets, without deforming the rigid palm.
- Projected 2D palm width conflated rotation with distance. A multi-axis
  weak-perspective fit now compensates for viewing angle and camera aspect ratio.
- Point-wise display interpolation shortened the bone chain while shells stayed
  fixed-length. Direction interpolation now reconstructs every rendered chain at
  its fixed segment lengths.
- A fixed transverse-axis projection became singular near sideways fingers.
  Parallel transport now updates shell orientation without that roll singularity.
- The lower ulnar palm contour and tactile pad were narrowed toward the wrist.

## Verification

- Requirements R1–R5 implemented. Unit suite: 67 passed, 0 failed.
- Fixed palm sockets tested against three source widths and palm cupping.
- Scale tested over 24 yaw/pitch/aspect combinations; synthetic scale spread
  below 1e-8, with a separate approach test preserving 1.5x scale response.
- Adjacent shell endpoints checked on all 30 interpolated flexion frames.
- Shell roll tested through 61 directions across the old singular axis, with
  12 render steps per direction and bounded incremental angular changes.
- Production build and TypeScript: PASS. `git diff --check`: PASS.
- In-app browser forced-WebGL review: oblique, continuous synthetic rotation and
  flexed views inspected; no visible detached sockets in the inspected frames.
- Added continuous solver → filter → rig rotation to the design-review page.

## Limits and handoff

These tests verify structural invariants, not live-camera recognition quality.
Weak perspective remains an approximation and noisy/occluded world landmarks can
still affect orientation and scale. The rigid palm does not reproduce metacarpal
cupping. No motion-to-photon latency or zero-jitter claim is made.

Headless browser integration remains unverified: the prior local Chromium launch
aborted before page execution (SIGABRT / EPERM); it was not rerun for this change.
Browser visual review is not a substitute for end-to-end camera acceptance.

Vibecode contractor assessment: ready for local camera review; not yet declared
production-accepted. No commit, push, deploy or tag created for this revision.

- Camera application: http://127.0.0.1:4189/
- Synthetic review: http://127.0.0.1:4189/tests/robohand-design.html?webgl=1
