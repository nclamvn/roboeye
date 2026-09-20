# Điều tra lỗi đảo thứ tự khoảng cách giữa các làn — 17/09/2026

## Kết luận

Ảnh kiểm tra cho thấy đây là lỗi **metric depth/validation**, không phải lỗi detector: ba bounding box bám đúng ba xe, nhưng xe trái được gán ≈70 m trong khi xe phải được gán ≈56 m dù người thử xác nhận xe trái gần hơn. Hai cue ảnh độc lập cũng cùng hướng: đáy box xe trái thấp hơn và box cao hơn xe phải. Bản cũ không kiểm cặp này vì gate phối cảnh chỉ so các box chồng theo trục X.

Không thể kết luận 70 m hay 56 m là giá trị thật chỉ từ ảnh chụp UI. Việc hợp lý ngay lập tức là phát hiện mâu thuẫn và trả về `unknown`, không tráo hai số hoặc làm trơn một lỗi có hệ thống.

## Phân tích nguyên nhân

### 1. Giới hạn mô hình

Primary hiện tại là Depth Anything V2 Metric Outdoor Small, fine-tune metric bằng dữ liệu Virtual KITTI và giới hạn cấu hình 80 m. Đây là metric-depth học từ phân bố dữ liệu, không phải phép đo hình học đã biết camera. Xe nhỏ ở xa, khác làn, cầu vượt/nền và domain camera thực có thể làm scale hoặc thứ tự cục bộ sai. Giá trị 70 m còn nằm gần trần 80 m của checkpoint nên không nên được hiểu là độ chính xác tốt chỉ vì có đơn vị mét.

### 2. Mất thông tin do pipeline hiện tại

- Depth map chỉ 392×224; mỗi xe xa còn ít pixel.
- Adapter lấy thống kê vùng lõi từng box độc lập. Nó loại đường sát đáy để tránh contamination nhưng vì vậy cũng không dùng trực tiếp ground-contact geometry.
- Detector không có instance mask/contact-point; box có thể chứa kính, nền, khe giữa xe và bóng.
- Không có profile camera trong phiên này nên cue ray–ground chưa được dùng.
- Gate cũ chỉ phát hiện depth nén cho các xe gần như thẳng hàng và chồng X; xe hai làn không chồng X nên thoát gate.

### 3. Thiếu fusion, không chỉ thiếu dataset

GVDepth cho thấy bài toán ground vehicle cần hai cue — kích thước ảnh và vị trí dọc của điểm tiếp xúc mặt đường — rồi fusion theo uncertainty. MonoGround cũng dùng ground plane như một điều kiện hình học và một nguồn depth bổ sung. Metric3D/UniDepth/MoGe đi theo hướng disentangle/recover camera geometry tốt hơn một checkpoint chỉ học scale outdoor. Vì vậy lỗi này là tổ hợp của **domain/model + độ phân giải + ROI + thiếu cue hình học/uncertainty**; chỉ thêm smoothing hoặc thêm frame không sửa được thứ tự sai ổn định.

## Biện pháp đã triển khai — TIP-49L-C

1. Thêm ordinal-consistency gate cho xe cùng lớp, confidence mạnh, không cắt biên.
2. Dùng đáy box/điểm tiếp xúc mặt đường làm cue chính; chiều cao box chỉ phủ quyết khi mâu thuẫn mạnh, không còn bắt buộc phải lớn hơn.
3. Nếu learned metric đảo thứ tự ít nhất 3 m và 6%, cả hai số bị loại với lý do rõ ràng.
4. Không swap, không average, không sinh số hiệu chỉnh.
5. Offline replay và camera live dùng chung validator/policy v6 ở cả pre-filter và publication boundary.
6. Bốn regression fixture lấy tỷ lệ trực tiếp từ ảnh kiểm thử: `70/56`, `57/52`, `51/45` và post-filter `51/43` phải bị chặn; thứ tự đúng `56/70` phải đi qua.

### Retest 10:16 — vì sao policy v3 chưa đạt

Ảnh thứ hai có đáy box trái thấp hơn khoảng 10 px nhưng hai box gần như bằng chiều cao. Policy v3 bắt buộc chiều cao xe gần phải lớn hơn 6%, đồng thời yêu cầu đảo metric ít nhất 12%; vì vậy `57/52` lọt qua cả hai điều kiện. Đây là lỗi thiết kế validation, không phải bằng chứng model đã đúng. Policy v4 xem ground-contact là cue hình học chính, coi kích thước gần bằng nhau là trung tính và giảm ngưỡng đảo số xuống 3 m/6%. Một khác biệt chiều cao mạnh theo hướng ngược vẫn chặn suy luận để tránh lạm dụng giả thiết đường phẳng/camera không roll.

### Retest 10:21 — vì sao policy v4 vẫn chưa đạt

Ảnh thứ ba thỏa toàn bộ ngưỡng hình học và chênh metric của v4 nhưng vẫn hiện `51/45`. Điều kiện còn lại là `a.label === b.label`: validator dùng raw subclass trong khi detector chạy ba lớp cạnh tranh `car`/`truck`/`bus`, còn tracker đã chủ động chịu được subclass flicker. Regression gán hai SUV thành `car` và `truck` tái hiện đúng lỗi. Policy v5 thống nhất định nghĩa với candidate/tracker và áp dụng ground-contact trên toàn họ phương tiện; label ngoài họ xe vẫn không tham gia.

### Retest 10:25 — vì sao policy v5 vẫn chưa bảo vệ UI

Policy v5 chỉ kiểm depth thô trước tracker. UI lại hiển thị `RangeFilter`/Kalman sau khi từng track đã được làm mượt độc lập, và replay còn nội suy box nhưng giữ range của sample trước. Vì vậy thứ tự sai có thể được tái tạo **sau** nơi validation chạy. Regression mới dựng trực tiếp final tracks `51/43`; trước v6 nó đỏ đúng như ảnh. Policy v6 thêm publication guard trên chính box/range gửi tới HUD và risk, đồng thời xóa closing speed/range TTC khi số mét bị loại. Phép đo hình học có profile được giữ nguyên; guard này chỉ tác động `learned_optical_axis_z_m`.

Thay đổi này làm tăng **precision của số được công bố** nhưng có thể giảm coverage. Nó chưa chứng minh MAE/P95 tốt hơn vì chưa có ground truth vật lý.

## Lộ trình nâng accuracy thật sự

### P0 — ngay trong codebase

- Ghi bộ đếm/range reason theo từng loại abstention và báo coverage, không chỉ sai số trên số còn lại.
- Chạy lại hai video hiện có; đánh dấu thủ công các cặp ordinal rõ và đo tỷ lệ inversion trước/sau.
- Dùng MoGe-2 Small đã có adapter/browser benchmark làm challenger offline trên cùng frame; không tải nó vào hot path mặc định trước khi A/B.

### P1 — không cần mua phần cứng

- Wizard profile video: FoV/intrinsics nháp, camera height/pitch khi biết, đường horizon/roll và mốc holdout.
- Ước lượng tire/contact anchor hoặc road mask thay đáy bounding box thô.
- So DA2 với MoGe-2 và Metric3D trên cùng crop/track; báo raw metric không scale-align theo test.
- Kết hợp `z_model` và `z_ground`: đồng thuận thì công bố, mâu thuẫn thì abstain; chỉ inverse-variance fusion sau khi uncertainty được hiệu chuẩn trên holdout.

### P2 — sau khi ảnh đơn đúng

- Thử Video Depth Anything/temporal student để giảm flicker. Temporal consistency không thay thế correctness: một chuỗi sai ổn định vẫn là sai.
- Thu corpus tĩnh có mốc 5/10/15/20/30/40/50/70 m, tách theo camera/chuyến đi; báo MAE, bias, P95, inversion rate và coverage theo dải.

## Nguồn đã đóng băng và kiểm độc lập

Registry nghiên cứu hiện có 39 claim/20 thực thể, snapshot + SHA-256, auditor idempotent PASS và bite suite PASS.

- [Depth Anything V2 metric depth](https://github.com/DepthAnything/Depth-Anything-V2/tree/main/metric_depth) — outdoor metric fine-tune và max-depth contract.
- [GVDepth — ICCV 2025](https://openaccess.thecvf.com/content/ICCV2025/papers/Koledic_GVDepth_Zero-Shot_Monocular_Depth_Estimation_for_Ground_Vehicles_based_on_ICCV_2025_paper.pdf) — vertical ground-contact cue, size cue và uncertainty fusion.
- [MonoGround — CVPR 2022](https://openaccess.thecvf.com/content/CVPR2022/html/Qin_MonoGround_Detecting_Monocular_3D_Objects_From_the_Ground_CVPR_2022_paper.html) — ground plane như điều kiện bổ sung cho mapping monocular ill-posed.
- [Metric3D](https://github.com/YvanYin/Metric3D) — canonical camera transform.
- [MoGe-2](https://github.com/microsoft/MoGe) và [ONNX contract](https://github.com/microsoft/MoGe/blob/main/docs/onnx.md) — point/depth/normal/FoV; ONNX cần hậu xử lý hình học riêng.
- [Video Depth Anything — CVPR 2025](https://openaccess.thecvf.com/content/CVPR2025/papers/Chen_Video_Depth_Anything_Consistent_Depth_Estimation_for_Super-Long_Videos_CVPR_2025_paper.pdf) — temporal consistency sau khi static-depth foundation đã đúng phạm vi.
