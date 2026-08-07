# TIP-24 — Detection lock frames and label badges

## Goal

Make each detector result readable at a glance on the live camera: the physical object is enclosed by a stable rectangular lock frame and identified by a badge physically attached to its upper edge.

## Rendering contract

- Coordinates retain the existing selfie mirror transform, so frame and detected object remain aligned.
- Every `DetBox` creates one `.det-lock`, one `.det-lock-badge` and one `.det-lock-label`.
- The badge contains uppercase Vietnamese label plus confidence percentage and is anchored to the lock's upper-left edge.
- If the object begins at the top of the view, the badge remains inside the video rectangle rather than clipping out of sight.
- The selected object has the existing stronger visual emphasis without hiding its label.

## Evidence required

Detection browser E2E asserts two mock boxes, two lock frames, two attached badges and two confidence labels while retaining the production 384 px detection source contract.
