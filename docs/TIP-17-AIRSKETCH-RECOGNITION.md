# TIP-17 · AirSketch recognition hardening

## Header

- Depends on: TIP-16
- Priority: P0 quality/safety
- Working directory: `/Users/os/Downloads/roboeye`

## Task graph

1. **T17-A Benchmark:** run the production worker/rasterizer on locked official QuickDraw vector samples; record top-1/top-3 before/after.
2. **T17-B Model/runtime:** pin SE-ResNet TFLite model + labels; verify byte count and SHA-256; self-host official TFLite runtime; keep inference in a classic worker.
3. **T17-C Preprocessing:** render centered 28×28 black/white input with round antialiased 16/304-equivalent stroke width.
4. **T17-D Vietnamese/safety:** cover 345/345 classes, show top-5, assess score and top-2 margin, require explicit selection before TTS.
5. **T17-E Gates:** unit, typecheck, build, security audit, mock E2E, real-model smoke and quality thresholds in CI/release.
6. **T17-F Offline:** package hand model, classifier and labels into the offline artifact and prove both workers cold-start without external requests.

## Acceptance criteria

- Vector benchmark top-1 ≥75% and top-3 ≥90% on 20 deterministic official samples across ambulance, campfire, firetruck, flashlight, helicopter, hospital, house, ladder, tent and tree.
- All 345 pinned model labels have Vietnamese display names; an unknown future class never leaks English.
- Five suggestions show scores. Low score/margin produces “Chưa đủ chắc chắn”.
- TTS has no top-1 fallback; only user-confirmed phrase tokens can be spoken.
- Model and label artifacts reject size or SHA-256 mismatch.
- AirSketch remains usable for drawing if classifier loading fails.
- `build:offline` contains all three verified AirSketch artifacts; hand and classifier report ready with WAN requests blocked.

## Safety boundary

The benchmark is a small regression corpus, not field validation at distance and not certification. Rescue use requires representative target-user drawings, adverse-light/distance testing, false-decision analysis, redundant communication channels and human-factors validation. UI therefore forbids sole-channel/life-safety claims and requires confirmation.
