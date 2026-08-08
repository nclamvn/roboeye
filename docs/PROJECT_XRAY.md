# PROJECT X-RAY · RoboEye

**Chụp ngày 02/08/2026, sau P1-B. Theo X-Ray Protocol Vibecode Kit v6.1.**
Mục đích: một người mới đọc xong hiểu dự án làm gì, chạy được, sửa được, phát triển tiếp được, và biết nợ kỹ thuật đang ở đâu.

---

## 1. Tổng quan

RoboEye biến camera laptop thành mắt robot, chạy toàn bộ trong một tab trình duyệt, không server. Từ v1 (demo perception 4 chế độ) đã tiến hoá thành v2 (engine perception dùng chung cho công cụ auto-label và về sau là điều hướng khiếm thị). Pipeline: webcam → depth → point cloud → BEV occupancy → robot ảo A*; và nhánh v2: webcam → detection (ngữ nghĩa) + depth → 3D box → gán nhãn + export.

Trạng thái: **Phase 1 auto-label tới P1-B xong và verify. Sẵn sàng P1-B-2 (metric depth).** Nền v1 đã lên public tại https://nclamvn.github.io/roboeye/.

## 2. Chạy nhanh

```bash
npm install
npm run dev          # http://localhost:5173, Chrome/Edge mới, cho phép camera
npm run build        # tsc --noEmit + vite build
npm run smoke        # E2E headless (CẦN chuẩn bị fixtures trước, xem mục 12)
```

Lần đầu tải model từ Hugging Face (depth ~50MB; RT-DETR ~40MB khi bật detection; OWL-ViT ~127MB khi đổi open-vocab), sau đó trình duyệt cache.

## 3. Kiến trúc

```
                    ENGINE PERCEPTION (dùng chung)
  getUserMedia ─▶ video ─▶ offscreen capture (latest-frame-wins)
       │                         │                    │
       ▼ Worker depth            ▼ Worker detect      │
  depth-anything-v2-small   RT-DETR / OWL-ViT         │
  (relative depth)          (2D boxes + nhãn)         │
       │                         │                    │
       └──────────┬──────────────┘  FUSION            │
                  ▼                                    │
     three/webgpu render (scene.ts)                   │
     ├─ RGB / Depth plane                             │
     ├─ Point Cloud 150k điểm (TSL positionNode)      │
     ├─ 3D wireframe box (lift 2D+depth)              │
     └─ BEV (bev.ts): occupancy + A* (astar.ts) + alert
                  ▼
     Shell HIVE (shell.ts): sidebar, phím tắt, panel review, export
     Orchestration (main.ts): worker wiring, annotation state, export COCO/YOLO/3D
```

Nguyên tắc kiến trúc còn giữ nguyên từ v1: inference tách render bằng Web Worker, latest-frame-wins không xếp hàng, hai đồng hồ fps độc lập, toàn bộ state trong RAM, camera không rời máy.

## 4. Thành phần (2049 LOC nguồn, 9 file)

| File | LOC | Vai trò |
|---|---|---|
| `src/render/scene.ts` | 475 | Renderer three/webgpu, 4 chế độ, point cloud TSL, lift 3D box, chọn/highlight |
| `src/render/bev.ts` | 406 | BEV occupancy, EMA+hysteresis, robot ảo A*, alert, compose mỗi frame |
| `src/main.ts` | 405 | Orchestration, worker wiring, annotation state, export 3 định dạng |
| `src/ui/shell.ts` | 317 | Sidebar HIVE, phím tắt, overlay 2D, panel review, engine/query/export UI |
| `src/render/astar.ts` | 134 | A* 8 hướng binary heap trên grid |
| `src/worker/detect-worker.ts` | 137 | Detection đa-engine RT-DETR + OWL-ViT zero-shot |
| `src/worker/depth-worker.ts` | 122 | Depth inference, fallback webgpu→wasm |
| `src/types.ts` | 52 | Giao thức message worker |

Stack: Vite 7, TypeScript 5.9 (strict), three 0.185 (three/webgpu, TSL), @huggingface/transformers 3.8, DOM thuần không framework.

## 5. Lịch sử build (TIP traceability)

| TIP | Nội dung | Commit | Bằng chứng |
|---|---|---|---|
| M1-M4 | v1: webcam→depth→cloud→BEV, panel, fallback | aa2e6e7 | smoke 14/14 |
| F10 | Đóng fact fps, nghiệm thu máy thật | efa816c | 14-15fps WebGPU 336px |
| TIP-05/06 | Obstacle alert + robot ảo A* | 936432b | smoke 15/15, 07-bev-goal |
| TIP-07 / P1-A | Engine v2 fusion 2D→3D | 023a1f9 | smoke 18/18, 08+09 |
| TIP-08 / P1-B | Auto-label open-vocab + review + export | 5dce379 | smoke 24/24, 10-label |

Chi tiết trong docs/TIPS.md, docs/COMPLETION-REPORTS.md, docs/VERIFY.md, docs/ARCHITECTURE-v2.md, docs/BLUEPRINT-v2-DECISIONS.md.

## 6. Requirement traceability

R1-R9 của PRD v1 (webcam, depth, 4 chế độ, point cloud, BEV, freeze, slider, badge, panel) đều implemented, verify trong docs/VERIFY.md. v2 thêm: fusion detection (P1-A), open-vocab + review + export (P1-B). Metric depth và KITTI export thật còn nợ (P1-B-2).

## 7. Deploy

Static host bất kỳ. GitHub Pages: `ROBOEYE_BASE=/roboeye/ npm run build && npx gh-pages -d dist`. App hỗ trợ sub-path qua BASE_URL. Không có backend, không env vars, không secret.

## 8. Sức khoẻ code

**Lành mạnh:** TypeScript strict 0 lỗi, build 0 lỗi/0 warning chặn, console runtime sạch (không log rác), smoke E2E 24/24, không secret trong code, .gitignore che node_modules/dist/model-cache, đủ artifact Vibecode.

**Cần chú ý:** chưa cấu hình ESLint (tsc strict làm sàn). Ba `any` trong scene.ts cho TSL node là workaround có chủ đích, đã eslint-disable kèm chú thích (typing của TSL quá hẹp). Hai worker trùng pattern cast pipeline nhỏ (createPipeline/makePipe).

**Bảo mật npm audit:** 3 high, đều ở chuỗi build không lên bundle trình duyệt: `sharp` (libvips CVE, transformers.js dùng phía Node để decode ảnh, browser dùng canvas nên không chạy), `nanoid` (transitive của Vite, chỉ dev). Rủi ro thực với người dùng cuối gần bằng không. Nâng phiên bản để dọn nên làm trong một lần cập nhật dependency có kiểm soát, không vá vội kẻo gãy transformers.js.

## 9. Nợ kỹ thuật (register, ưu tiên giảm dần)

| # | Nợ | Mức | Xử lý |
|---|---|---|---|
| D1 | Fresh-clone không chạy được smoke: model cache 198MB + scene.y4m đều gitignore, không có script chuẩn bị | Cao | **ĐÃ DỌN:** thêm `scripts/prep-fixtures.mjs` + `npm run smoke:prep` (tải model + sinh y4m) |
| D2 | `tests/debug.mjs` chết, không ai gọi, tàn dư debug M1 | Thấp | **ĐÃ DỌN:** xoá |
| D3 | 11 screenshot output `tests/shots/*.png` bị git theo dõi, churn mỗi lần smoke | Thấp | **ĐÃ DỌN:** gitignore + untrack, giữ file local làm bằng chứng |
| D4 | README còn ở thời v1, chưa nói detection/labeling/export/fixtures | Trung bình | **ĐÃ DỌN:** cập nhật README v2 |
| D5 | `localFlag` ở detect-worker là module `let` dùng một lần | Thấp | **ĐÃ DỌN:** đưa về local trong init |
| D6 | Chưa có CHANGELOG.md (checklist X-Ray) | Thấp | **ĐÃ DỌN:** thêm CHANGELOG.md |
| D7 | Trùng pattern cast pipeline giữa depth-worker và detect-worker | Thấp | Để lại, ghi chú. Gộp khi làm P1-B-2 vì cả hai worker sẽ đụng metric |
| D8 | Chưa có ESLint config | Thấp | Để lại. tsc strict + noUnusedLocals đang làm sàn. Thêm khi đội đông hơn một người |
| D9 | 3D box axis-aligned, scale tương đối (chưa metric, chưa orientation) | Trung bình | Là nội dung P1-B-2, không phải nợ ẩn. Ghi rõ trong export cờ scale=relative |
| D10 | npm audit 3 high ở chuỗi build (sharp, nanoid) | Thấp | Để lại có kiểm soát, không lên bundle trình duyệt. Dọn trong lần bump dependency |

## 10. Việc kế tiếp

P1-B-2 metric (Depth Pro hoặc Metric3D, mở khoá KITTI thật, 3D box đúng mét) → P1-C video+ByteTrack → P1-D SAM2 segmentation → P1-E backend hybrid → Phase 2 điều hướng khiếm thị native. Khi bắt P1-B-2 nên gộp luôn D7 (chung helper pipeline cho worker).

## 11. Troubleshooting nhanh

Trang trắng: kiểm dev server còn sống, xem console. Model không tải: cần https hoặc localhost, mạng ra Hugging Face. OWL-ViT chậm: cần WebGPU (Chrome/Edge mới), trên máy không GPU nó rất chậm. fps thấp: cắm sạc tắt Low Power Mode, hạ Inference size.

## 12. Chuẩn bị fixtures cho smoke (fresh clone)

```bash
npm run smoke:prep   # tải 3 model về tests/.model-cache + sinh tests/assets/scene.y4m
npm run build
npm run smoke
```

Cần `curl` và `ffmpeg` trong máy. Script bỏ qua file đã có, chạy lại an toàn.
