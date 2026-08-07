# SCAN · TIP-17 AirSketch recognition

## Symptoms and root causes

- Finger tracking and ink were smooth; recognition was the failed subsystem.
- The T16 smoke only asserted that three labels existed. It never asserted the expected object.
- The MobileViT production path scored 15% top-1 and 25% top-3 on the first 20 locked official vector samples.
- Raster input was 224×224 and polarity/line width were not derived from the official 28×28 renderer.
- Vietnamese coverage was 46/345; unknown classes silently appeared in English.
- UI phrased top-1 as a guess and TTS could speak it without explicit confirmation.

## External contracts checked

- Google Quick, Draw! official dataset: 345 categories, simplified vectors centered into 28×28 bitmaps; official renderer uses black background, white antialiased strokes, round cap/join and a 16/304 scaled line width.
- Replacement `zarqankhn/quickdraw-345-tflite`: 345-class SE-ResNet, `[1,28,28,1]` float input, self-reported 76.4% top-1 and 89.5% top-3; Apache-2.0 weights.
- The model card polarity description conflicts with its training bitmap. Runtime A/B against official numpy pixels proved that this artifact expects black background and white strokes; the verified tensor behavior is authoritative for this pinned revision.

## Risk classification

- P0: wrong object communicated in a safety scenario.
- P0: no measured accuracy gate.
- P1: partial localization and English leakage.
- P1: automatic speech of an unconfirmed result.
- Constraint: this browser demo is not a certified emergency communication device.
