# SCAN REPORT · TIP-16 AirSketch

Ngày: 06/08/2026 · Scope: focused scan cho camera, worker, overlay, responsive và release.

## TECH_STACK

- TypeScript strict, Vite 7, DOM thuần, Three.js WebGPU/WebGL2.
- Depth và detection đã dùng latest-frame-wins trong Web Worker.
- `@huggingface/transformers` đã có sẵn, ORT WASM tự host dưới base path.
- UI HIVE dùng sidebar 192 px, stage camera full-size và overlay SVG.
- Test gồm Node unit, Playwright mock E2E và real-model smoke.

## REUSABLE PATTERNS

- `src/main.ts`: orchestration và recovery theo stage load/infer.
- `src/ui/shell.ts`: DOM contract/callback, aria-live và responsive state.
- `scripts/copy-ort.mjs`: đóng runtime WASM vào static artifact.
- `tests/helpers/mock-workers.mjs`: fixture worker tách contract khỏi model quality.
- `src/runtime-diagnostics.ts`: telemetry local-only, không ghi frame.

## GAPS BEFORE T16

- Chưa có hand landmarks, gesture state machine hoặc canvas nét vẽ.
- Object detector hiện hữu không phù hợp nhận dạng doodle.
- Chưa có phrase composition/TTS hoặc fallback chuột/chạm.
- Chưa có benchmark latency cho hand/sketch pipeline.
- Viewport hiện không có vùng chữ riêng; panel overlay sẽ che camera.

## CODE HEALTH

- Type safety: strict; typecheck trước T16 PASS.
- Tests trước T16: 23 unit; detection/release E2E PASS.
- Security: 0 critical, 2 high accepted-risk từ `sharp` đường Node-only của Transformers.js.
- Quyết định scan: tái dùng Transformers.js cho QuickDraw; thêm MediaPipe exact-version; tạo sidecar dành chỗ thật thay vì overlay chữ.
