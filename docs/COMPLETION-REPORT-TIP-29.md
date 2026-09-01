# Completion Report: TIP-29

## Scope

Investigated and repaired AirSketch broken strokes and difficult object pickup
as state/coordinate-contract failures, without changing the hand model or
loosening detection confidence thresholds.

## Delivered

- Continuous pinch drawing after safe entry.
- Controller-owned bounded missing-landmark continuity.
- Visible-cursor selection plus stable-coordinate drag anchoring.
- Deterministic regression coverage and release verification.

## Residual risk

The browser can retain input for only the 240 ms bounded continuity window; a
hand that leaves the camera field must still release. Real-camera ergonomics
remain device/light dependent and are not a life-safety control.
