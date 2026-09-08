# TIP-36 · RoboHand verification and release

## Context

The feature is not complete when the model merely renders. Its worker, solver,
HUD, fallback renderer, responsive layout, release metadata and regression
suite must travel together through the same production artifact.

## Tasks

- Add deterministic worker-to-DOM RoboHand E2E on WebGL2 fallback.
- Gate RoboHand E2E in local QA, CI and release workflow.
- Verify mobile layout, tracking-loss UI and local metrics.
- Update README, changelog and release version.
- Re-review the expired Node-only sharp accepted-risk against the current
  Transformers.js dependency declaration before allowing the release gate.
- Run full QA, release verification and a visual browser smoke.

## Acceptance criteria

- Mock E2E proves mode lifecycle, live local video, 21-point overlay,
  handedness, gesture, hold behavior and p50/p95 metric samples.
- 375 px viewport has no horizontal overflow and keeps proof camera visible.
- Unit, typecheck, build, security, detection, AirSketch, RoboHand and release
  contracts pass.
- Release metadata reports `1.5.0` and Git diff hygiene is clean.

## Constraints

- Mock E2E is a wiring contract, not a claim of real-world pose accuracy.
- Real Hand Landmarker performance remains governed by the existing model smoke.
- Tag creation is outside this TIP unless explicitly requested by Homeowner.
