# Completion Report — TIP-22

## Status

DONE

## Root cause repaired

The T21 safe fist correctly returned the interaction to `idle`, but `idle` had no open-palm transition to `manipulating`. This made already placed objects unreachable unless the user happened to open their palm while still drawing.

## Delivery

- `idle + openPalm → manipulating` is now an explicit, non-drawing transition.
- The transition resets partial flick count, so entering the grab workspace cannot arm the pen.
- Unit and browser tests cover draw → idle → open palm → pinch grab → release/place.

## Verification

- Unit: 39/39 PASS.
- AirSketch browser E2E: PASS, including post-idle grab and visible `Đã đặt vật thể` status.
- Full `npm run qa`: PASS, including security, detection and release contracts.
