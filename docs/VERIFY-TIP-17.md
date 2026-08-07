# VERIFY · TIP-17

1. Run `npm run test:unit`; confirm 345-label and confidence tests pass.
2. Run `npm run test:airsketch-e2e`; confirm 28×28 raster, Vietnamese phrase confirmation, TTS and responsive sidecar.
3. Run `npm run test:airsketch-models`; confirm pinned hand and sketch models load and infer.
4. Run `npm run test:airsketch-quality`; confirm top-1 ≥0.75 and top-3 ≥0.90.
5. Draw an obvious house, flashlight and tent locally. Confirm five Vietnamese suggestions appear and speech remains disabled until one is selected.
6. Draw an ambiguous scribble. Confirm the headline says “Chưa đủ chắc chắn” and status warns against unconfirmed use.
7. Inspect Network: model/labels URLs include immutable revision; runtime comes from same-origin `/tflite/`; no camera frame upload occurs.
8. Run `npm run build:offline`, serve `dist`, block every `https://` request and enable AirSketch; confirm hand and classifier both become ready from `/models/airsketch/`.
