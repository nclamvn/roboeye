# Completion Report — TIP-21

## Status

DONE

## Delivered

- Closed fist is the explicit idle/transport pose: it ends a live stroke, cancels a held pinch and hides the cursor.
- Extending the index after a fist is intentionally inert; two deliberate flicks must arm the pen again.
- The first extended index frame after a fist cannot be miscounted as an activation flick.
- Repeated neutral → arm → draw → neutral loops preserve every completed stroke/object.
- Long movement segments are interpolated before canvas rendering for a smoother visible line at hand-tracking frame rates.

## Verification

- Unit: 38/38 PASS.
- Production typecheck/build: PASS.
- AirSketch browser E2E: PASS using fist → double-flick → real canvas stroke.
- Full `npm run qa`: PASS, including security, detection and release contracts.

## Scope discipline

The former implicit pinch-to-draw compatibility path was deliberately removed because it conflicts with the approved safety gesture. Pinch remains exclusively for grabbing during manipulation.
