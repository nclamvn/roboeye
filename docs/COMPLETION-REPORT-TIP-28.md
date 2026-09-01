# Debug Completion Report — TIP-28

**STATUS:** FIXED

## Bug summary

AirSketch ink did not remain visually tied to the finger and completed strokes
were difficult or impossible to pick up and move with a natural pinch.

## Root cause

This was a logic/state fault, not a model-load or canvas-render fault.

1. The controller changed the reference from index tip to thumb-index midpoint
   exactly when pinch started.
2. Manipulation accepted a pinch only after the user also folded the remaining
   fingers (`pinch && !openPalm`), contradicting the intended two-finger grip.
3. A single null landmark immediately released the current interaction.
4. Observability stopped at worker inference, so capture/transfer/reply delay
   could not be distinguished from the model's own latency.

## Fix applied

- `src/airsketch-interaction.ts`: index tip is invariant; added stable
  `grabCursor`; open-palm workspace accepts a natural pinch.
- `src/main.ts`: use predicted cursor only for ink/display, stable cursor for
  scene hit-testing/movement; retain input for a bounded 120 ms missing-frame
  grace period; timestamp the bitmap-to-worker hand-off.
- `src/airsketch-metrics.ts` and `src/airsketch-types.ts`: add `pipeline`
  p50/p95 telemetry.
- Tests: unit coverage for invariant cursor/open-pinch; browser E2E uses the
  natural open-pinch sequence; real-model smoke requires a pipeline metric.

## Verification

| Gate | Result |
|---|---|
| TypeScript + production build | PASS |
| Unit suite | PASS — 45/45 |
| AirSketch mock E2E | PASS — 14 checks, including open-pinch grab and pipeline metric |
| Real hand/classifier smoke | PASS — hand p95 34.0 ms; capture→UI p95 34.1 ms on the controlled test host |
| Diff whitespace check | PASS |

## Residual risk

The controlled smoke camera is not a substitute for a human physical-camera
ergonomics session. Device CPU, browser and lighting can increase latency or
landmark jitter. The new `pipeline` metric makes that distinction measurable;
the manual acceptance steps are in `VERIFY-TIP-28.md`.

## Prevention

Any future gesture must preserve one explicit reference point from hover to
activation, and any prediction used for display must not be reused for a
small-target hit test. New interaction changes must cover both the state
machine and worker-to-canvas browser path.
