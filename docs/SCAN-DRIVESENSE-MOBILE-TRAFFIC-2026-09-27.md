# DriveSense mobile traffic perception scan

**Ngày rà soát:** 2026-09-27
**Phạm vi:** trình duyệt trên iPhone 16 Pro Max và Xiaomi 14T; nhận diện ô tô, xe tải,
xe buýt, xe máy, xe đạp và người đi bộ; bám mục tiêu, ước lượng khoảng cách và cảnh báo.
**Trạng thái:** technical audit / research — không phải chứng nhận an toàn giao thông.

## Kết luận điều hành

DriveSense hiện có nền móng đúng cho một PoC: inference chạy ngoài main thread,
latest-frame-wins, tracker có xác nhận nhiều frame, depth chạy nhịp riêng, kết quả cũ bị
loại và risk layer biết từ chối khi bằng chứng yếu. Tuy nhiên phiên bản hiện tại chưa phải
một pipeline đa đối tượng giao thông và chưa đủ cơ sở để phát cảnh báo va chạm trên đường.

Ba blocker lớn nhất không nằm ở UI:

1. Detector chỉ công bố `car/bus/truck`; `person/bicycle/motorcycle` bị loại ngay tại
   label map và một lần nữa tại candidate policy.
2. iPhone dùng ONNX Runtime Web/WASM cho pipeline hiện tại; tài liệu ORT chưa hỗ trợ
   WebGPU trên Safari/Chrome iOS. Hai model lớn chạy song song trên CPU là nguyên nhân hệ
   thống của latency, thermal throttling và track chớp tắt — không thể chữa bằng kéo dài
   box hold vô hạn.
3. Depth 99 MB hiện tự khai scope `desktop-analysed-video-poc` nhưng được gọi trong
   camera-live. Nhịp depth trên dual-WASM là 1.2–2.5 giây, quá chậm để làm tín hiệu chính
   cho cảnh báo va chạm.

**Hướng tối ưu đúng:** detector nhỏ + tracker/optical motion nhanh + metric anchor chậm.
Không chạy detector và depth như hai pipeline realtime ngang hàng. Cảnh báo dùng nhiều
nguồn có timestamp/covariance, fail-closed và có hysteresis; số mét chỉ xuất hiện khi
camera đã hiệu chuẩn và phép đo qua quality gate.

## Quy ước bằng chứng

- `✓✓` — được xác nhận bởi code hiện tại và nguồn kỹ thuật độc lập.
- `✓` — có nguồn sơ cấp nhưng chưa benchmark trên hai điện thoại mục tiêu.
- `—` — chưa có phép đo; không điền phỏng đoán.
- `DISPUTED` — con số benchmark tồn tại nhưng không đại diện cho trình duyệt điện thoại.

## 1. Hiện trạng có thể tái kiểm tra

| Phát hiện | Bằng chứng local | Trạng thái |
|---|---|---|
| Model detector hiện tại là RT-DETRv2 R18, input 640×640, graph WebGPU FP32 81,033,458 byte | `src/drive/detector-contract.ts` | ✓✓ |
| Label map chỉ có COCO 2/5/7: car, bus, truck | `src/drive/detector-contract.ts:8` | ✓✓ |
| Candidate policy tiếp tục lọc chỉ `car/bus/truck` | `src/drive/vehicle-candidates.ts:12-18` | ✓✓ |
| Camera xin 1280×720, 30 fps ideal, tối đa 60; chưa đọc/điều chỉnh lại theo `getSettings()` và thermal load | `src/drive/camera-source.ts:12-14` | ✓✓ |
| Main thread gọi `drawImage + getImageData`; khi depth đến nhịp còn đọc pixel lần hai trước khi transfer sang hai worker | `src/drive/app.ts:191-212` | ✓✓ |
| Depth graph 99,159,817 byte, 392×224, cắt ở 80 m, scope đang là desktop analysed-video PoC | `src/drive/metric-contract.ts:20-27` | ✓✓ |
| Dual-WASM tự hạ depth xuống mỗi 1.2–2.5 s | `src/drive/live-scheduler.ts:1-10` | ✓✓ |
| Tracker là ByteTrack-inspired high/low association, nhưng không có appearance embedding hay optical-flow correction | `src/drive/tracking.ts:89-131` | ✓✓ |
| TTC quang học hiện suy từ tốc độ tăng log-area của bounding box; cần ít nhất ba cập nhật scale | `src/drive/tracking.ts:181-188` | ✓✓ |
| In-path là corridor hình học cố định quanh tâm ảnh, chưa dùng lane polygon đang nhận diện | `src/drive/risk.ts:47-59` | ✓✓ |
| Risk dùng tốc độ ego do UI cung cấp; chưa có speed/timestamp sensor tự động | `src/drive/risk.ts:70-79` | ✓✓ |
| Accuracy mét trên iPhone/Xiaomi với ground truth độc lập | Chưa có corpus có mốc đo | — |
| P95 sensor-to-alert sau soak 20–30 phút | Chưa có capture timestamp + mobile soak report | — |

## 2. Bottleneck theo mức độ ưu tiên

### P0 — taxonomy và state model không bao phủ bài toán

RT-DETR COCO vốn có các lớp `person`, `bicycle`, `motorcycle`, nhưng graph DriveSense chỉ
map ba lớp xe bốn bánh. Chỉ thêm label map vẫn chưa đủ: `VehicleTracker`, range ROI,
ordinal validator và risk logic đều đang mang giả định “vehicle family”.

Cần thay bằng taxonomy trung lập:

```text
road_vehicle = car | bus | truck
vru          = motorcycle | bicycle | person
unknown_mover
```

Mỗi group cần policy riêng:

- xe bốn bánh: contact point quanh đáy giữa/rear footprint;
- xe máy/xe đạp: contact point bánh với road plane, giữ rider và vehicle thành compound
  target để tránh hai cảnh báo cho một thực thể;
- người đi bộ: footpoint/pose hoặc mask tốt hơn đáy bounding box; risk dùng crossing path,
  không dùng time-headway của xe đi cùng làn;
- nhãn có thể đổi trong cùng group mà không đổi track ID.

### P0 — iOS không có execution path đủ mạnh cho hai model hiện tại

Theo ma trận chính thức của ONNX Runtime Web, WASM chạy trên iOS nhưng WebGPU không chạy
trên Safari iOS hoặc Chrome iOS; Chrome iOS vẫn dùng nền tảng WebKit. Ngược lại Chrome
Android có WebGPU trên thiết bị hỗ trợ. Vì vậy phải có hai product tiers thật sự, không
coi fallback là cùng một sản phẩm:

| Tier | Thiết bị | Detector | Range | Cảnh báo được phép |
|---|---|---|---|---|
| A | Android Chrome + WebGPU đạt benchmark | 384–512, GPU | geometry + depth chậm | distance/TTC có quality gate |
| B | iOS browser / WASM | 320–384 q8, CPU | geometry đã hiệu chuẩn; neural depth mặc định off | optical TTC/proximity, không giả số mét |
| C | latency/thermal vượt gate | detector nhịp thấp hoặc off | off | “không đủ hiệu năng”, không cảnh báo |

Kéo dài overlay lên 1.8 giây chỉ làm giao diện bớt chớp; nó không làm bằng chứng mới hơn.
Mỗi box/range/risk phải giữ `capturedAt`, `publishedAt`, `ageMs`; quá hạn thì giảm style
và sau đó biến mất, không được tiếp tục phát đỏ.

### P0 — metric depth không thể là vòng cảnh báo nhanh

Depth Anything V2 là mô hình monocular per-frame. Nó hữu ích làm metric/ordinal prior,
nhưng không tự biết camera intrinsics/crop của từng điện thoại và không đảm bảo temporal
consistency cho video. Ở 392×224, xe xa có ROI rất ít pixel; sai số và background mixing
tăng mạnh. Trần 80 m của graph hiện tại cũng khiến vùng cao tốc xa bị saturation.

Kiến trúc đúng là:

1. **Fast loop 20–30 Hz:** camera timestamp, tracker prediction, sparse feature/optical
   expansion trong ROI, lane/corridor và risk state machine.
2. **Detector loop 4–15 Hz tùy thiết bị:** refresh class/box/identity, không tạo queue.
3. **Range anchor 0.5–2 Hz:** calibrated road-plane geometry trước; monocular metric depth
   là đối chứng chậm, không phải nguồn duy nhất.
4. **Fusion:** state `(X, Z, Vx, Vz, covariance, evidenceAge)` theo track. Số mét, TTC và
   cảnh báo đọc cùng một state snapshot, không trộn frame khác thời điểm.

Optical expansion có thể ước lượng TTC mà không cần scale mét; nghiên cứu CVPR 2023 cho
thấy optical expansion được dùng trực tiếp cho motion-in-depth và TTC. Đây là đường cứu
latency trên iPhone, nhưng vẫn phải bù ego-motion/rotation và kiểm texture/blur.

### P1 — copy, resize và allocation đang ăn latency/điện năng

Frame path hiện tại tạo nhiều bản sao CPU:

```text
camera video
  -> Canvas2D 640×aspect -> getImageData RGBA -> worker
  -> Canvas2D 392×224    -> getImageData RGBA -> depth worker
  -> worker resize 640×640 -> Float32 NCHW -> GPU/WASM
```

Với detector 640×640, riêng tensor FP32 NCHW gần 4.9 MB mỗi lần; RGBA 640×640 thêm khoảng
1.6 MB, chưa kể source canvas, model activations và depth. Allocation mới mỗi inference
tạo GC pressure rõ rệt trên mobile.

Thứ tự tối ưu:

1. đo riêng `capture/resize`, `RGBA transfer`, `normalize`, `session.run`, `decode/NMS`;
2. tái sử dụng canvas/buffer và tránh đổi `width/height` canvas trong vòng lặp;
3. dùng một frame router/worker; truyền `VideoFrame`/`ImageBitmap` khi browser hỗ trợ,
   đóng resource ngay sau dùng;
4. Android WebGPU: thử graph capture cho static shape; thử GPU preprocessing + IO binding
   để tránh CPU→GPU copy;
5. iOS/WASM: dùng graph/input nhỏ hơn thay vì tối ưu copy quanh một model quá lớn.

WebCodecs quy định `VideoFrame` có thể transfer giữa realm mà không bắt buộc deep-copy và
khuyến nghị realtime pipeline chạy trong worker. Cần capability gate vì support camera
track processor không đồng đều trên iOS.

### P1 — detector bake-off chưa có bằng chứng trên thiết bị mục tiêu

Không chọn model bằng latency công bố trên NVIDIA T4. Ma trận ứng viên hợp lý:

| Ứng viên | Điểm mạnh | Rủi ro/gate thương mại | Vai trò |
|---|---|---|---|
| RT-DETRv2 R18 hiện tại | Apache-2.0, code đã chạy, chất lượng COCO ổn | 640 và transformer nặng với iOS WASM | control |
| RF-DETR Nano 384 | Apache-2.0; tài liệu công bố 30.5M params, COCO AP50:95 48.4 | số 2.3 ms là TensorRT/T4, **không đại diện mobile browser** | challenger A |
| YOLO26n 320/384 | export ONNX chính thức, kiến trúc mobile-friendly để benchmark | AGPL-3.0 hoặc Enterprise; phải qua license gate trước sản phẩm đóng | challenger B |
| lightweight TFLite/MediaPipe detector | runtime browser/WASM trưởng thành, model nhỏ | cần đo recall vật nhỏ/xe máy VN và worker behavior | iOS fallback challenger |

Mỗi model phải chạy cùng source frames, cùng postprocess và cùng tracker contract. Báo cáo
phải có: model download/warmup, p50/p95 inference, capture-to-overlay, memory proxy,
dropped/busy ratio, recall/AP theo class và track continuity. Không dùng FPS trung bình
để che tail latency.

### P1 — risk hiện chỉ đúng cho “xe trước mặt đi cùng hướng”

Corridor cố định quanh tâm ảnh có thể nhầm xe làn bên, bỏ lỡ cua và không xử lý người đi
ngang. Pipeline lane đã có nhưng risk chưa nhận ego corridor từ lane output. Cần hợp nhất:

- ego corridor có timestamp/quality và projection xuống road plane;
- object footprint/footpoint + covariance;
- closest point of approach (CPA) và time-to-path-intersection cho người/xe đạp/xe máy;
- time-headway chỉ áp cho mục tiêu cùng corridor và cùng hướng;
- alert state machine có persistence, hysteresis và cooldown để không nhấp nháy;
- critical cần ít nhất hai nguồn đồng thuận hoặc một nguồn mạnh đã hiệu chuẩn.

### P1 — camera, nhiệt và vòng đời browser chưa được quản trị

W3C cho phép width/height/frameRate/resizeMode constraints và đọc settings thực tế.
DriveSense mới yêu cầu ideal 1280×720 nhưng chưa:

- ghi lại settings thực nhận, lens/crop/orientation và thay đổi giữa phiên;
- hạ camera xuống 720p/30 hoặc 640p/30 khi thermal governor kích hoạt;
- phát hiện tab background, screen lock, dropped presented frames;
- chạy soak 20–30 phút và so p95 theo cửa sổ thời gian;
- tự tắt depth/lane trước khi hạ detector;
- chặn cảnh báo khi capture-to-alert age vượt budget.

## 3. Kiến trúc mục tiêu

```text
Camera 720p/30 + capture timestamp + actual settings
                 |
          Latest-frame router
        /          |             \
 detector       motion loop      lane/road
 4–15 Hz       20–30 Hz           1–5 Hz
        \          |             /
      Multi-class road-user tracker
    ID + class-group + box/contact/footpoint
         X/Z/Vx/Vz + covariance + age
                 |
     Range providers (quality-ranked)
  calibrated ground plane > temporal geometry
        > metric-depth cross-check > null
                 |
      Risk fusion + hysteresis
   headway | optical TTC | CPA/crossing
                 |
  quiet HUD / audio only on stable escalation
```

### Invariants bắt buộc

- Một frame timestamp xuyên suốt capture → detect → track → range → risk → HUD.
- Không queue frame; latest-frame-wins và báo rõ skipped/busy.
- Không dùng prediction để làm measurement; prediction chỉ giữ motion/overlay.
- Range provider không được đổi đơn vị/meaning ngầm (`optical-axis Z`, road-forward Z,
  bumper gap là ba đại lượng khác nhau).
- Không số mét khi camera/lens/crop chưa hiệu chuẩn hoặc uncertainty vượt gate.
- Không critical từ một detection đơn lẻ hoặc evidence đã stale.
- Một rider + xe máy/xe đạp phải hợp nhất thành một hazard object khi đủ bằng chứng.

## 4. Kế hoạch TIP đề xuất

### TIP-60A — Mobile capability and soak harness (làm trước)

Không đổi model. Bổ sung report trên chính iPhone/Xiaomi:

- browser/OS/backend, camera settings thực nhận;
- model load/warmup;
- p50/p95/p99 cho capture, preprocess, detector, depth, track, frame→overlay,
  frame→alert;
- busy/skipped/stale/dropped, track churn, số lần context loss;
- cửa sổ 0–5, 5–10, 10–20 phút để thấy thermal degradation;
- nút xuất JSON không chứa frame camera.

**Gate:** không quyết định đổi model trước khi có hai report 10–20 phút từ hai máy.

### TIP-60B — Road-user taxonomy and tracker contract

- mở label map `person/bicycle/motorcycle/car/bus/truck`;
- thay `VehicleTracker` bằng `RoadUserTracker` có class groups;
- compound rider association;
- class-specific confirmation thresholds/contact extraction;
- benchmark continuity theo class, không chỉ box count.

**Gate:** corpus local có đủ mỗi class, occlusion, vượt làn, night/blur; không regression
car/bus/truck hiện tại.

### TIP-60C — Mobile detector bake-off

Export/pin từng challenger, kiểm SHA/license/operator coverage, rồi benchmark cùng corpus.
Chọn model theo Pareto của **recall mục tiêu nguy hiểm + P95 latency + thermal stability**,
không theo AP hoặc FPS riêng lẻ.

**Gate thương mại:** YOLO26 chỉ đi tiếp nếu chấp nhận AGPL hoặc có Enterprise license.
RF-DETR chỉ đi tiếp nếu ONNX graph chạy hoàn toàn trên backend mục tiêu và không có CPU
fallback phá latency.

### TIP-60D — Dual-rate motion/range fusion

- sparse ROI motion/optical expansion giữa hai detector observations;
- road-plane contact range khi có profile;
- depth thành anchor/cross-check thích nghi;
- covariance + age-aware fusion;
- CPA/crossing cho VRU;
- alert persistence/hysteresis/cooldown.

**Gate:** alert output phải tái tạo được từ log timestamp; disagreement tạo abstention,
không chọn nguồn “có vẻ đúng”.

### TIP-60E — Ground-truth validation

Tạo bộ video riêng theo device/lens/mount, có mốc khoảng cách thực hoặc sensor đối chứng.
Tách journey để tránh adjacent-frame leakage. Báo cáo theo bin `0–10`, `10–30`, `30–60`,
`>60 m`, class, lane position, ngày/đêm/mưa và occlusion.

**Gate:** chỉ bin/class đã đủ mẫu và đạt threshold mới được xuất số mét/cảnh báo; vùng còn
lại giữ `chưa đo`.

## 5. Ngân sách hiệu năng để thiết kế benchmark

Đây là target, không phải kết quả đã đạt:

| Chỉ tiêu | PoC mobile target | Product gate dự kiến |
|---|---:|---:|
| UI/render | không block >50 ms thường xuyên | ổn định 30 fps trở lên |
| capture→box P95 | ≤250 ms | ≤150 ms |
| detector cadence | iOS ≥4 Hz; Android ≥8 Hz | thiết bị support matrix riêng |
| fast motion/risk loop | ≥20 Hz | ≥25 Hz |
| stale box | không dùng cho risk sau 500 ms | theo measured motion uncertainty |
| stale metric range | không dùng cho alert sau 600–800 ms | theo provider covariance |
| soak | 20 phút không crash/OOM | 60 phút và tail latency không suy giảm quá gate |
| metric accuracy | —, cần ground truth | công bố riêng từng distance bin/class |

Ở 100 km/h, xe đi khoảng 27.8 m mỗi giây; thêm 500 ms latency tương đương gần 13.9 m di
chuyển. Vì vậy “box nhìn mượt” không thể thay thế sensor-to-alert age.

## 6. Nguồn sơ cấp đã đối chiếu

1. ONNX Runtime Web, execution-provider/browser matrix và khuyến nghị WebGPU/WASM:
   https://onnxruntime.ai/docs/get-started/with-javascript/web.html
2. ONNX Runtime Web performance diagnosis, graph capture, profiling và IO binding:
   https://onnxruntime.ai/docs/tutorials/web/performance-diagnosis.html
   https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html
3. W3C Media Capture and Streams — camera constraints/settings:
   https://www.w3.org/TR/mediacapture-streams/
4. W3C WebCodecs — transferable `VideoFrame`, worker pipeline và lifecycle:
   https://www.w3.org/TR/webcodecs/
5. ByteTrack ECCV 2022 — association cả detection score thấp:
   https://www.ecva.net/papers/eccv_2022/papers_ECCV/papers/136820001.pdf
6. Depth Anything V2 — monocular/metric depth family:
   https://arxiv.org/abs/2406.09414
7. Learning Optical Expansion From Scale Matching, CVPR 2023:
   https://openaccess.thecvf.com/content/CVPR2023/html/Ling_Learning_Optical_Expansion_From_Scale_Matching_CVPR_2023_paper.html
8. RF-DETR official repository/docs — Nano parameters/benchmark/license:
   https://github.com/roboflow/rf-detr/blob/develop/docs/learn/run/detection.md
9. Ultralytics YOLO26 ONNX export và license:
   https://docs.ultralytics.com/models/yolo26
   https://docs.ultralytics.com/help/contributing
10. BDD100K official schema — road-user classes:
    https://github.com/ucbdrive/bdd100k/blob/master/doc/format.md
11. KITTI official benchmark — calibrated camera/LiDAR ground truth and road classes:
    https://www.cvlibs.net/datasets/kitti/

## 7. Quyết định đề xuất

Khởi động **TIP-60A trước, TIP-60B song song sau khi telemetry contract cố định**. Không
thay model ngay và không bật thêm classes bằng một patch label-only: cách đó sẽ làm UI có
nhiều box hơn nhưng range/risk vẫn sai semantics. Sau khi có hai mobile soak reports và
corpus đa lớp, TIP-60C mới chọn được detector; TIP-60D mới được phép thay risk loop.

Đường ngắn nhất tới demo thuyết phục không phải “có nhiều box”, mà là:

1. box không chớp và ID không đổi;
2. nearest hazard đúng;
3. số mét biết từ chối;
4. cảnh báo đến đúng lúc, không nhấp nháy;
5. report chứng minh latency/continuity trên đúng chiếc điện thoại đang demo.
