# DriveSense — camera đo khoảng cách xe và phân tích nguy cơ

Ngày khảo sát: 2026-09-13. **Kiến trúc được người dùng phê duyệt ngày 2026-09-13.**
Triển khai theo TIP-41; phê duyệt kiến trúc không đồng nghĩa nghiệm thu an toàn.

## 1. Kết luận chủ thầu

Có cơ sở làm sản phẩm phân tích video hành trình và prototype hiển thị trực tiếp.
Chưa có cơ sở hứa đo chính xác mọi xe, mọi khoảng cách, trên mọi điện thoại; chưa
có dữ liệu cho phép dùng làm hệ thống an toàn duy nhất khi lái xe.

Khuyến nghị: bắt đầu bằng video có ground truth, một camera gắn cố định, hiệu chuẩn
được; thử nghiệm **hình học mặt đường + metric depth + theo dõi theo thời gian**.
Chỉ chốt model sau benchmark trên đúng phần cứng, cùng tập test và cùng định nghĩa
khoảng cách. Không chọn model theo demo đẹp hoặc bảng FPS khác thiết bị.

Nếu yêu cầu cuối là sai số nhỏ và ổn định ở xa trên địa hình phức tạp, cần một
nhánh so sánh camera đơn với stereo/radar đã hiệu chuẩn, không mặc định AI camera
đơn là đủ. Thêm cảm biến không tự tạo ra chứng nhận an toàn.

## 2. Scan codebase — vai thợ khảo sát

Stack: TypeScript strict, Vite, Three.js, Transformers.js/ONNX workers; local-first,
không backend hiện hữu cho inference. Manifest `package.json`, cấu hình `tsconfig.json`.

| Thành phần | Bằng chứng | Đánh giá |
|---|---|---|
| Detection xe | `src/detection-config.ts`, `src/worker/detect-worker.ts` | Có RT-DETRv2 R18 ONNX đã pin revision; dùng làm baseline, không mặc định đạt recall xe ở xa |
| Overlay và capture timestamp | `src/detection-types.ts`, `src/main.ts` | Tái sử dụng cơ chế timestamp và HUD; phải giữ đúng frame đo |
| Tracking 2D | `src/detection-smooth.ts` | Alpha-beta + greedy association, chỉ trả DetBox; chưa có track ID công khai, covariance, trạng thái range/closing-speed |
| Metric depth | `src/worker/metric-worker.ts` | Depth Pro on-demand cho khung đóng băng, không phải vòng đo trực tiếp |
| Nâng hộp 3D | `src/render/lift-metric.ts` | Percentile depth trong bbox, Z tâm hộp; không phải khoảng hở cản xe, chưa tách xe khỏi nền bằng mask |
| Thông số camera | `src/main.ts` quanh handler metric | Có focal ước lượng/FOV fallback; không thấy quy trình calibration gắn xe, lens distortion, pitch/IMU |
| Hình camera | `src/render/scene.ts` attachVideo | RGB hiện mirror X cho tương tác bàn tay; DriveSense phải có transform riêng, không đảo trái/phải đường |
| Benchmark cũ | `tests/fixtures/detection-benchmark.manifest.json` | Chỉ ba ảnh regression, không có range ground truth hoặc cut-in sequence |

Gaps P0: video replay clock; camera profile; đo khoảng hở đúng định nghĩa; ID ổn định;
đồng bộ detection/depth/IMU; path association; uncertainty/abstention; benchmark xe
động và phát hiện dữ liệu cũ. Không được gán chữ "mét thật" cho đầu ra chỉ vì tensor
có đơn vị mét. Không chạy lại build/unit trong lượt chỉ thêm tài liệu này; kết quả
74 unit tests của TIP-39 là lịch sử, không phải bằng chứng nghiệm thu DriveSense.

## 3. Bài toán đo: phải định nghĩa đúng đại lượng

- `camera_z_m`: độ sâu theo trục quang học, không phải khoảng cách Euclid.
- `camera_range_m`: khoảng cách từ camera đến điểm bề mặt quan sát được.
- `longitudinal_gap_m`: khoảng hở dọc đường chạy, từ mặt trước xe mình đến mặt gần
  nhất của xe mục tiêu trong vùng có khả năng xung đột. Đây là đại lượng muốn dùng
  cho xe dẫn đầu. Cần camera-to-vehicle extrinsics và bề mặt mục tiêu hợp lệ.
- `lateral_clearance_m`: khoảng hở ngang, là bài toán khác cho xe vừa vượt/ở bên.

Không chuyển Z tâm hộp sang khoảng hở bằng một hằng số chiều dài xe. Xe nhìn ngang,
xe bị cắt ở biên, bánh bị che, hoặc mặt sau không thấy có thể chỉ trả range thô /
unknown. Bbox 2D không đủ khôi phục chắc chắn mặt gần nhất của vật thể 3D.

**Hình học minh họa, không phải kết quả đo:** camera pinhole nằm ngang trên mặt
phẳng, cao h, tiêu cự fy; điểm chạm đất ở v, chân trời vh thì
`Z = fy*h/(v-vh)`. Tổng quát phải undistort rồi giao ray với local ground plane.
Với fy=1000 px, h=1.4 m, Z=30 m, mẫu số chỉ 46.7 px; sai 3 px gây xấp xỉ 1.9 m
sai số bậc nhất. Lên dốc, nhún xe khi phanh hoặc máy đổi crop có thể phá giả định.
Cơ sở camera model: [OpenCV calibration](https://docs.opencv.org/4.13.0/d9/d0c/group__calib3d.html).

Hệ monocular không có mốc tỷ lệ chỉ suy đoán kích thước tuyệt đối từ prior học được.
Biết chiều rộng trung bình ô tô là prior, không phải phép đo: xe tải, góc yaw và
phần khuất làm sai tỷ lệ. Camera height, intrinsics, IMU, tốc độ có timestamp giúp
ràng buộc nhưng không loại mọi sai số. SfM/SLAM đa khung trên xe chuyển động cũng
không được xem như stereo tĩnh vì cả xe mục tiêu và camera đều chuyển động.

## 4. Nguồn hiện hành và quyết định thử nghiệm

Đây là shortlist có chủ đích, không phải bảng xếp hạng toàn ngành. Số liệu mô hình
là tác giả công bố, không phải đo độc lập trong RoboEye. Chi tiết bằng chứng ở
`research/drive-distance/claims.jsonl`.

| Giải pháp | Điểm đáng dùng | Giới hạn / quyết định |
|---|---|---|
| [RT-DETR](https://github.com/lyuwenyu/RT-DETR) | Nền detection sẵn có, repo Apache-2.0 | Baseline; kiểm tra riêng checkpoint/export, recall xe nhỏ và độ trễ |
| [RF-DETR Nano/Small](https://github.com/roboflow/rf-detr) | Detection/segmentation; các bản Apache-designated | Challenger; bảng latency dùng T4 TensorRT FP16, không suy ra tốc độ mobile. XL/2XL detection Plus dùng PML |
| [ByteTrack](https://github.com/FoundationVision/ByteTrack) | Giữ ID bằng association cả detections điểm thấp; MIT | Thử với state estimator theo mét; bản thân tracker không đo khoảng cách hoặc hiểu làn đường |
| [DA2 Metric Small outdoor](https://github.com/DepthAnything/Depth-Anything-V2/tree/main/metric_depth) | 24.8M tham số, baseline nhẹ; Small family Apache-2.0 | Outdoor fine-tune synthetic VKITTI; không nhầm với DA2 relative hiện tại; phải kiểm tra ONNX/runtime và lệch miền |
| [DA3 Metric Large](https://github.com/ByteDance-Seed/Depth-Anything-3) | 0.35B tham số, checkpoint Apache-2.0 | Challenger độ chính xác. API có quy tắc focal scaling; kiểm chứng không scale hai lần. Không lấy bản relative làm mét |
| [MetricAnything Student DepthMap](https://github.com/metric-anything/metric-anything) | Nguồn 2026; card Apache-2.0, đầu vào Image+Focal | 876.66M tham số: ứng viên reference offline; chưa có số đo mobile. Không mặc định nhét vào vòng realtime |
| [Depth Pro](https://github.com/apple/ml-depth-pro) | Metric depth và focal estimation; adapter hiện có | Reference offline; license Apple riêng, không gọi là MIT; chưa benchmark range xe |
| [Fast-FoundationStereo](https://github.com/NVlabs/Fast-FoundationStereo) | Hướng stereo CVPR 2026 đáng đối chiếu | Cần cặp ảnh đã rectified, intrinsics/baseline; LICENSE repo giới hạn nghiên cứu phi thương mại. Không chọn làm mặc định thương mại |

Đối chiếu kỹ thuật cho thấy các đường đo có kiểu hỏng khác nhau; đề xuất fusion là
phán đoán kiến trúc, chưa phải hiệu quả đã chứng minh. Hình học và learned depth có
thể cùng sai trên một ảnh, nên không cộng confidence như hai cảm biến độc lập.
Chỉ fuse khi tương thích; bất đồng lớn phải giảm chất lượng/abstain và ghi log.

## 5. Blueprint đề xuất — không ảnh hưởng các mode hiện hữu

```text
Video file / camera gắn cố định
  → frame clock + camera profile + undistort/resize transform
  → detector xe + vùng xe/mốc tiếp đất
  → tracker ID + ego/path association
  → hình học mặt đường ─┐
  → metric depth ───────┼→ range estimator + uncertainty + tuổi dữ liệu
  → IMU/tốc độ hợp lệ ──┘
  → khoảng hở + tốc độ tiến gần + nguy cơ theo quỹ đạo
  → bbox / badge / cảnh báo + nhật ký replay kiểm chứng
```

Module riêng `src/drive/`, mode DriveSense riêng. Tách runtime khỏi `main.ts` đang
lớn, không sửa nghĩa dữ liệu của các mode RoboHand/AirSketch/Depth cũ.

Data contract đề xuất cho mỗi track:
`frameId, captureTs, inferenceTs, trackId, class, bbox, calibrationId,
distanceKind, distanceM|null, interval|null, intervalCalibrated,
closingSpeed|null, ttc|null, pathRelation, quality, ageMs, reasons[]`.
Phân biệt score nhận diện, chất lượng tracking và uncertainty khoảng cách.
Interval chưa hiệu chuẩn không được gắn nhãn "95% tin cậy".

Luồng realtime: queue một frame mới nhất, bỏ frame cũ; capture theo video frame
callback; perception trong worker; render độc lập; quản lý ngân sách GPU, tắt
inference hand/depth không liên quan. Nội suy bbox là hỗ trợ hiển thị, không được
làm mới timestamp của phép đo hoặc tạo số đo range giả. Camera age khác inference
time; video encode/network từ dashcam cũng phải tính vào ngân sách.

Tầng triển khai:

1. Web hiện tại dùng cho replay/local benchmark, UI, calibration và prototype
   camera sau. File quay sẵn xử lý offline không có nghĩa cảnh báo trực tiếp.
2. Mobile native/edge là một quyết định tiếp theo nếu cần IMU/camera control,
   NPU/GPU và độ trễ bền vững. Không hứa WebGPU trên mọi điện thoại.
3. Camera hành trình: file MP4 khả thi trước. Live stream cần biết model và giao
   thức; RTSP có thể cần bridge cục bộ sang WebRTC, không thể mặc định getUserMedia
   đọc được. GitHub Pages chỉ host frontend, không chạy Python/CUDA backend.

Profile calibration: đúng camera/lens/resolution/crop, fx/fy/cx/cy, distortion,
chiều cao, pitch/roll và offset đến cản trước. Khi đổi camera, zoom/EIS crop,
độ phân giải hoặc vị trí gá: invalidate profile. IMU cần đồng bộ và extrinsics;
gia tốc kế đơn thuần khi xe tăng tốc không cho pitch chính xác tức thời.

## 6. Logic cảnh báo và failure modes

[NHTSA](https://www.nhtsa.gov/vehicle-safety/driver-assistance-technologies) mô tả FCW
dựa cả tốc độ xe mình, tốc độ xe trước và khoảng cách, không phải một ngưỡng mét
duy nhất. FCW cảnh báo, khác với hệ thống tự phanh.

Định nghĩa tính toán thử nghiệm:
- Closing speed `c = -d(gap)/dt` theo cùng track/hệ quy chiếu.
- `TTC = gap/c` chỉ có ý nghĩa mô hình vận tốc gần hằng khi c>0 và quỹ đạo xung đột.
  Không gọi TTC là thời điểm va chạm chắc chắn; không lấy đạo hàm raw depth nhiễu.
- Time headway `gap/v_ego` khi tốc độ xe mình hợp lệ; không dùng thay TTC và không
  tính khi tốc độ gần 0. Không tự suy tốc độ chính xác từ video thiếu scale.
- Lane/corridor association và cut-in prediction quan trọng hơn chỉ "box giữa ảnh".
  Nếu đường cong/không thấy làn, phải giảm chất lượng hoặc dùng corridor đã kiểm chứng.

UI đề xuất: bbox xanh lam = đang theo dõi (KHÔNG có nghĩa an toàn), vàng = chú ý,
đỏ = nguy cơ tăng theo policy đã kiểm định; xám/nét đứt = chưa đo tin cậy. Kèm chữ
và biểu tượng, không chỉ màu. Badge gắn cạnh trên: `Ô tô · ≈24 m` hoặc
`Ô tô · chưa đủ dữ liệu`. Chỉ hiển thị số trong phạm vi đã benchmark; không hai số
thập phân để tạo cảm giác chính xác. Ngưỡng cảnh báo chưa chốt từ nghiên cứu này.

Xe mới vượt vào hình: tạo track ngay khi đủ evidence; khoảng cách có thể unknown
nếu bị cắt/che, cập nhật khi đủ hình học. Cảnh báo provisional về cut-in phải được
phân biệt với khoảng cách đã xác nhận. Không đợi vô hạn để box "đẹp", cũng không
gán range của track cũ cho xe mới. Xe ngoài FOV hoàn toàn không thể được camera này
phát hiện; không quảng bá như cảnh báo điểm mù toàn xe.

Dữ liệu cũ/mất track/camera rung/thiếu calibration: chuyển degraded rõ ràng, không
âm thầm trở lại xanh "an toàn". Nếu đang có cảnh báo, chính sách hết hạn/giảm cấp
phải được test riêng, không giữ số cũ như số đo mới. Smoothing không được kéo dài
thời gian phát hiện phanh gấp. Ví dụ tự tính: closing speed 20 m/s và độ trễ 200 ms
đã làm mất 4 m khoảng hở; đây là lý do phải đo latency toàn chuỗi.

Không điều khiển phanh/lái. Prototype chỉ replay hoặc bãi thử có kiểm soát/người
quan sát riêng; người lái không thao tác hoặc nhìn màn hình để nghiệm thu khi lái.
Không thu video biển số/khuôn mặt lên cloud mặc định; bản chia sẻ phải có cơ chế
ẩn thông tin nhận dạng và sự đồng ý phù hợp.

## 7. Nghiệm thu: đo lỗi thay vì chấm cảm giác

ODD đầu tiên đề xuất: camera cố định đã hiệu chuẩn, ban ngày/khô, nhìn trước,
xe con/bus/truck, đoạn đường gần phẳng; range 5–50 m là PHẠM VI THỬ, không phải
khả năng đã chứng minh. Xe máy phải có bucket riêng nếu thêm vào scope; không
gộp vào chất lượng ô tô. Đêm/mưa/chói/góc rộng/cua/dốc là stress tests, chưa hỗ trợ
thì phải báo không đủ dữ liệu chứ không loại khỏi báo cáo.

Ground truth:
- Dừng xe tại bãi thử: đo khoảng hở ở các mốc 5/10/20/30/50 m, nhiều loại xe và góc,
  mốc đo đến bề mặt/cản xe phải nhất quán. Hiệu chuẩn và test khác mẫu.
- Động: radar/LiDAR tham chiếu đã hiệu chuẩn hoặc RTK hai xe với lever-arm/heading
  và đồng bộ thời gian; đánh giá uncertainty chính ground truth. GPS điện thoại
  không mặc định là chuẩn cho sai số nhỏ. Không tạo tình huống nguy hiểm để lấy dữ liệu.
- [KITTI](https://www.cvlibs.net/datasets/kitti/) có ground truth cảm biến và
  calibration hữu ích cho nghiên cứu; giấy phép NC-SA phải xem riêng. Dữ liệu
  nước ngoài không thay validation camera/đường Việt Nam. Chưa tải dataset.

Bộ chỉ số bắt buộc: MAE, signed bias, P50/P95 absolute/relative range error theo
bucket; coverage và abstention trên TOÀN tập; phát hiện xe/cut-in recall, ID switches,
thời gian mất bám; miss cảnh báo theo event, false alerts/giờ, thời điểm báo;
capture-to-overlay/range-age P50/P95/P99; RAM/nhiệt/pin trong phiên ít nhất 30 phút.
Tách train/validation/test theo chuyến và thiết bị, không rải frame cùng video vào
cả ba tập. Sai số khi xe trước phanh và khi tracker đổi ID là P0.

Mục tiêu thử nghiệm ĐỀ XUẤT, không phải cam kết an toàn: trong ODD, ít nhất 95% các
phép range được công bố có lỗi <= max(2 m, 20% ground truth), đồng thời coverage >=90%
trên mục tiêu đủ điều kiện đã định nghĩa trước. Capture-to-overlay P95 <=150 ms
trên thiết bị chỉ định, chạy liên tục 30 phút. Báo thêm mọi event sai nguy hiểm;
đạt các con số này vẫn KHÔNG đủ chứng minh sẵn sàng đường công cộng.
Ngưỡng FCW và tiêu chí missed/false alerts cần hazard analysis và tập event đủ lớn
trước khi cho phép pilot trực tiếp; không tự lấy một hằng số TTC làm tiêu chuẩn.

## 8. Task graph sau phê duyệt

| Giai đoạn | Phụ thuộc | Vai thợ giao gì | Gate chủ thầu |
|---|---|---|---|
| D1 — replay & ground truth | Chốt thiết bị/ODD/đại lượng đo | Video source, timestamp, camera profile, fixture manifest, report scaffold | Có dữ liệu đối chứng; không số mét giả |
| D2 — baseline detection/tracking | D1 | ID xe, bbox/badge không mirror, geometry baseline, unknown/stale | Replay cut-in, khuất, đổi ID; hình học được test |
| D3 — model bake-off & fusion | D1+D2 | DA2 metric nhỏ vs DA3 metric vs reference 2026; export parity; inference timing | Chọn theo Pareto accuracy/latency/license trên cùng test |
| D4 — risk policy/HUD | D3 | Closing speed, path/cut-in, degraded state, màu + chữ, audit events | Event-based false/miss/lead time; không safe-by-default |
| D5 — live pilot có kiểm soát | D4 + phê duyệt an toàn | Camera/IMU integration, thermal run, hardware-specific package | Ground truth động, phạm vi công bố, rollback, giới hạn rõ |

Chủ thầu duyệt output từng D; thợ mới thi công bước phụ thuộc. Không triển khai
đồng thời tất cả để rồi mất khả năng biết lỗi đến từ detection, range hay policy.
Nếu web không đạt ngân sách: đưa quyết định native/edge hoặc sensor lên chủ nhà,
không âm thầm tăng độ trễ hoặc giảm tiêu chí nghiệm thu.

## 9. Quyết định còn thiếu, không chặn nghiên cứu

1. Thiết bị đầu tiên: điện thoại model nào hay dashcam model nào, có live stream không?
2. Mục đích giai đoạn đầu: phân tích video/pilot nghiên cứu hay sản phẩm dùng khi lái?
3. Chấp nhận gá camera cố định và hiệu chuẩn? Có thể có cảm biến ground truth tại bãi thử?
4. Chỉ camera đơn là ràng buộc cứng, hay chấp nhận nhánh stereo/radar nếu cần độ chính xác?

Đề xuất mặc định để phê duyệt: **video replay trước, camera đơn cố định đã hiệu
chuẩn, local-first, không tự phanh, kiểm thử có ground truth; native/cảm biến bổ sung
là gate tiếp theo**. Chưa có dữ liệu thực tế để chọn model thắng hoặc hứa % chính xác.
