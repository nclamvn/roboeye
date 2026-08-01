# RoboEye

Biến camera laptop thành mắt robot, chạy toàn bộ trong một tab trình duyệt. Webcam sang depth map sang point cloud 3D sang BEV occupancy grid. Không server, không cài đặt, camera không rời máy.

Model: Depth Anything V2 Small (apache-2.0, bản ONNX của onnx-community) qua transformers.js, inference WebGPU trong Web Worker riêng. Render: three.js WebGPURenderer, tự fallback WebGL2. Điểm: 150k trên WebGPU, khoảng 28k trên fallback.

## Chạy

Yêu cầu Node 18+ và Chrome hoặc Edge bản mới. Lần chạy đầu cần mạng để tải model khoảng 50MB từ Hugging Face, sau đó trình duyệt cache lại.

```bash
npm install
npm run dev        # mở http://localhost:5173
```

Bản production:

```bash
npm run build
npm run preview    # mở http://localhost:4173
```

Webcam chỉ mở được trên localhost hoặc https. Muốn chia sẻ link cho các team, deploy thư mục `dist/` lên bất kỳ static host https nào (Netlify, Vercel, GitHub Pages).

## Phím và điều khiển

Phím 1 2 3 4 chuyển bốn chế độ RGB, Depth, Point Cloud, BEV Grid. Phím F đóng băng khung hình để bay quanh, phím ? mở panel giải thích từng tầng pipeline. Ở chế độ Point Cloud, kéo chuột để orbit, lăn để zoom. Sidebar có slider Inference size (đánh đổi tốc độ với chi tiết), Point size, chọn camera và chọn dtype model (fp16 khoảng 50MB, q4f16 khoảng 18MB cho mạng yếu).

Hai đồng hồ fps độc lập là hành vi đúng: render chạy 60fps trong khi inference chậm hơn, point cloud nội suy giữa hai depth frame nên chuyển động vẫn mềm.

## Switch fallback và demo offline

- `?webgl=1` ép render WebGL2 (demo "tắt WebGPU vẫn sống")
- `?wasm=1` ép inference WASM (tự hạ inference size về 140, badge nói thật)
- `?localmodels=1` load model từ `/models/` trên chính origin thay vì Hugging Face, dùng cho demo offline. Cách chuẩn bị: tải `config.json`, `preprocessor_config.json` và `onnx/model_quantized.onnx` (hoặc `model_fp16.onnx`) từ repo `onnx-community/depth-anything-v2-small` vào `public/models/onnx-community/depth-anything-v2-small/` rồi build lại.

Runtime WASM của onnxruntime được tự host trong `/ort/` (script `scripts/copy-ort.mjs` chạy tự động trước dev và build), không phụ thuộc CDN lúc chạy.

## Kịch bản demo 5 phút

Mở RGB thường và nói đây là tất cả những gì robot có. Bật Depth để khán giả thấy máy hiểu xa gần. Bật Point Cloud rồi kéo chuột ra khỏi vị trí webcam, đây là khoảnh khắc chính khi khung hình phẳng thành khối không gian. Nhấn F để đóng băng và bay quanh khung hình đông cứng. Lật BEV và kết bằng câu: đây chính là thứ robot của các bạn dùng để tránh vật cản và nó vừa chạy trong một tab trình duyệt.

Chạy trước khi share screen Zoom để đèn camera bật sẵn và model đã cache.

## Trung thực dữ liệu

Depth Anything trả về relative depth, nghĩa là xa gần tương đối chứ không phải mét thật. Ghi chú này hiển thị cố định trên UI. FOV camera là giả định 60 độ, tinh chỉnh được trong panel. Badge góc trái luôn hiển thị backend thật đang chạy.

## Kiểm thử

```bash
npm run build
npm run smoke      # E2E headless với fake webcam, cần model cache local (xem tests/smoke.mjs)
```

Nghiệm thu hiệu năng trên máy thật theo `docs/REGISTRY-NOTES.md` (đóng fact F10 của PRD). Audit trail đầy đủ trong `docs/`: TIPS, COMPLETION-REPORTS, VERIFY.

## Cấu trúc

```
src/main.ts              orchestration, latest-frame-wins capture loop
src/worker/depth-worker.ts   transformers.js pipeline trong Web Worker
src/render/scene.ts      WebGPURenderer, 4 chế độ, point cloud TSL
src/render/bev.ts        BEV occupancy: bin CPU, EMA, hysteresis
src/ui/shell.ts          sidebar HIVE, phím tắt, meters, badges
```

RoboEye · G16 AI20K Cohort 3 · build bằng Vibecode Kit v6.1
