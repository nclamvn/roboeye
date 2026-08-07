# RoboEye

Biến camera laptop thành mắt robot, chạy toàn bộ trong một tab trình duyệt. Webcam sang depth map sang point cloud 3D sang BEV occupancy grid. Không server, không cài đặt, camera không rời máy.

Model: Depth Anything V2 Small (apache-2.0, bản ONNX của onnx-community) qua transformers.js, inference WebGPU trong Web Worker riêng. Render: three.js WebGPURenderer, tự fallback WebGL2. Điểm: 150k trên WebGPU, khoảng 28k trên fallback.

## Chạy

Yêu cầu Node 20.19+ và Chrome hoặc Edge bản mới. Lần chạy đầu cần mạng để tải model khoảng 50MB từ Hugging Face, sau đó trình duyệt cache lại.

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

Màn hình đầu tiên có hai đường vào: **Mở camera** để dùng trực tiếp, hoặc
**Demo 60 giây** để được dẫn qua RGB → Depth → Point Cloud → BEV. Thêm
`?demo=1` vào URL nếu muốn CTA demo là hành động mặc định khi trình chiếu.

## Phím và điều khiển

Phím 1 2 3 4 chuyển bốn chế độ RGB, Depth, Point Cloud, BEV Grid. Phím F đóng băng khung hình để bay quanh, phím ? mở panel giải thích từng tầng pipeline. Ở chế độ Point Cloud, kéo chuột để orbit, lăn để zoom. Ở chế độ BEV, click lên grid để đặt đích: robot ảo chạy A* tìm đường né vật cản và replan theo thời gian thực; vật cản lọt vùng gần camera thì chip cảnh báo hiện góc phải trên ở mọi chế độ. Sidebar có slider Inference size (đánh đổi tốc độ với chi tiết), Point size, chọn camera và chọn dtype model (fp16 khoảng 50MB, q4f16 khoảng 18MB cho mạng yếu).

Hai đồng hồ fps độc lập là hành vi đúng: render chạy 60fps trong khi inference chậm hơn, point cloud nội suy giữa hai depth frame nên chuyển động vẫn mềm.

## Nhận diện và gán nhãn

Bật **Nhận diện vật thể** trong sidebar để chạy worker detection độc lập với depth:

- **RT-DETR** nhận diện nhanh các lớp COCO có sẵn.
- **OWL-ViT** tìm lớp open-vocabulary; nhập các tên cần tìm, cách nhau bằng dấu phẩy.

Detection mặc định dùng ONNX WASM q8 ổn định và hiển thị backend ngay trong panel.
Mỗi model được pin theo revision Hugging Face; nếu tải lỗi, RoboEye tạo worker sạch
và tự thử lại một lần. Tắt rồi bật lại checkbox sẽ khởi tạo lại hoàn toàn worker.

Box 2D hiện trên RGB/Depth. Trong Point Cloud, RoboEye ghép box với relative depth để dựng box 3D tương đối. Nhấn F để đóng băng tập detection hiện tại, sau đó chọn vật thể, sửa nhãn hoặc xóa box trong panel. Annotation chỉ nằm trong bộ nhớ của tab cho đến khi xuất file.

OWL-ViT có preset Hằng ngày, Di chuyển, Bàn làm việc và Kho vận. Người dùng nhập nhãn ngắn như `person, bus`; worker tự tạo prompt zero-shot tự nhiên và map kết quả về nhãn ngắn để overlay/export sạch. RT-DETR và OWL-ViT đều có class-aware post-processing để giảm box trùng.

Các định dạng xuất:

- **COCO:** một image record và annotation `bbox` pixel dạng `x, y, width, height`.
- **YOLO:** `class cx cy width height` đã chuẩn hóa, kèm `classes.txt`.
- **3D JSON:** box 2D và box 3D trong không gian view theo tỷ lệ tương đối. Đây không phải tọa độ mét thật.

## AirSketch — Vẽ · Đoán · Nói

Nhấn **AirSketch** sau khi mở camera. Chụm ngón cái và ngón trỏ để hạ bút,
di chuyển ngón trỏ để vẽ, thả chụm để nhấc bút. Giữ hai ngón để hoàn tác;
giữ bàn tay mở để xóa. Chuột và cảm ứng dùng cùng đường nét vẽ khi tracking
chưa sẵn sàng.

Sau 650 ms dừng nét, QuickDraw SE-ResNet trả năm gợi ý tiếng Việt. Chạm một gợi ý
để xác nhận và ghép vào câu, rồi chọn **Nói câu này** để trình duyệt đọc bằng giọng Việt.
Sidecar dự đoán nằm ngoài vùng camera trên desktop và xuống dưới stage trên
mobile, nên chữ không che nét vẽ/vật thể.

MediaPipe Hand Landmarker và QuickDraw đều chạy local trong worker; frame camera
không được upload. Bộ đoán dùng raster 28×28 đúng pipeline QuickDraw và phủ tiếng
Việt cho đủ 345 lớp. Kết quả mơ hồ được báo “chưa đủ chắc chắn”; hệ thống không tự
đọc gợi ý chưa được chọn. Đây là AAC, không phải trình dịch ngôn ngữ ký hiệu, không
phải kênh cứu hộ duy nhất và không đảm bảo đoán đúng mọi kiểu vẽ.

Kiểm thử riêng:

```bash
npm run test:airsketch-e2e     # contract bằng worker fixture
npm run test:airsketch-models  # model thật + latency p50/p95
npm run test:airsketch-quality # top-1/top-3 trên mẫu QuickDraw chính thức
```

Smoke local giữ ngân sách hand p95 mặc định 80 ms. Shared CI dùng trần 250 ms để phát hiện treo/hồi quy lớn mà không biến độ nhiễu phần cứng runner thành lỗi tương thích model; có thể ghi đè bằng `AIRSKETCH_HAND_P95_MAX_MS`.

## Switch fallback và demo offline

- `?webgl=1` ép render WebGL2 (demo "tắt WebGPU vẫn sống")
- `?wasm=1` ép inference WASM (tự hạ inference size về 140, badge nói thật)
- `?detectwebgpu=1` thử nghiệm detection WebGPU; nếu khởi tạo lỗi sẽ retry bằng worker WASM sạch.
- `?localmodels=1` chỉ load model từ `/models/` trên chính origin thay vì Hugging Face, dùng cho demo offline.

Bản offline depth chuẩn được tạo tự động, không cần chép model bằng tay:

```bash
npm run build:offline
npm run preview
```

Lệnh này kiểm revision + SHA-256, đóng model depth q8 cùng Hand Landmarker,
QuickDraw TFLite và 345 nhãn vào `dist/models/`, rồi đặt ứng dụng sang WASM/local
model ngay từ build. Vì vậy tracking ngón tay và nhận diện AirSketch vẫn cold-start
khi không có Internet. Detection bị khóa trong artifact offline vì RT-DETR/OWL-ViT
chưa có manifest được phê duyệt. Model sinh ra chỉ nằm trong `dist/` và cache bị
ignore, không được commit.

Với demo offline, giữ nguyên cấu trúc snapshot của từng model dưới `public/models/`:

```text
public/models/onnx-community/depth-anything-v2-small/
public/models/onnx-community/rtdetr_v2_r18vd-ONNX/
public/models/Xenova/owlvit-base-patch32/
```

Mỗi snapshot phải gồm config, preprocessor/tokenizer liên quan và các file ONNX mà Transformers.js chọn theo dtype/device. Nếu chỉ chuẩn bị model depth, bốn chế độ perception vẫn chạy nhưng không bật được detection offline. Mặc định không có `?localmodels=1`, trình duyệt tải model cần dùng từ Hugging Face và cache lại.

Runtime WASM của onnxruntime, MediaPipe và TFLite được tự host trong `/ort/`,
`/mediapipe/` và `/tflite/` (`scripts/copy-ort.mjs` chạy tự động trước dev/build),
không phụ thuộc CDN runtime. Bản online tải hai model AirSketch từ nguồn đã pin;
bản `build:offline` mang model đã kiểm checksum theo artifact.

## Kịch bản demo 5 phút

Mở RGB thường và nói đây là tất cả những gì robot có. Bật Depth để khán giả thấy máy hiểu xa gần. Bật Point Cloud rồi kéo chuột ra khỏi vị trí webcam, đây là khoảnh khắc chính khi khung hình phẳng thành khối không gian. Nhấn F để đóng băng và bay quanh khung hình đông cứng. Lật BEV, click đặt đích cho robot ảo rồi bước ra chắn đường nó: con đường A* tự bẻ cong vòng qua người thật ngay trên màn hình. Kết bằng câu: perception, mapping và planning của robot vừa chạy trọn vẹn trong một tab trình duyệt.

Chạy trước khi share screen Zoom để đèn camera bật sẵn và model đã cache.

## Trung thực dữ liệu

Depth Anything trả về relative depth, nghĩa là xa gần tương đối chứ không phải mét thật. Ghi chú này hiển thị cố định trên UI. FOV camera là giả định 60 độ, tinh chỉnh được trong panel. Badge góc trái luôn hiển thị backend thật đang chạy.

Nút **Xuất chẩn đoán** tạo JSON gồm version, trạng thái mạng và tối đa 80 sự
kiện vận hành. Log nằm trong trình duyệt, không chứa frame camera/query/annotation
và không tự gửi đi đâu.

## Phát hành và deploy

- `npm run release:verify`: build và kiểm version, CSP, headers, manifest, service worker.
- `npm run build:offline`: tạo artifact depth q8 tự chứa.
- Workflow CI chạy browser contract trên pull request; real-depth smoke chạy trên main/lịch tuần.
- Workflow release deploy `dist/` lên GitHub Pages HTTPS và tạo archive khi push tag `v1.2.1`.

Quy trình bật Pages, rollback và giới hạn security header được ghi tại
`docs/DEPLOYMENT.md`. Codex không tự push/tag hay bật Pages trong tài khoản GitHub.

## Kiểm thử

```bash
npm run typecheck
npm run test:unit
npm run build
npm run security:audit
npm run test:detection-e2e  # contract/UI detection bằng mock Worker, không đo chất lượng model
npm run test:release-e2e    # onboarding, responsive, diagnostics và app shell offline
npm run smoke               # tự chuẩn bị fixture + build, chạy depth q8 thật qua WASM
npm run test:detection-models # tải model pin + chạy inference thật RT-DETR và OWL-ViT
npm run benchmark:detection # quality P/R/F1 + model-ready/inference p50/p95 trên browser/WASM
```

`npm run fixtures:prepare` tải model depth q8 theo revision và SHA-256 trong
`tests/fixtures/depth-q8.manifest.json`; chạy lại chỉ xác minh cache. Dùng
`npm run fixtures:verify` khi cần kiểm cache mà không cho phép tải lại. Có thể đặt
`ROBOEYE_CHROME` nếu Chrome/Chromium không nằm trong cache Playwright hoặc vị trí
thông dụng của macOS/Linux.

Làn `test:detection-e2e` kiểm opt-in, phục hồi lỗi inference, overlay/list,
đổi RT-DETR sang OWL-ViT, relabel, delete và xuất COCO bằng dữ liệu cố định. Nó
không phải bằng chứng cho accuracy, latency hay khả năng chạy model detection thật.
Benchmark T14 dùng regression corpus có SHA-256/ground truth và xuất JSON theo máy;
phương pháp, baseline và giới hạn được ghi tại `docs/TIP-14-DETECTION-BENCHMARK.md`.

Nghiệm thu hiệu năng trên máy thật theo `docs/REGISTRY-NOTES.md` (đóng fact F10 của PRD). Audit trail đầy đủ trong `docs/`: TIPS, COMPLETION-REPORTS, VERIFY.

## Cấu trúc

```
src/main.ts              orchestration, latest-frame-wins capture loop
src/annotations.ts       bộ chuyển đổi thuần COCO, YOLO và 3D JSON
src/depth-state.ts       recovery contract cho lỗi load/inference depth
src/runtime-diagnostics.ts local-only bounded operational events
src/detection-state.ts   quy tắc phục hồi trạng thái detection
src/detection-types.ts   contract message/box dùng chung cho detection
src/worker/depth-worker.ts   transformers.js pipeline trong Web Worker
src/worker/detect-worker.ts  RT-DETR và OWL-ViT trong Web Worker riêng
src/render/scene.ts      WebGPURenderer, 4 chế độ, point cloud TSL
src/render/bev.ts        BEV occupancy: bin CPU, EMA, hysteresis
src/ui/shell.ts          sidebar HIVE, phím tắt, meters, badges
```

RoboEye · G16 AI20K Cohort 3 · build bằng Vibecode Kit v6.1
