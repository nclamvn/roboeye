# COMPLETION REPORT — TIP-49L-A

**Date:** 2026-09-17
**Builder status:** DONE
**Contractor verdict:** ACCEPTED for the local software workbench; real camera runtime evidence remains pending.

## Outcome

DriveSense now exposes concrete browser camera devices and can select a MacBook camera or a phone that macOS presents as a webcam. The live pipeline no longer equates “camera” with detector-only operation: bounding boxes remain on the responsive detector path while a same-frame depth snapshot runs independently at a bounded maximum cadence of 2 Hz.

Depth results are conservative by construction. A result must belong to the active source epoch, arrive within the freshness budget and match a current vehicle track at IoU ≥0.5. It cannot override an applied geometric camera profile, advance track identity/time or survive as a current metre value after expiry. Unmatched, late and expired evidence becomes unknown.

## Delivered files

- `src/drive/camera-source.ts`
- `src/drive/tracking.ts`
- `src/drive/app.ts`
- `drive.html`
- `src/drive/drive.css`
- `tests/unit/drive-local-workbench.test.ts`
- `docs/TIP-49L-A-LOCAL-MULTISOURCE.md`

## Acceptance coverage

| Criterion | Result |
|---|---|
| Enumerate/deduplicate labelled video inputs | PASS — deterministic unit test |
| Exact selected-device constraint plus safe environment-camera fallback | PASS |
| Detector does not wait for depth | PASS — separate pending requests and dispatch after box publication |
| Same-frame depth joins only a compatible current track | PASS — unit tested |
| Range survives a newer detector frame briefly, then expires | PASS — unit tested |
| Old depth cannot alter a newer incompatible timeline | PASS — unit tested |
| Supplied geometric profile stays authoritative | PASS — existing range-quality regression |
| Local report includes live metric attempts/accepted/dropped and source/runtime metadata | PASS — schema v7 implementation review |
| Pixel bytes/local paths absent from telemetry rows | PASS — telemetry contract regression |

## Verification evidence

| Gate | Result |
|---|---|
| Focused DriveSense scenarios | PASS — 39/39 |
| Full unit suite | PASS — 171/171, 0 fail |
| TypeScript check | PASS |
| Production build | PASS — 67 modules transformed |
| Security audit | PASS — 0 critical/high; Sharp exposure 0 |
| Diff hygiene | PASS — `git diff --check` |

## Runtime gate not yet satisfied

Automated verification cannot grant camera permission or prove a particular iPhone/Mac transport. The remaining local evidence is operational, not another implementation phase:

1. Select FaceTime/Continuity/USB camera from the new list.
2. Run a foreground camera session, export the JSON report and inspect source dimensions, detector timing, depth attempts/accepted/dropped and capture→overlay P95.
3. Confirm that unplugging/switching the camera resets the epoch and removes stale measurements.

No camera hardware purchase, fixed mount or on-road use is authorized or implied.
