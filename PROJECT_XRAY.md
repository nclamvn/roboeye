# PROJECT X-RAY · RoboEye

Handover snapshot: 06/08/2026

Method: Vibecode Kit v6.1 · X-Ray Protocol

Canonical repository: `/Users/os/Downloads/roboeye`

## 1. Overview

RoboEye biến webcam laptop thành một pipeline perception và planning chạy hoàn toàn trong trình duyệt:

`Webcam → relative depth → point cloud 3D → BEV occupancy → A* planning`

Nhánh hiện tại còn có tầng nhận diện vật thể độc lập:

`Webcam → RT-DETR hoặc OWL-ViT → box 2D → fusion với depth → box 3D tương đối → COCO/YOLO/3D JSON`

Sản phẩm là ứng dụng static, không có backend, database, auth hay API riêng. Khung hình camera không được gửi tới server của dự án. Model mặc định được tải từ Hugging Face; runtime ONNX được self-host trong bản build.

## 2. Quick Start

Yêu cầu: Node.js 18+, Chrome hoặc Edge mới, localhost hoặc HTTPS để mở webcam.

```bash
npm install
npm run dev
```

Mở `http://localhost:5173`, bấm **Mở camera**, cho phép quyền camera và chờ model depth tải xong.

Các lệnh chính:

```bash
npm run typecheck
npm run build
npm run preview
npm run smoke
```

`npm run smoke` cần chuẩn bị `tests/.model-cache/` theo `docs/VERIFY.md`. Thư mục này bị ignore và không có trong fresh clone.

## 3. Architecture

```text
index.html + src/styles.css
          │
          ▼
src/ui/shell.ts ◄──────────── keyboard, controls, badges, overlays
          │ callbacks
          ▼
src/main.ts ──────────────── orchestration + latest-frame-wins
    │           │                         │
    │ RGBA      │ RGBA                    │ render state
    ▼           ▼                         ▼
depth-worker  detect-worker          render/scene.ts
    │           │                         │
    │ depth     │ 2D detections           ├─ RGB / Depth / Point Cloud
    └───────────┴─────────────────────────┤
                                         ├─ 2D→3D detection fusion
                                         └─ render/bev.ts
                                                │
                                                └─ render/astar.ts
```

Luồng runtime:

1. `main.ts` mở webcam và capture frame bằng `OffscreenCanvas`.
2. Depth worker và detection worker chạy nhịp riêng. Mỗi worker chỉ nhận frame mới khi trạng thái `busy` đã được giải phóng.
3. Depth worker chạy Depth Anything V2 Small bằng Transformers.js, ưu tiên WebGPU và fallback WASM.
4. `scene.ts` upload texture màu/depth, nội suy giữa hai depth frame và render bằng Three.js WebGPU; renderer tự fallback WebGL2.
5. `bev.ts` unproject depth, tạo occupancy grid 96×96, làm mượt EMA/hysteresis và gọi A* để replan.
6. Detection worker chạy RT-DETR closed-set hoặc OWL-ViT open-vocabulary. UI cho relabel/xóa/chọn box và xuất annotation.

Không có persistent state: refresh trang sẽ mất camera state, detection và annotation chưa export.

## 4. Key Components

| Thành phần | Vai trò |
|---|---|
| `src/main.ts` | Boot, webcam, hai worker, render loop, export annotation |
| `src/types.ts` | Contract có kiểu giữa main và depth worker |
| `src/worker/depth-worker.ts` | Depth inference, WebGPU→WASM fallback, model loading |
| `src/worker/detect-worker.ts` | RT-DETR/OWL-ViT inference và chuẩn hóa box |
| `src/render/scene.ts` | Four-mode renderer, point cloud, depth interpolation, box 3D |
| `src/render/bev.ts` | Occupancy, obstacle alert, robot ảo và replan |
| `src/render/astar.ts` | A* 8 hướng với binary heap |
| `src/ui/shell.ts` | DOM shell HIVE, điều khiển, overlay và object panel |
| `scripts/copy-ort.mjs` | Copy ONNX Runtime WASM từ dependency sang `public/ort/` |
| `tests/smoke.mjs` | E2E fallback bằng fake webcam và local model cache |
| `tests/debug.mjs` | Script chẩn đoán browser/model load thủ công |

Scan baseline: 33 tracked files, 9 TypeScript source files, 2.049 dòng TypeScript trong `src/`, 2 test scripts.

## 5. Internal API Reference

RoboEye không cung cấp HTTP API.

- `SceneAPI`: attach video, đổi mode, upload color/depth, điều chỉnh FOV/point size, freeze, detection fusion, resize/render/dispose.
- `ShellAPI`: cập nhật mode, fps, backend badge, boot state, camera list, alert, detection overlay và object list.
- Depth worker messages được định nghĩa trong `src/types.ts`: `init`, `frame`, `progress`, `ready`, `depth`, `error`.
- Detection worker dùng message contract nội bộ: `init`, `engine`, `queries`, `frame` và trả `loading`, `progress`, `ready`, `det`, `error`. Contract này chưa được khai báo thành discriminated union dùng chung.

## 6. Database Schema

Không có database. Annotation chỉ tồn tại trong bộ nhớ trình duyệt cho đến khi người dùng tải file COCO, YOLO hoặc 3D JSON.

## 7. Configuration and Environment

Không có `.env` bắt buộc và không phát hiện secret trong source.

| Input | Phạm vi | Tác dụng |
|---|---|---|
| `ROBOEYE_BASE` | Build-time | Base path cho static host/GitHub Pages; mặc định `/` |
| `?webgl=1` | Runtime URL | Ép renderer WebGL2 |
| `?wasm=1` | Runtime URL | Ép inference WASM và hạ resolution |
| `?localmodels=1` | Runtime URL | Chỉ load model từ `public/models/` |

`public/ort/`, `dist/`, `node_modules/` và `tests/.model-cache/` là generated/local artifacts và bị ignore.

## 8. Build History and TIP Traceability

| TIP / thay đổi | Evidence | Thành phần chính |
|---|---|---|
| TIP-01 | `docs/TIPS.md`, Completion Report | Webcam, depth worker, boot shell |
| TIP-02 | `docs/TIPS.md`, Completion Report | Point cloud WebGPU/WebGL, orbit, freeze |
| TIP-03 | `docs/TIPS.md`, Completion Report | BEV occupancy và HIVE shell |
| TIP-04 | `docs/TIPS.md`, Completion Report | Panel, fallback, smoke test |
| TIP-05 | `docs/TIPS.md`, `archive/roboeye-2:936432b` | Obstacle alert |
| TIP-06 | `docs/TIPS.md`, `archive/roboeye-2:936432b` | Robot ảo và A* replan |
| v1.1 squash | `main:3d57885` | Core TIP-05/06 và demo script; thiếu một số test/docs về sau đã khôi phục |
| Detection/annotation | `main:73ecdc4` | RT-DETR, OWL-ViT, overlay, fusion và export |
| Consolidation | `main:495360d` | GitHub Pages config, test evidence và docs từ repo phụ |
| TIP-07 | `docs/TIP-07-HANDOVER-XRAY.md` | Handover X-Ray và governance reset |

Nhánh `archive/roboeye-2` giữ 5 commit chi tiết sau v1.0. Không cherry-pick trực tiếp vì phần lớn nội dung đã được squash vào `main`.

Khoảng trống traceability: commit detection/annotation chưa có requirement ID, Blueprint approval, TIP hay Completion Report gốc. Handover không tự suy diễn rằng tính năng này đã được Chủ nhà approve.

## 9. Requirements Traceability

`docs/VERIFY.md` ghi nhận R1–R9 của v1.0 đạt 9/9. TIP-05 và TIP-06 bổ sung obstacle alert cùng A* nhưng chưa được đưa vào một Verify Report mới theo REQ-ID. Detection/annotation cũng chưa có requirement matrix.

| Nhóm | Trạng thái evidence |
|---|---|
| R1–R9 v1.0 | Có TIP, Completion Report và Verify Report; một phần nghiệm thu cần máy thật |
| TIP-05/06 | Có TIP mô tả, Completion Report và smoke evidence trên nhánh archive |
| Detection/annotation | Có code/commit; thiếu requirement source và acceptance evidence |
| RRI Report | Không có artifact riêng trong repo |
| Blueprint / Contract | Không có artifact riêng trong repo |
| Verify sau v1.1 | Chưa có; `docs/VERIFY.md` vẫn mang tiêu đề v1.0 |

## 10. Deployment

Production root path:

```bash
npm ci
npm run build
```

GitHub Pages hoặc static sub-path:

```bash
ROBOEYE_BASE=/roboeye/ npm run build
```

Deploy nội dung `dist/` lên static host HTTPS. Model depth/detection mặc định tải từ Hugging Face tại runtime. Demo offline cần đặt đúng tất cả model cần dùng dưới `public/models/`; README hiện chỉ hướng dẫn model depth, chưa hướng dẫn RT-DETR/OWL-ViT.

Repo chưa có CI/CD, workflow GitHub Actions, deployment manifest hay release automation. `main` tại thời điểm X-Ray đang đi trước `origin/main` 2 commit và chưa được push.

## 11. Common Tasks

- Thêm mode hiển thị: mở rộng `Mode`, markup mode button/panel, `ShellCallbacks` và `SceneAPI.setMode`.
- Thay model depth: giữ contract `Uint8 depth`, kiểm lại orientation, dtype và fallback.
- Thay detection engine: thêm engine/model/task trong detection worker, cập nhật UI và xác nhận output box của Transformers.js.
- Điều chỉnh BEV: các threshold/grid/range nằm đầu `src/render/bev.ts`; thay đổi cần benchmark lại alert và path.
- Debug fallback: chạy `?webgl=1&wasm=1`; thêm `?localmodels=1` nếu đã chuẩn bị model local.
- Build cho sub-path: đặt `ROBOEYE_BASE` trước `npm run build`.

## 12. Troubleshooting

| Triệu chứng | Kiểm tra |
|---|---|
| Webcam không mở | Chạy trên localhost/HTTPS, kiểm quyền camera và camera đang bị app khác giữ |
| Model không tải | Kiểm mạng/Hugging Face cache; với offline kiểm cây `public/models/` |
| WebGPU không dùng | Chrome/Edge mới, phần cứng/driver hỗ trợ; thử fallback để tách lỗi render |
| Smoke báo thiếu cache | Chuẩn bị `tests/.model-cache/` theo `docs/VERIFY.md` |
| GitHub Pages trắng/404 asset | Build lại với `ROBOEYE_BASE=/roboeye/` |
| Detection dừng sau lỗi frame | `main.ts` không reset `detectBusy` ở nhánh message `error`; cần TIP debug riêng |

## 13. Technical Health and Known Gaps

Kết quả X-Ray ngày 06/08/2026:

- Fresh clone → `npm ci`: PASS, 80 packages installed.
- `npm run typecheck`: PASS, 0 TypeScript errors.
- `ROBOEYE_BASE=/roboeye/ npm run build`: PASS, 18 modules transformed.
- Smoke E2E hiện tại: UNTESTABLE vì thiếu `tests/.model-cache/`; kết quả 15/15 trong docs là evidence lịch sử, không phải rerun của X-Ray.
- Lint: không cấu hình, nên không có số lint error đáng tin cậy.
- TODO/FIXME trong product source: 0.
- Secret-like assignment trong tracked source: không phát hiện bằng scan pattern.
- `npm audit`: 2 high, 0 critical. Cả hai quy về `sharp <0.35.0` qua `@huggingface/transformers`; npm báo chưa có automatic fix. Source browser không import `sharp` trực tiếp và static bundle không triển khai Node `sharp`, nên mức phơi nhiễm runtime phía client có vẻ thấp, nhưng security gate vẫn chưa sạch.

Gaps ưu tiên:

1. **P0 governance:** quyết định chính thức giữ, sửa hay bỏ detection/annotation; sau đó lập REQ-ID, TIP và Verify tương ứng.
2. **P0 security review:** đánh giá advisory `sharp`, theo dõi upstream Transformers.js và xác nhận deployment không chạy đường xử lý ảnh Node với input không tin cậy.
3. **P1 data honesty:** export 3D nhắc “Depth Pro metric mode” nhưng code hiện không có mode đó; cần sửa copy hoặc approve một feature metric-depth riêng.
4. **P1 resilience:** detection error trong lúc infer có thể để main-thread `detectBusy=true` vĩnh viễn.
5. **P1 reproducibility:** smoke test cần cache thủ công; chưa có bootstrap/checksum cho model fixture.
6. **P1 QA:** chưa có unit test cho A*, BEV, annotation converters hoặc detection state machine.
7. **P1 documentation/versioning:** README chưa mô tả detection; package vẫn `1.0.0`; không có CHANGELOG.
8. **P2 operations:** chưa có CI/CD hay release/deploy checklist tự động.

## 14. Operating Contract After Handover

Một agent luân phiên hai vai nhưng không trộn trust boundary:

1. **Chủ thầu:** scan/đề xuất, phát TIP có acceptance criteria, không sửa code.
2. **Thợ:** tuyên bố nhận TIP, thi công đúng phạm vi, test và nộp Completion Report.
3. **Chủ thầu:** kiểm ngược theo REQ-ID/AC, xuất Verify Report định lượng.
4. **Chủ nhà:** approve Blueprint/scope, quyết định trade-off chiến lược và quyết định ship.

Mọi task, dù nhỏ, giữ tối thiểu TIP + Completion Report. Thay đổi kiến trúc hoặc scope đã approve phải quay lại Chủ thầu và có checkpoint với Chủ nhà.
