# TIP-38 — Palm attachment and motion stability

Priority P0; continuation of TIP-37 under the user's correction.

Root causes verified in code: a rigid palm mesh with camera-derived moving MCP
origins; projected palm width used as depth scale; independent point interpolation
shortening joints while shell lengths remain constant; shell roll singularity at
the transverse reference axis.

Requirements: R1 rigid shared palm anchor contract; R2 fixed-length display chains;
R3 angle-compensated scale with camera aspect ratio; R4 continuous shell roll;
R5 reduce excess lower ulnar palm contour and review oblique motion.

Acceptance: automated anchor invariance across differing source palms, scale
invariance over yaw/pitch sweeps while retaining distance response, adjacent shell
endpoints remain connected on every interpolated frame, no roll flip across the
old singular axis. Inspect front/oblique/flexed renders and report limits.

Decision: keep the approved fixed-proportion robot and existing tracker. Fit human
articulation onto its rigid palm. Physical metacarpal cupping is outside this rig.
No additional approval gate: correction requested by the user within existing scope.
