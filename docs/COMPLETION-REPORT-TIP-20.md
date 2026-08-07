# Completion Report — TIP-20

## Status

DONE

## Delivered

- Pinch now has down/up hysteresis and no longer drops a held object at one noisy threshold sample.
- Cursor filtering is adaptive: it damps small hand jitter but raises its response for intentional fast motion.
- Palm span is filtered independently before controlling 2.5D object scale.
- Small objects have a bounded pickup halo, so a user need not hit an exact line pixel to grab them.

## Files changed

- `src/airsketch-config.ts`
- `src/airsketch-interaction.ts`
- `src/airsketch-scene.ts`
- `tests/unit/airsketch-interaction.test.ts`
- `docs/TIP-20-AIRSKETCH-MANIPULATION-SMOOTHNESS.md`

## Verification

- Unit: 37/37 PASS.
- Production build/typecheck: PASS.
- Full `npm run qa`: PASS, including AirSketch, detection and release browser contracts.

## Scope discipline

No classifier, dataset, label, camera model or gesture vocabulary changed. The work is limited to making the existing manipulation control loop stable and usable.
