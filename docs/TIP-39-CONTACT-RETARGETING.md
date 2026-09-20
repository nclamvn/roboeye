# TIP-39 — Fine hand articulation and contact-aware retargeting

Priority P0. Depends on TIP-38. Local RoboHand only; no deployment authorization.

## Scan / Contractor decision

Current code copies independent bone directions to a different-sized fixed palm.
No objective preserves fingertip positions or contacts. Direction filtering and
render interpolation can reopen a closed contact. Gesture labels only recognize
thumb/index and do not drive the geometry. Previous tests prove link lengths, not
precision gestures. The user's 40% is experience feedback, not a measured score.

Research registry: `docs/research/hand-retargeting/`. Keep sources and inferences
separate. GeoRT requires a rig-specific trained model and carries non-commercial
terms; do not copy or load it. Recent contact-aware papers are evidence for design
principles, not proof of browser readiness or RoboEye accuracy.

## Blueprint / requirements

- R1: retain the tracker, fixed palm and offline browser architecture. Add original
  task-space retargeting with fixed-length articulated chains and bounded IK.
- R2: measure all ten fingertip pairs in hand-local 3D. Continuous close-contact
  weighting, no hard gesture-pose replacement; support thumb to each finger and
  simultaneous three/four-finger contact without collapsing tips to one point.
- R3: preserve constraints AFTER temporal smoothing and at final render, so filtering
  cannot reopen the pinch. Keep small noncontact movement continuous.
- R4: automated before/after fixtures cover contact, release, fist, open hand,
  rotated/mirrored/scaled sources, finite bone lengths, bounded bends and cost.
- R5: add local replay views and report actual gaps, not only FPS or gesture names.

Acceptance: source-close pairs reduce median baseline error by >=70%; evaluated
contact gap residual <=0.035 rig units; no bone stretch (1e-6). Open/release must
not snap to a preset. Test filtered/rendered output, not merely raw solver points.
Performance measured separately from camera inference, with hardware/runtime noted.

Decision log: skip another approval round: user explicitly requests applying the
solution within the existing feature; no cloud upload, hardware purchase, model
license adoption or unrelated architecture replacement. Contractor and Builder
roles executed sequentially, as requested. Live-camera acceptance remains required.
