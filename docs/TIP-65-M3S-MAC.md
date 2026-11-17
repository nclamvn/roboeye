# TIP-65 M3S: kiểm toán mô hình camera và khả năng quan sát tiến gần

17/11/2026. Vibecode Kit cá nhân v6.3. Mac, không iPhone, không commit/push/
deploy. Bảo toàn toàn bộ sửa đổi sẵn có; M3R và các phép đo/score đã khóa là
baseline bất biến. Contractor thiết kế/kiểm chứng; Builder camera và Builder
reference geometry riêng. Reviewer khác tác giả kiểm tra đầu ra trước kết luận.

## Mục tiêu và lý do đổi bước

Người dùng yêu cầu tiếp tục sau M3R. M3R chưa sửa được recall: A/B cùng0 TP,
12 FN,0 FP,28 TN,4 unknown; B thêm1 cảnh báo ngoài khung đối chứng. Phân loại
đầu tiên:5 thiếu khung đo nguồn,3 không nối được danh tính nguồn,3 phép đo bị
từ chối,1 detection/handle thiếu. Không tiếp tục RootSIFT hoặc matcher.

Điều tra giới hạn trước triển khai mới, trên dữ liệu phát triển M3R đã xem:

- Veto camera xảy ra dù metadata pose hợp lệ và đủ điểm ảnh nền.18 cặp ảnh
  kiểm lại tái tạo đúng support cũ. city35:245 cặp photometric, pose support
  .036735, median residual3.937px; F fit trên chính điểm đó support.9918,
  median.064px tại tiêu chí1.8px. Đây là fit in-sample, không phải camera đúng.
- Camera CSV có precision cao, đúng timestamp. Thử dịch pose±2 frame không
  có một offset sửa nhất quán. Chưa xác định nguyên nhân vật lý; không tự gọi
  là rolling shutter, bad pose hoặc lỗi đơn vị.
- `_background` hiện chỉ giữ số tổng, bỏ điểm và residual. Veto tiếp tục reset
  cả ID lẫn bank đo, nên một lần mất chứng cứ tạo khoảng đói khung nguồn.
- Nhãn đối chứng dùng giảm khoảng cách tâm3D Euclidean; runtime đo diện tích
  ảnh affine sau bù quay. Hai đại lượng không tương đương cho mọi đường đi/
  mặt vật. Đó không chỉ là vấn đề threshold. Không đổi nhãn để làm đẹp recall.

M3S hoàn thiện công cụ kiểm chứng nguyên nhân, không vội đưa một camera model
fit cùng dữ liệu thành thẩm quyền mới để phát cảnh báo. Outcome là biết khung/
cặp nào có nguồn, điểm nào mâu thuẫn với pose, và đại lượng nào phép đo ảnh
thực sự quan sát được. Chưa phải sửa xong tính năng tiến gần.

## Hai lát cắt triển khai nhỏ, không đổi runtime

### 1. Camera evidence, toàn bộ147 cặp liền kề

Nguồn M3R150 ảnh gốc, working JPEG tái tạo theo đúng staging cũ và kiểm SHA.
Giữ cả seed nguồn, trạng thái LK xuôi/ngược, chu kỳ, mask, photometric, điểm
sống/còn lại, residual epipolar theo pose và mọi mẫu rớt. Không chỉ xuất một
mean hoặc bỏ mẫu khó khỏi mẫu số. So q tái tạo với receipt cũ.

Chẩn đoán F/H dùng hai fold ô ảnh4x3 checkerboard cố định: train chỉ dùng ô
một màu, test ô màu kia rồi đổi vai. RANSAC cùng ngưỡng1.8px, confidence.99,
maxIters1000, RNG định trước. Giữ counts/fold/mẫu thiếu/tất cả residual; không
chọn fold có lợi hay tìm threshold. F/H diagnostic không phải bằng chứng pose
thật, không khẳng định static từ epipolar agreement, không phát hiện tiếp cận.
Ảnh phẳng/ít thị sai/vật động/lặp texture vẫn có thể đánh lừa mô hình fit ảnh.

Thêm inventory metadata khung nguồn có giới hạn69 exposure/800ms, phân biệt
ảnh nguồn còn tồn tại với certificate đủ điều kiện. Soft image-consensus veto
không làm mất bản ghi nguồn; nhưng bản ghi giữ lại tuyệt đối không cấp phép
nối qua veto, mượn tuổi hoặc coast cảnh báo. Clock, duplicate, hình học, pose
stream/epoch hoặc calibration sai làm clear inventory. Không giữ thêm buffer
ảnh native đầy đủ, không thay GlobalWindow/T hay code iPhone.

### 2. Reference-only observability, đủ12 ca dương M3R

Giữ nguyên12 FN. Mỗi ca đối chiếu khung fresh/anchor thực; không có nguồn
thì ghi không có phép đo thực. Tham chiếu3D/pose chỉ trong công cụ offline,
không chảy vào runtime hoặc số mét hiển thị.

Đối chiếu giảm khoảng cách tâm3D, Z dọc trục và affine/độ mở góc của cùng
đỉnh cuboid được đánh chỉ số. Chỉ dùng endpoint đồng bộ theo quy tắc mutual
60ms có sẵn; không tự nội suy pose vật thể. Nếu cần mốc~600ms thay anchor
thiếu, ghi rõ counterfactual reference geometry, không phải cặp đã thực thi.
Đỉnh cuboid bị che khuất không là texture thật và không xác nhận phép đo ảnh.
Nêu mọi thiếu đồng bộ, clipping, góc nhìn/mặt vật thay đổi và phép fit bất ổn.

Test hình học tự soạn gồm: tiến gần theo trục; giảm r do đi ngang trong khi Z
không đổi; r không đổi nhưng ảnh lớn lên; quay camera; quay vật. Không dùng
test tự soạn như bằng chứng chất lượng trên đường thật.

## Bất biến và điểm dừng

- Không nới quality floors hiện có, không range/TTC/motion inference mới,
  không chấp nhận F/H in-sample thay pose guard, không giữ cảnh báo qua lỗi.
- Không gọi model, API trả phí, tải dataset/model/dependency; dùng dữ liệu và
  môi trường có sẵn. Đã đối chiếu convention với official pyboreas thay vì
  thử đổi transpose/yaw-sign theo kết quả ảnh.
- Mọi kết quả M3S trên M3R là posthoc development diagnostics. Spatial heldout
  points không biến clip đã xem thành clip mới. Không kết luận FP/FN tốt hơn.
- Camera một run147 cặp≤300s, receipt≤16MiB. Reference một run12 ca≤300s,
  receipt≤5MiB. Một repair thực thi có lý do nếu cần; giữ prefix/counters và
  công bố failure, không xóa bằng chứng hay chạy lại để lấy score đẹp.
- Khóa mã/test trước full run. Bộ staging tạm tên codex-tmp-m3s-YYYYMMDD nằm
  trong vùng QA nếu cần, tự xóa. Bản thực thi dùng encode/decode JPEG trong
  bộ nhớ, không tạo staging file. Kiểm dung lượng trước run; hiện56GiB, sàn10GiB.
- Sau khi kiểm chứng, chọn một phương án camera/source có phép kiểm bác bỏ
  độc lập, hoặc báo chưa xác định. Không mở thêm vòng model/benchmark mặc định.

## Đối chứng và verification

Baseline là actual M3R: receipt SHA
7d2922b2cfbd0819f342361b17108b3308cbba936a0a267785dcc4731abd7b52,
input b608bf1ae8518c61aea3a037ac608f2ce48265f7374f0ed0c37c67e619d5c108,
truth7e9ddf11518d7365059e52b060889bf99616897a31e702f325f51a60f58cc284.
So LLM/agent trực tiếp chưa đo, không có claim hơn model hay thương mại.
Chi phí/time/user outcome của công cụ audit tách khỏi inference sản phẩm.

Contractor kiểm output nguồn, model/GT không đổi, counter147/12, false claim
và bảng metric. Reviewer không phải tác giả kiểm các công thức, phản ví dụ,
denominator, split train/test và mẫu nguồn. Chạy scoped tests; full regression
khi source collector thay đổi. Không cộng số test của M3R làm test mới M3S.

Nguồn chính thức đã đọc:
- https://github.com/utiasASRL/pyboreas/blob/master/pyboreas/utils/utils.py
- https://github.com/utiasASRL/pyboreas/blob/master/pyboreas/data/sensors.py
- https://github.com/utiasASRL/pyboreas/blob/master/README.md

## Completion / Verify

### Outcome và disposition

Hai công cụ audit đã triển khai và chạy đủ phạm vi, không gọi model học máy,
không sửa runtime, không phát thêm cảnh báo. READY trong phạm vi công cụ chẩn
đoán đã kiểm; tính năng tiến gần vẫn NOT READY. M3R vẫn0 TP/12 FN/0 FP/28 TN,
4 unknown và1 cảnh báo ngoài khung chấm; không chạy lại trial mới hoặc đổi nhãn
để nhận đây là cải thiện recall. Cause vật lý của sai lệch pose/ảnh còn UNKNOWN.

Tệp mới:

- `scripts/assist_scene_m3s_camera_audit.py` và test tương ứng: điểm nền, lỗi
  từng bước, split train/test và inventory metadata không có quyền phát cảnh báo.
- `scripts/assist_scene_m3s_observability.py` và test tương ứng: kiểm toán khả
  năng quan sát, giữ riêng radial closing và optical expansion.
- `docs/evidence/tip65/m3s-observability.json`: kết quả reference thực.
- `docs/evidence/tip65/m3s-independent-verification.json`: QA khác tác giả.
- `docs/evidence/tip65/m3s-verification.json`: bản ghi Contractor cuối.

### Camera: kết quả thực, không phải camera model mới

Một run24.586 giây,147/147 cặp,12,302,741 bytes dưới16MiB. Tái tạo chính xác
147 số tổng background cũ từ150 ảnh gốc và working JPEG có cùng SHA. Có37,632
seed nguồn;37,351 qua LK,36,769 qua photometric,35,633 còn trong control nền.
Giữ cả mẫu rớt, không thu nhỏ mẫu số để tạo tỷ lệ đẹp.

Camera guard cũ cho119 cặp hợp lệ,28 veto. Riêng city24/49 hợp lệ,25 veto;
hai clip gần đứng yên49/49 và46/49.588 lần fit hình học F/H thực, không phải
0 tính toán;0 detector/RAFT/LLM inference mới. Source và policy không thay đổi
trong run, không phải chạy lại vì lỗi.

Phân tích ban đầu mỗi half-fold giữ nguyên floor5 ô/12 ô của ảnh đầy đủ sẽ
tự hạn chế coverage: cả hai fold cùng đạt chỉ F7 cặp/H1 cặp. Không diễn giải
điều này là residual ảnh hỏng. Reviewer hậu kiểm thêm một phép tổng hợp OOF
từ chính residual đã khóa: hai tập test phải rời nhau và hợp lại đủ mọi điểm,
không fit lại model/không đổi ngưỡng. Trên full population, F142/147, H144/147
đạt các floor count/support/cell/span. Đây là phân tích phát sinh sau run,
không phải ablation đã đăng ký trước hoặc một camera vật lý duy nhất.

Quan trọng nhất:25 cặp city bị pose veto tại1.8px vẫn có residual ảnh nhất
quán trên điểm không tham gia fit, tại cùng tiêu chí số1.8px. Điều này củng cố
hướng kiểm camera/ảnh, không xác định pose vật lý đúng hoặc thế giới tĩnh.
98 cặp near-rotation dùng cổng cũ1.3px, không so như cùng threshold với F/H
1.8px; residual epipolar F và transfer H cũng khác đại lượng. Không đưa các
kết quả này vào camera authority hay tính thành phát hiện tiến gần.

Raw metadata giữ đủ150 exposure, bank tối đa11 exposure trong800ms. Bản ghi
`certificateReady` chỉ nói camera status hiện tại valid, không là cảnh báo đã
đủ chứng cứ. Mọi `motionAuthorized=false`,0 phép đo mới được cấp quyền,
0 cảnh báo nối qua veto. Đây là tách tồn tại nguồn khỏi đủ chứng cứ, không
giữ thông số cảnh báo cũ hay kéo dài tuổi đo.

### Reference: điều biết được và điều không thể kết luận

Một run2.108 giây,41,863 bytes, đủ12 mục dương duy nhất.24 vai trò nguồn thực:
9 không có source đã thực thi,14 không có nhãn đồng bộ trực tiếp, chỉ1 có
proxy hình học.6 proxy khác được tạo từ mốc~600ms đã định trước, ghi rõ là
counterfactual, không phải phép đo từng thực thi. Không nội suy vật thể.

7 proxy này bao phủ7 ca city và đều cho cả radial closing lẫn optical growth
dương: radial log ratio.0749–.1636, affine lower.1083–.3078. Do đó chưa có
bằng chứng bất tương đương radial/optical là nguyên nhân bỏ sót7 ca này.5 ca
low-speed vẫn thiếu reference cặp nguồn; không gán nguyên nhân hình học cho
chúng. Cả7 phép fit toàn cuboid có residual2.639–18.473px; đỉnh hộp gồm mặt
bị che và không phải texture thật, nên cũng không dùng đó để kết luận phép
đo texture hiện tại đúng/sai.2 proxy clipping,7 thay trục hộp world, skew
endpoint.358–37.203ms, không đổi kích thước annotation. Chỉ4 vật thể lặp lại
trong7 target-keyframe, không nhận là7 đối tượng độc lập.

Test tự soạn xác nhận giới hạn toán học tổng quát: có thể giảm radial range
20% mà ảnh không lớn lên; có thể ảnh lớn25% trong khi radial range không đổi.
Đây là phản ví dụ cho claim sản phẩm quá rộng, không phải lời giải thích đã
chứng minh trên mọi ca lỗi thật hoặc lý do xóa các FN.

### QA và chi phí

13 test M3S khác tác giả chạy lại đạt; chúng nằm trong620 Python của gate cuối,
không cộng thành test chất lượng mới. Gate
`node scripts/qa-assist-scene-mac.mjs --typecheck` đạt620 Python/121 Swift/
14 Node policy/TypeScript. Python132.791 giây, timeout180 giây giữ nguyên.
Không lỗi/skip/retry.184 source file trước/sau trùng fingerprint
`f0380496ad65468571fa9403d644c30f3f42ecbe308d3da5af3d4256d36d808c`.
Receipt:
`docs/evidence/tip65/mac-readiness/runs/2026-11-17T09-43-20-818Z-4d2cac4c/summary.json`.

Reviewer không viết hai component đã kiểm toàn588 residual/split và294 dòng
OOF pooled, giữ đủ mọi mẫu số. Contractor kiểm mã, nguồn và report; không gọi
đây là chứng nhận thực địa/human ground truth. Đây là posthoc development trên
clip M3R đã xem, không phải holdout mới. Chưa đo lợi thế với LLM/agent trực tiếp.
Không phí API thực thi audit/dependency/model mới; tổng công phát triển/AI
assistant không được gán0. Không có UI hoặc realtime improvement được đo.

Không tạo project copy/venv/build directory/staging file mới; không xóa dữ
liệu, không sửa native/package có sẵn. Giữ receipt camera12.3MB làm bằng chứng,
không phải rác tạm; vẫn56GiB trống. Không commit/push/deploy.

### Quyết định tiếp theo

Không đổi thẩm quyền sang F/H vừa fit, không nới cổng camera, không thêm
tracker. Cần bộ control nền tĩnh có đối chứng độc lập, đủ nhãn tại endpoint
thật, để tách điểm bám nhầm khỏi mô hình/đồng bộ camera sai. Sau đó mới thử
camera estimator/cơ chế hợp nhất nguồn có kiểm che khuất, degeneracy, zoom và
độ liên tục thời gian, rồi A/B cảnh báo trên clip mới.7 proxy city cho thấy
cơ hội optical growth vẫn tồn tại, nên không dùng giới hạn lý thuyết để né
vấn đề nguồn/camera/pixel đang quan sát được. Chưa triển khai estimator đó ở M3S.
