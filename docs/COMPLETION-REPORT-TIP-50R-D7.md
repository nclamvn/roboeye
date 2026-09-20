# Completion Report — TIP-50R-D7

## Outcome

DriveSense now exposes `Khoảng cách` and `Làn` as two adjacent feature toggles in the in-video transport dock. The lane-only URL no longer leaves users without a visible way to restore vehicle detection and metric estimation.

## Behavior

- Each feature has an explicit pressed state plus a small state indicator: neutral/off, amber/loading, green/ready.
- Enabling `Khoảng cách` on an unprocessed video switches off lane inference and starts the detector + metric pipeline.
- Enabling `Làn` while live or unfinished distance inference is active stops that heavy pipeline explicitly, avoiding hidden resource contention.
- A completed file replay can coexist with lane inference because replayed boxes/ranges no longer consume detector/depth inference.
- Turning distance display off preserves a completed local replay so it can be restored immediately.
- The existing Analysis surface remains available for advanced settings, calibration and diagnostics.

## Verification

- TypeScript typecheck: pass.
- Production build: pass.
- `git diff --check`: pass.
- Browser interaction test: pass with zero page errors.
- Browser checks: two visible toggles; correct lane-only initial state; distance starts the pipeline; unfinished distance disables lane; distance stops; lane restores; both toggles remain visible at 390 px width.

Evidence: `/private/tmp/roboeye-drive-feature-toggle-qa/result.json` and screenshots in the same temporary directory.

## Scope

This change unifies controls and feature-state behavior. It does not change detector, depth, road model, calibration, distance validity policy or warning thresholds.
