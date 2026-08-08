# Completion Report — TIP-25

## Status: DONE

The live object-detection overlay no longer remains hidden after the operator enables recognition. Lock frames and their top-edge badges are now renderable over RGB/Depth camera modes.

## Files changed

- `src/ui/shell.ts`
- `tests/detection-e2e.mjs`
- `docs/TIPS.md`
- `docs/TIP-25-DETECTION-OVERLAY-VISIBILITY.md`

## Verification

| Requirement | Result |
| --- | --- |
| TypeScript typecheck | PASS |
| Existing box and badge contracts | PASS |
| SVG computed visibility contract | PASS |
| Detection E2E | PASS |

## Deviation

No architectural change. The fix uses the existing `drawDetections` render boundary; no model, coordinate transform or detector threshold was altered.
