# TIP-16 · AirSketch — Vẽ · Đoán · Nói

## Header

- Depends on: TIP-13, TIP-14, TIP-15
- Priority: P0 demo/product capability
- Working directory: `/Users/os/Downloads/roboeye`
- Requirements: AIR-01…AIR-08 in `docs/BLUEPRINT-AIRSKETCH.md`

## Task graph

1. **T16-A Air Ink:** worker hand landmarks, gesture hysteresis, smoothing, mirrored overlay and pointer fallback.
2. **T16-B Sketch Guess:** normalized 224×224 raster, pinned QuickDraw worker, idle classification and top-3.
3. **T16-C Draw to Speak:** reserved sidecar, phrase composition, Vietnamese TTS, AAC/privacy copy.
4. **T16-D Benchmark:** unit fixture, mock browser contract, real hand/classifier smoke, p50/p95 snapshot.

## Acceptance criteria

- Given camera is active, when AirSketch is enabled, then RGB remains aligned and the prediction sidecar does not overlap the stage.
- Given a tracked hand, when thumb and index pinch/move/release, then a smoothed stroke starts/moves/ends; two/open gestures require holds before destructive commands.
- Given tracking is unavailable, when the user drags mouse/touch, then the same ink/classification path works.
- Given at least eight ink points and 650 ms idle, when classifier is ready, then exactly top-3 guesses appear.
- Given a guess, when selected and “Nói câu này” is pressed, then the localized phrase is read via `vi-VN` speech synthesis.
- Given a cold real-model run, then both pinned models load; hand steady-state p95 is below 80 ms and classification p95 below 300 ms on the test host.
- Given model load failure, then drawing remains usable; classifier retries once with a clean worker.

## Constraints

- No server/frame upload; no sign-language translation claim.
- No reuse of OWL-ViT for doodle recognition.
- No text overlay on the camera stage.
- Preserve latest-frame-wins and all existing depth/detection contracts.
