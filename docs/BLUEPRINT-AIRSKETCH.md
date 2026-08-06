# BLUEPRINT · RoboEye AirSketch — Vẽ · Đoán · Nói

Approved bằng chỉ thị “chốt T16 triển khai” ngày 06/08/2026.

## Goal

Camera theo ngón tay để người dùng vẽ trong không khí theo thời gian thực, đoán vật thể đã vẽ và biến các dự đoán được chọn thành câu đọc thành tiếng. Đây là lớp hỗ trợ giao tiếp tăng cường (AAC), không tuyên bố dịch ngôn ngữ ký hiệu.

## Architecture

```text
camera → ImageBitmap 480 px → classic Hand Worker → 21 landmarks
                                              ↓
                                pinch/hold state machine
                                              ↓
                              normalized strokes → ink canvas
                                              ↓ 650 ms idle
                 224×224 raster → QuickDraw Worker → top-3
                                              ↓
                                 phrase rail → vi-VN TTS
```

- MediaPipe Hand Landmarker `float16/1`, URL/byte length/SHA-256 pinned.
- Classic worker is required because MediaPipe's WASM loader uses `importScripts`; inference remains off main thread.
- QuickDraw MobileViT q8 is pinned to immutable Hugging Face revision and runs in its own worker.
- Cold start is sequential (classifier, then hand graph) to avoid concurrent WASM compilation pressure; steady-state inference is independent.
- Drawing coordinates mirror X and map into Three.js `imageRectPx()` so cursor/stroke align with selfie RGB.
- Sidecar 318 px desktop, below-stage on mobile; text never overlays camera.

## Requirements

| REQ-ID | Requirement | Priority |
|---|---|---|
| AIR-01 | Track index fingertip locally with a 24 fps cap | P0 |
| AIR-02 | Pinch draw; held two-finger undo; held open-palm clear | P0 |
| AIR-03 | Smooth mirrored ink plus mouse/touch fallback | P0 |
| AIR-04 | Rasterize after 650 ms idle and return top-3 sketch guesses | P0 |
| AIR-05 | Reserve a responsive sidecar so text never covers the stage | P0 |
| AIR-06 | Compose selected guesses and read them with Vietnamese TTS | P1 |
| AIR-07 | Keep frames local and label the feature honestly as AAC | P0 |
| AIR-08 | Provide deterministic E2E, real-model smoke and p50/p95 metrics | P0 |

## Sources and provenance

- MediaPipe Web Hand Landmarker: https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js
- Hand model: `hand_landmarker/float16/1`, 7,819,105 bytes, SHA-256 `fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1`.
- QuickDraw browser model tutorial: https://huggingface.co/blog/ml-web-games
- QuickDraw model revision: `Xenova/quickdraw-mobilevit-small@ceb1c5cc6d623c6cffac36dca08c1903ba879755`.

## Explicit limits

- Accuracy depends on drawing style; top-3 is assistance, not a guaranteed semantic interpretation.
- QuickDraw has English labels; T16 localizes a curated common subset and shows readable English for the rest.
- Offline-depth release does not package the two AirSketch models.
- The selected QuickDraw Hub repository has no explicit license field in its model metadata. RoboEye does not redistribute its weights; commercial redistribution requires a separate license review.
