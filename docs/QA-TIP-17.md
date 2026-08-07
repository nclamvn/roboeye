# QA REPORT · TIP-17

## Automated results

- Unit: 30/30 PASS, including 345-label coverage and confidence margin behavior.
- TypeScript: PASS.
- Production build: PASS.
- Official bitmap sanity: 20 samples, top-1 90%, top-3 95%.
- Production vector pipeline: 20 samples, top-1 85%, top-3 100%.
- Baseline on the same vector categories before replacement: top-1 15%, top-3 25%.
- Offline release: hand/classifier/labels staged and verified; browser cold-start READY/READY with zero external requests.
- Heart regression: deterministic two-lobe/pointed-tip fixture returns the synthetic `heart` label and Vietnamese `trái tim`; the underlying 345-label model contract remains unchanged.

## Corpus

- Two first recognized simplified drawings for each of ten classes: ambulance, campfire, firetruck, flashlight, helicopter, hospital, house, ladder, tent and tree.
- Source: official Google Quick, Draw! GCS simplified NDJSON and numpy bitmap files.
- Thresholds locked in `tests/airsketch-quality.mjs`: top-1 0.75, top-3 0.90.

## Required final gates

- `npm run qa`
- `npm run test:airsketch-models`
- `npm run test:airsketch-quality`
- `npm run security:audit`
- `npm run build:offline`

## Limitation

Twenty samples are sufficient for regression detection, not a representative accuracy or rescue-readiness claim.
