# Verify TIP-29

1. Run `npm run typecheck` and `npm run test:unit`.
2. Confirm the interaction tests cover pose-noise continuity and the bounded
   180 ms/240 ms loss boundary.
3. Confirm the scene test selects through a predicted visible cursor, keeps
   the object stationary on the same stable anchor, then moves/scales it.
4. Run `npm run test:airsketch-e2e` and `npm run release:verify`.
5. In a camera session, begin a thumb–index pinch and draw while turning the
   wrist slightly: the current line must continue until the pinch is released.
   To pick up an object, place the visible cursor on it, hold the open palm
   until the workspace prompt, then pinch: it must select where shown and not
   jump on contact.
