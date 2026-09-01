# VERIFY: TIP-28 AirSketch Direct-manipulation Recovery

1. Run `npm run typecheck` and `npm run test:unit`.
2. Verify the controller test proving that a pinch leaves the cursor at the
   index fingertip and that an open-palm → open-pinch sequence enters grab.
3. Run `npm run test:airsketch-e2e`; verify the mock worker produces a visible
   stroke, moves a completed object with an open-pinch grip, and emits at least
   one capture-to-main pipeline metric.
4. In a camera session, point with the index finger, then pinch without moving
   the index: confirm no visible pen jump. Draw a short line and intentionally
   move quickly: confirm a brief landmark loss does not split it.
5. Hold an open palm for the status countdown, move the index cursor over a
   completed drawing, then pinch thumb/index while other fingers stay open:
   confirm the object is selected, follows the hand, and drops on release.
6. Inspect `window.__roboeyeAirSketchBenchmark.snapshot()` after a short
   session: `hand` and `pipeline` both report nonzero samples and p50/p95.
