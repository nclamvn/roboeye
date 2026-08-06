# VERIFY REPORT · RoboEye v1.0

Chủ thầu kiểm ngược 01/08/2026, sau khi nhận đủ 4 Completion Report.
Bằng chứng: `npm run build` log, `tests/smoke.mjs` output, 7 screenshot trong `tests/shots/`.

## LỆNH TÁI LẬP HIỆN TẠI (TIP-12/13)

```bash
npm run fixtures:prepare       # tải/verify fixture pin revision + SHA-256
npm run fixtures:verify        # chỉ verify, cache sai thì fail
npm run test:detection-e2e     # detection contract/UI bằng mock Worker
npm run test:release-e2e       # onboarding/recovery/responsive/offline shell
npm run smoke                  # tự prepare + build rồi chạy depth q8 thật
npm run release:verify         # metadata/CSP/headers/service worker
npm run build:offline          # artifact depth q8 tự chứa
```

Smoke không còn phụ thuộc cache tải tay. Manifest chuẩn nằm tại
`tests/fixtures/depth-q8.manifest.json`; báo cáo lane mới nằm trong
`docs/QA-TIP-10.md` và `docs/VERIFY-TIP-10.md`.

Báo cáo production/release hiện tại nằm tại `docs/QA-TIP-12-13.md`,
`docs/VERIFY-TIP-12.md` và `docs/VERIFY-TIP-13.md`.

## REQUIREMENT COVERAGE

**9/9 REQ implemented (100%)**, trong đó 7 kiểm máy được trong container, 2 kiểm một phần (phần còn lại cần máy thật).

| REQ | Trạng thái | Bằng chứng |
|---|---|---|
| R1 webcam + chọn camera | Implemented, PASS | smoke: fake camera mở, dropdown có device |
| R2 worker inference latest-frame-wins | Implemented, PASS | depth frame về ở 0.2fps WASM mà render loop không nghẽn, không hàng đợi |
| R3 bốn chế độ phím 1-4 | Implemented, PASS | smoke 4/4 + screenshots |
| R4 point cloud ≥100k, màu RGB, orbit | Implemented, PASS một phần | 150.528 điểm WebGPU / 27.648 fallback; khối + màu thấy trong `02-cloud.png`; thao tác kéo orbit kiểm tay khi nghiệm thu |
| R5 BEV occupancy + quạt FOV | Implemented, PASS một phần | `03-bev.png` đúng spec; "đi lại grid đổi theo" cần người thật trước camera |
| R6 freeze/resume | Implemented, PASS | smoke: tag FROZEN bật tắt |
| R7 slider size + point size, 2 fps | Implemented, PASS | smoke: 2 số fps thật; slider đổi giá trị |
| R8 badge + ghi chú trung thực | Implemented, PASS | INFER · WASM, RENDER · WEBGL2 đúng sự thật trong container; ghi chú relative depth cố định |
| R9 panel giải thích tiếng Việt | Implemented, PASS | `06-panel.png`, 4 đoạn + FOV slider |

Missing: không.

## SCENARIO RESULTS

Smoke E2E làn fallback (`?webgl=1&wasm=1&localmodels=1`): **14/14 PASS, 0 fail.**
Kịch bản demo 5 phút (PRD mục 5): chạy được từng bước bằng phím trong container; chất lượng cảm quan trên cảnh thật cần webcam thật.

## TECHNICAL HEALTH

- `tsc --noEmit`: **0 lỗi** (strict mode).
- `vite build`: **0 lỗi, 0 warning chặn** (bundle chính 880KB + ORT wasm 21.6MB tự host).
- Console runtime trong smoke: **0 lỗi**.
- Lint: không cấu hình riêng, tsc strict + noUnusedLocals làm sàn.

## OVERALL STATUS: READY-với-deferred

Deferred (đều cần máy thật của Chủ nhà, không blocker code):

1. **F10 (honest-null trong registry):** đo fps inference thật ở 252px và 504px trên M1, ghi vào `docs/REGISTRY-NOTES.md`. Đây là nghiệm thu M1 theo PRD.
2. **Làn WebGPU đầy đủ:** container dùng Chromium cũ thiếu API three r185 cần; cần Chrome/Edge hiện hành trên máy thật. Làn fallback đã chứng minh sống.
3. **Render 60fps ở 100k+ điểm** và cảm quan "khối phòng nhận ra được" trên cảnh thật: kiểm tay theo checklist trong README.

Quality gate HIVE (skill lam-nguyen-style): monochrome tuyệt đối ✓, dual serif/sans ✓, sidebar đen 192px ✓, không emoji ✓, không gradient ✓, motion 120-180ms ✓, focus outline ✓, không em-dash trong copy tiếng Việt ✓.
