# DriveSense — Điều tra iPhone và kiến trúc cải tiến đo khoảng cách

08/10/2026 · TIP-61R · bản chạy `8f1650d04912`.

## Kết luận điều hành

**Không phải chỉ do iPhone thiếu GPU, không phải chỉ cần thêm dataset và không
phải lỗi thao tác của người dùng.** JSON mới xác nhận hai model đã chạy WebGPU.
Điểm nghẽn có bằng chứng là độ phủ phép đo thấp: các gate ROI/binding loại nhiều
lượt, cộng với pipeline inference chậm và tuổi phép đo rất ngắn trên HUD.

Một thiếu sót cấu trúc được xác minh: camera portrait 720×1280 bị letterbox vào
model landscape 392×224; chỉ 32,14% tensor chứa ảnh thật. Diagnostic test chứng
minh cùng một box tương đối hợp lệ ở landscape nhưng bị loại ở portrait. Tuy
nhiên JSON không giữ reason/subgate từng object và raw box/map, nên **chưa thể
khẳng định portrait là nguyên nhân của cả 15 lượt ROI-rejected**.

Không sửa production trong nghiên cứu này. Không tăng TTL, hạ ngưỡng hay tắt
kiểm tra thứ tự để ép hiện mét. Hướng đúng là cải tiến camera/model contract,
object range estimator và temporal scheduling cùng nhau, đo bằng evidence độc
lập trước khi phát hành. Bản hiện tại **NOT READY cho continuous iPhone range**.

## 1. Bằng chứng thực tế từ phiên owner

Input: `drivesense-report.json`, schema 9, SHA256
`de9b54013220c0ce7a09ee607fac61ca4ec541f5a8802e9b43472688ce410932`.
Source fingerprint khớp JS đã deploy:
`79dd54fe6d497c1b99f0e4f7cad328413d1c6876cc71713841719a6ddc936407`.
Actual workers/live camera, iPhone Chrome; không phải mock/offline replay.
Không sao chép raw report/ID phiên vào registry web; chỉ lưu numerical summary.

| Hạng mục | Kết quả | Ý nghĩa |
| --- | --- | --- |
| Nguồn | 720×1280, camera sau, 30fps | Ảnh dọc thật, không chỉ CSS dọc |
| Backend | Detector WebGPU, depth WebGPU | Bác bỏ giả thuyết thiếu GPU/WASM fallback cho phiên này |
| Lifecycle | 0 fault, đang RUNNING | Không có bằng chứng worker crash/degraded trong ~60s này |
| Detector | 66 started, 65 completed, 1 inflight | Không được coi inflight là lỗi |
| Depth | 36 started, 35 completed, 1 inflight | Tất cả 35 lượt có result; model không “không chạy” |
| Depth outcome | 15 admitted; 15 ROI-rejected; 2 binding-rejected; 3 stale | Đếm theo attempt, không theo số xe |
| Phép đo khả dụng trên HUD theo ledger | 7.638/59.539s = 12,83% | Time-weighted admission; không phải scanout/mét đúng đã nghiệm thu |
| Blackout dài nhất | 24,938s | Full-session gồm startup, không chỉ post-ready |
| Detector request P50/P95 | 616/1143ms | Chưa đủ cho phản hồi ADAS nhanh |
| Depth inference P50/P95 | 647/1397ms | P95 đã vượt budget 1200ms, chưa tính join/UI |
| Frame-to-overlay P95 | 1187ms | Khác với camera render 30fps |
| Load metric / detector | 24,199 / 20,872s | Lần tải/compile đầu là vấn đề UX độc lập |
| Profile / zoom | null / 1× | Zoom gate không giải thích phiên này; AI đã admit dù không có profile |
| Ground truth mét | Không có | Không được công bố accuracy/MAE từ JSON này |

Backend ở đây là provider mà worker chọn khi tạo session, không phải bằng chứng
kernel-by-kernel rằng toàn bộ graph luôn chạy GPU. Chưa có kernel profiling;
nhưng dữ liệu này đủ để bác bỏ kết luận “không có GPU nên depth không chạy”.

Tỷ lệ 15/35 = 42,86% trên completed attempts; report aggregate 15/36 = 41,67%
có mẫu số started gồm 1 inflight. Cả hai khác hoàn toàn coverage 12,83% theo thời
gian. Busy skip 1092 là callback bị chặn bởi request đang chạy, **không phải số đo
94% CPU utilisation**. Bắt buộc giữ phân biệt này khi báo cáo hiệu năng.

Các observation có mét còn lại chỉ có ROI **24–72 pixels**. ID1 ghi ~25,99m rồi
~63,92m sau khoảng 1,05s; đây là anomaly cần đối chiếu object/frame/scale, không
chứng minh xe thật đã đứng yên hay model sai bao nhiêu mét. Spread nhỏ 2–9% không
chứng minh accuracy: một ROI đồng nhất nhưng nằm trên nền sai cũng có spread nhỏ.

“Chưa hiệu chuẩn” trong 107 track observations là placeholder của geometric
fallback khi track chưa có learned range. Không được suy luận 107 lỗi calibration
hoặc yêu cầu owner nhập profile như một cách chữa lỗi đã chứng minh.

## 2. Pipeline và vị trí chặn

```text
camera frame
  ├─ detector capture → RT-DETR → candidate/track confirmation → box HUD
  └─ depth capture → DA2 metric → same-capture join
       → interior ROI + range policy → immutable track binding
       → temporal filter → publication guard → metre HUD
```

Các trace quan trọng:

- `src/drive/app.ts:316`: sendFrame và dispatch cùng capture; latest strong track
  là điều kiện mở depth. Hai model cạnh tranh tài nguyên nhưng không có đo
  combined workload để lựa chọn budget/model trước startup.
- `src/worker/drive-range-worker.ts:1`: runtime WebGPU/JSEP, FP32, 1 WASM thread.
- `src/drive/live-metric-join.ts:4`: depth + detection phải join trong 1200ms.
  Box có budget riêng 2500ms. Xe đứng yên không làm inference/join nhanh hơn.
- `src/drive/learned-range.ts:41`: box phải rộng/cao ≥10 pixels trên depth map.
  Body patch 22–78% chiều rộng, 42–82% chiều cao; không có foreground mask.
- `src/drive/learned-range.ts:88`: zoom khác 1× abstain, nhưng JSON này 1×.
- `src/drive/learned-range.ts:110`: global cross-lane ordering dựa đáy box,
  source floor 2px. Không có bằng chứng local road plane/roll/tyre contact;
  bounding-box bottom chỉ là proxy. Gate có thể đúng để chặn số sai, nhưng chưa
  đủ để khẳng định mọi cặp xe đang nằm trên cùng một mặt phẳng.
- `src/drive/tracking.ts:143`: same-ID/IoU/miss/weak confirmation/measurement
  gates; khi không có phép đo hợp lệ trả generic unknown.
- `src/drive/tracking.ts:39`: Kalman reset nếu gap >800ms; scheduler thích ứng
  có thể thường xuyên vượt gap này. Test xác nhận jump 26→64m bị chặn ở gap500ms
  nhưng được khởi tạo lại ở gap1050ms. Không sửa bằng đổi một constant tuỳ ý.
- `src/drive/app.ts:209`: terminal ROI-rejected chỉ giữ outcome; lý do từng
  object/subgate không đi vào ledger. UI cuối phiên chỉ giữ lastReason, nên
  stale cuối phiên che các ROI failure trước đó.

**Mức root cause hiện có:** confirmed là execution có chạy nhưng publication
chain có rejection/low duty cycle; confirmed aspect-resampling/filter design
defects. Chưa confirmed gate nhỏ nào gây từng ROI rejection, GPU compiler hay
thermal throttling. Không coi GPU-presence hoặc một first success là readiness.

## 3. Diagnostic experiments — không giả làm benchmark iPhone

Chạy implementation thật của join/ROI/tracker/scheduler/publication trong virtual
time, xe synthetic đứng yên và map 24m hợp lệ. Session65s, bỏ5s đầu chỉ cho bảng
steady-state này; full-session owner evidence bên trên không bị thay mẫu số.

| Timing injected | Box coverage | Metre coverage | Kết luận cơ chế |
| --- | --- | --- | --- |
| GPU detector/depth 100/100ms | 100% | 100% | Positive control |
| WASM 600/500ms | 100% | 34,23% | Low duty cycle dù mọi map hợp lệ |
| WASM 1100/1000ms | 100% | 3,47% | Metres rất khó đọc dù không crash |
| WASM 1690/820ms | 100% | 0% | Detector chậm làm join stale |
| WASM 300/1690ms | 100% | 0% | Depth chậm làm join stale |
| GPU 616/647ms (tham số P50 owner) | 100% | 45,6% | Control không ROI reject vẫn không liên tục |

Dòng cuối là **mô phỏng timing bằng median**, không phải tái tạo trace phone hay
đo kết quả phone mới. Không suy từ P50 thành P95/thermal profile.

Portrait trong production transform: content126×224/87808pixels =32,14%; padding
67,86%. Source landscape1280×720: content392×220,5 =98,44%. Min box width trở
thành 7,94% chiều rộng portrait thay vì 2,55% landscape. Synthetic box5% bị
portrait ROI gate loại dù landscape vẫn valid. Không nới min pixels: cải thiện
sampling đúng orientation/aspect hoặc measured crop là việc cần kiểm đầu tiên.

Đã kiểm thêm: conflict across two cars, zoom, tiny/edge box, filter reset.
**12/12 mechanism scenarios PASS** nghĩa là tái hiện cơ chế đúng, không nghĩa
là lỗi sản phẩm đã sửa.

## 4. Nghiên cứu đối chiếu phương pháp

Registry refinery đóng băng 12 thực thể/53 claims/27 snapshots, SHA+literal span,
independent auditor/idempotence PASS. 6 applicable negative gates cắn, 8 N/A.
Không dùng repository fork làm nguồn tác giả. Không dùng paper FPS trên GPU
desktop làm iPhone/browser FPS; candidate device benchmark cells honest-null.

| Hướng | Giá trị thực tế | Điểm không được đánh tráo | Quyết định đề xuất |
| --- | --- | --- | --- |
| DA2 Metric Outdoor Small hiện tại | Metric baseline, Small24.8M; có thể giữ weights để A/B aspect/runtime | Synthetic Virtual KITTI fine-tune không xác nhận domain iPhone/Việt Nam | Giữ control; orientation export + precision benchmark trước |
| ZipDepth | Fused6.1M, mobile/NPU variant, MIT code | Scale-and-shift aligned evaluation không phải absolute metres | Candidate student/relative backbone có scale anchor; không drop-in |
| Lite-Mono Tiny | Compact2.2M, KITTI, MIT code | Mono eval median-scales bằng GT | Baseline lightweight có scale recovery; không tự đổi unit |
| FastDepth | MobileNet/depthwise/pruning reference, MIT code | Indoor NYU + JetsonTX2 evidence khác traffic/iPhone | Học architecture; không ưu tiên pretrained traffic deployment |
| DA3Metric-Large | Focal-conditioned metric cross-check, Apache designated weights |350M và focal scaling, không phải DA3Small “metric nhanh” | Teacher/lab trước; không đẩy thẳng vào phone hot path |
| Depth Pro | Metric/focal estimation, boundary teacher | GPU0.3s claim không phải mobile latency; licence Apple riêng | Offline teacher/cross-check, không default realtime phone |
| MoGe2 Small | Metric geometry/FOV/ONNX candidate, MIT card | Chọn đúng version/adapter; output camera/normal vẫn learned prior | Cross-check lab/teacher; benchmark trước mobile adoption |
| Calibrated ground-ray/road plane | CPU rất nhẹ, explicit scale/uncertainty, có sẵn module | Cần camera/mount/local plane; dốc/occlusion/crop/zoom dễ gây sai | Geometry fast path chỉ khi validity contract đạt |
| Optical flow + state estimator | Theo vật giữa neural anchors, giảm inference load | Flow không tự cung cấp scale; đứng yên không có parallax để khôi phục mét | Temporal association/prediction có uncertainty, không fake fresh |
| Core ML native | Có thể dùng ANE; giữ phần TypeScript/UI/contract | Bọc web trong app không tự biến ONNX JS thành Core ML | Escape hatch nếu web bake-off không đạt; cần approval riêng |

Nguồn gốc:
[DA2 metric](https://github.com/DepthAnything/Depth-Anything-V2/tree/main/metric_depth),
[ZipDepth](https://github.com/fabiotosi92/ZipDepth),
[Lite-Mono evaluation](https://github.com/noahzn/Lite-Mono/blob/main/evaluate_depth.py),
[FastDepth](https://github.com/dwofk/fast-depth),
[DA3](https://github.com/ByteDance-Seed/Depth-Anything-3),
[Depth Pro](https://github.com/apple-aiml-research/ml-depth-pro),
[MoGe](https://github.com/microsoft/MoGe),
[OpenCV calibration](https://docs.opencv.org/4.x/dc/dbb/tutorial_py_calibration.html),
[Optical flow](https://docs.opencv.org/4.x/d4/dee/tutorial_optical_flow.html),
[Apple Core ML compute units](https://developer.apple.com/documentation/coreml/mlcomputeunits).

### Runtime bottlenecks cần bake-off, không đoán

Runtime pin `1.22.0-dev.20250409-89f8206ba4` có trước Safari/WebGPU hiện nay. Lỗi
[ORT#26827](https://github.com/microsoft/onnxruntime/issues/26827) và comments
nói JSEP/WASM/asyncify có thể runaway compiler/resource trên WebKit. Comment mới
cũng báo native WebGPU asyncify bị cùng lớp lỗi. Đây là reported risk trên
workload khác, **không phải root cause đã chứng minh ở owner session** có0fault.
Không downgrade/upgrade/polyfill subgroup fields mù để “sửa GPU”.

A/B cần phân biệt **provider** và **binary/runtime**: chọn executionProviders
WASM trong WebGPU/JSEP build không tương đương WASM-only build. Mỗi lane phải
pin matching JS/MJS/WASM, model/operator coverage và trace actual binary hash.
GPU path hiện tại chạy thật nên phải giữ control này, không ép tất cả về CPU.

[ORT WebGPU docs](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html) hỗ trợ
preallocated GPU tensors và graph capture có điều kiện static-shape/all-GPU
kernels. Profiling kernel, upload/readback, CPU preprocessing và concurrent
models phải đo trước. FP16 cần device feature + numerical/metric parity; INT8
cần representative calibration/accuracy benchmark. Compression giảm file không
đồng nghĩa tăng inference speed; multithread không mặc nhiên giải quyết GPU
budget và cần isolation nếu dùng WASM theo [ORT env docs](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html).

## 5. Kiến trúc đề xuất — không chỉ đổi model

```text
Capture contract (lens/crop/orientation + effective K when known)
 → aspect-aware preprocessing + pixel/transform trace
 → capability/per-model workload admission + shared resource scheduler
 → detector/foreground/contact + geometry or metric anchor
 → per-object validity + independently calibrated uncertainty
 → timestamped state estimator / lightweight association
 → measured vs predicted vs unknown publication / risk layer
```

1. **Source-aware depth.** A/B fixed portrait224×392 và landscape392×224 cùng
   weights với parity/native reference; orientation change tạo generation mới.
   Không rotate/stretch ảnh sai, không chỉ sửa CSS. Candidate road crop phải
   giữ transform/K/lens identity, không vô tình mất lead vehicle.
2. **Object range thay vì blind rectangular median.** Foreground/component
   selection và contact support; edge/occlusion/min density/spread/model scale
   đều có reason riêng. Median patch hiện tại có thể ăn kính/nền. Đối chiếu
   learned depth với camera geometry ở vùng đủ điều kiện, không tự swap mét.
3. **Consistency đúng applicability.** Chỉ dùng ground ordering khi same local
   road plane/roll/contact uncertainty được kiểm. Bbox bottom +2px không phải
   chứng minh mặt đường; ambiguity phải giữ unknown, không xoá guard cho đẹp UI.
4. **Temporal continuity không kéo dài TTL.** Đo budget cho capture→admission và
   anchor gap; chọn rate đủ để phủ budget. EKF/robust filter theo dt thực, object
   ID/ego-motion và covariance; không mất innovation history ở cadence>800ms.
   Prediction nếu có phải có tuổi anchor/uncertainty và trạng thái riêng, không
   tự refresh evidence timestamp hoặc cấp quyền cảnh báo từ measurement cũ.
5. **Scale thực.** Với ray r=K^-1[u,v,1] và local plane n·X+d=0, giao điểm có
   lambda=-d/(n·r); Z=lambda*r_z. K/height/plane sai thì mét sai. Ảnh đứng yên
   không tự tạo scale, flow/parallax không chữa được thiếu anchor. Geometry
   channel và learned optical-axis Z phải thống nhất datum trước fusion;
   khoảng hở bumper/lateral là contract khác, không tráo với camera-forward Z.
6. **Model nhỏ có metric supervision.** Nếu DA2 optimized vẫn không đạt, bake-off
   distilled student/mobile backbone conditioned by lens/scale with explicit
   supervised metric training. Teacher pseudo-depth không phải physical truth.
   Không coi student nhẹ/ZipDepth relative là lời giải metric sẵn có.

## 6. Task graph và acceptance đề xuất

Approval kiến trúc rồi triển khai theo thứ tự; no new hardware/native/server
investment là mặc định. TIP IDs dưới đây là các lát đề xuất, chưa implement.

| Lát | Nội dung | Gate trước khi đi tiếp |
| --- | --- | --- |
|61D1|Per-attempt/per-object reject trace, reason taxonomy, pixel-free ROI stats + ID/clock/transform; cache/session/cold-start identity|Giải thích100% terminal outcomes, không chỉ lastReason; test log overhead |
|61D2|Aspect-aware exports và isolated/combined runtime profiling on same corpus; matching binaries/operator coverage|Portrait/landscape numerical + ROI correctness; no false unit/freshness; measured comparison |
|61D3|Foreground/contact estimator + conditional road consistency + variable-dt filter|Reproduce density/conflict/occlusion/outlier; independent distance/lead truth, no stale metre |
|61E|Lightweight metric candidate/distillation nếu baseline không đạt; FP16/WASM-only/native-WebGPU A/B có điều kiện|Same workload quality/latency/availability/memory/licence; không lấy GPU paper FPS làm evidence |
|61F|At-rest phone clip/stationary tests rồi sustained30min local replay; HTTPS acceptance|Device-bound artifacts + no reload/device loss + complete evidence; chưa cần public-road test |

Targets để thảo luận/phê duyệt cho **PoC**, không phải tiêu chuẩn chứng nhận ADAS:

- P95 capture→metre HUD admission ≤300ms, fresh metric anchors ≥3Hz sustained;
  không dùng camera30fps hoặc JS paint FPS để chứng minh requirement này.
- Independently reviewed visible/eligible lead coverage ≥95%; longest post-ready
  blackout≤1s; luôn báo full-session availability/cold-start riêng. Không loại
  hard frames chỉ vì model/gate fail để làm đẹp eligible denominator.
- Prototype scope3–50m; P95 absolute error target≤max(0,5m,15%Z) trên held-out
  independently measured truth. Chưa có dữ liệu để nói baseline đạt. ODD phải
  định nghĩa lane/slope/crop/night/occlusion và geometry datum rõ.
- Labels `≈m` là unvalidated đến khi gate đạt; unknown có subreason. Predicted
  range không được ngụy trang là fresh measured range/risk-authoritative.
- Init/concurrent/sustained tests báo JS+runtime+weights hashes, source dimensions,
  rejected reasons, accepted anchor intervals, memory indicators available/null;
  test storage failure/rotation/tab background/kill/source switch/outlier.

Nếu browser không đạt targets sau bake-off đã có bằng chứng, báo thẳng “web
không phù hợp hot path cho cấu hình này” và xin duyệt native Core ML inference
bridge. Không tự mua Jetson/LiDAR, gọi API cloud hoặc biến UI demo thành safety
claim. Smartphone existing và local clips vẫn đủ cho development phase này.

## 7. Verify và việc còn thiếu

- Research R-01–06:6/6 outputs complete; refinery53claims/12entities/27snapshots.
- Diagnostic production functions:12/12 scenarios, anonymous owner audit PASS.
- Typecheck PASS; unit296/296 PASS; existing dist release verifier5/5 PASS.
- Production source/model/runtime/deploy **không thay**; không gọi các tests
  này là fix verification. Build production không rerun vì runtime không đổi.
- Missing: exact15ROI subgates/raw frame diagnosis, same-corpus candidate bake-off,
  model accuracy truth, actual sustained phone soak và approved new architecture.

Evidence: `docs/evidence/tip61r/owner-session-audit.json`,
`docs/evidence/tip61r/stationary-mechanisms.json`,
`research/mobile-metric-2026-10/registry.json`, `verification.json`.

**Kết luận Contractor:** ưu tiên61D1→61D2, sau đó61D3/E; không bắt đầu bằng thay
model ngẫu nhiên. Nghiên cứu đã hoàn tất, sửa sản phẩm chưa triển khai và sản
phẩm realtime iPhone vẫn NOT READY.
