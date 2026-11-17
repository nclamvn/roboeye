# TIP-65 M3T: đối chứng nền tĩnh độc lập từ RGB-D và mocap

17/11/2026. Mac only. Vibecode Kit cá nhân v6.3: Contractor thiết kế/verify,
Builder dữ liệu, Builder phép kiểm và Reviewer không viết hai component.
Không iPhone, runtime warning, deploy, commit/push; bảo toàn mọi sửa đổi trước.

## Outcome và khoảng trống cần xử lý

M3S cho thấy25 cặp city bị pose veto dù residual ảnh held-out nhất quán.
Nhưng hai mô hình cùng khớp điểm ảnh không chứng minh các điểm ấy đúng vật tĩnh.
Đối chứng Boreas ở endpoint phép đo cũng thưa: chỉ1/24 vai trò nguồn thực có
nhãn3D đồng bộ,6 proxy khác chỉ là counterfactual. Không tiếp tục matcher hoặc
fit F/H rồi cho chúng quyền tự xác nhận camera.

M3T xây và chạy bộ kiểm camera/điểm bám độc lập bằng depth và mocap. Đầu ra
dùng được là phân tách: LK không trả điểm; LK lệch so tham chiếu độc lập;
tham chiếu thiếu/occluded/không chắc; hoặc mô hình camera không giải thích ảnh.
Không hứa đã giảm traffic FN hoặc sửa nguyên nhân vật lý Boreas trong bước này.

## Nguồn dữ liệu, quyền và ngân sách

Chỉ nguồn chính thức TUM RGB-D. Trang chính hiện ghi data CC BY4.0, code
BSD-2-Clause; bài báo cũ nóiCC BY3 không thay thế thông báo phát hành hiện tại.
Ghi nguồn tác giả, Sturm et al., IROS2012 và link; không nhập thêm code ngoài.
Không tài khoản, API trả phí, model/dependency mới, không dùng nuScenes.

Hai scene static đã chọn từ mô tả, trước RGB/điểm bám/kết quả:

- `freiburg3_structure_texture_far`: panel zig-zag có texture, có cấu trúc3D.
- `freiburg3_nostructure_texture_far`: mặt phẳng có texture, control degeneracy.

HEAD archive:520,806,553 +211,008,272 =731,814,825 bytes. Metadata GT đã nhận
322,099 bytes, không ảnh. Ngân sách toàn transfer850MiB, initialfetch600s,
0 retry mặc định. Stream gzip/tar, đọc đếnEOF để kiểm CRC/byte/hash; không lưu
archive hoặc giải nén toàn scene. Chỉ whitelist metadata và ảnh cần chọn,
không extractall/link/path traversal. State ảnh chọn≤80MiB; dừng có prefix nếu
vượt. Dung lượng trống56GiB, sàn10GiB; không copy dự án/venv/build dir mới.

Kế hoạch metadata seal trước archive GET trong
`docs/evidence/tip65/m3t-data-plan.json`.
3 window theo20/50/80% khoảng mocap, bắt đầu center−400ms làm tròn xuống100ms
từ timestamp đầu.9 nominal node offset[0,100,200,300,400,500,600,700,900]ms.
8 cặp/window: source j0..7, end+100ms nếu j chẵn, +200ms nếu lẻ.24 cặp/scene,
48 cặp tổng. RGB nearest nominal≤17.5ms, tie reject; không đổi mẫu vì ảnh khó,
GT thiếu, pose không đạt hoặc LK sai. RGB/depth mutual nearest≤20ms, nearest
mocap riêng ở mỗi RGB/depth time≤5ms. Không nội suy/extrapolate; thiếu vẫn giữ
pair trong mẫu số. Không chọn lại window theo baseline/độ quay thuận lợi.

## Hợp đồng nhỏ nhất

### Dữ liệu

Fetcher riêng + importer tạo manifest48pair, ảnh640x480 gốc, SHA mỗi file,
microsecond từ Decimal, pose optical-center camera→world, qx/qy/qz/qw, status
và signed skew riêng cho RGB/depth. Không đặt depth/GT vào lời gọi LK.
Pair count không giảm khi thiếu sensor. Archive/metadata/source bindings được
kiểm lại trước study; giữ prefix hợp lệ khi lỗi, tối đa1 repair thực thi có lý do.

### Phép đối chiếu

1. Chọn tối đa256 seed từ RGB nguồn theo goodFeatures frozen, quality.012,
   minDistance4; chạy LK xuôi/ngược và photometric cũ chỉ nhận RGB/mask. Giữ
   mọi seed, status/cycle/NCC/mask, seal trước khi mở reference depth/pose.
2. Reference riêng: depth PNG/5000 là optical Z,0 là missing, không phải
   Euclidean range. Pose depth ở timestamp thật dùng để lift/reproject/z-buffer
   về RGB timestamp tương ứng trước khi lấy depth tại seed. Không lấp hole,
   không dùng endpoint/cycle/NCC/LK success để lọc reference.
3. Mỗi seed có reason: source hole/outside/range/nonpositiveZ, pose unavailable,
   current depth unknown/mismatch/occluded, hoặc visible-reference. Phân biệt
   pixel kỳ vọng độc lập với endpoint LK; giữ định lượng lỗi lẫn reference thiếu.
4. Hai K profile đã khóa, không chọn tốt hơn: primary FR3 fx535.4/fy539.2/
   cx320.1/cy247.6; sensitivity ROS default525/525/319.5/239.5. FR3 đã undistort,
   không rectification lần nữa; depth scale đã hiệu chỉnh, không nhân ds tiếp.
   Cùng LK result duy nhất cho hai profile; counts không trộn. Nếu kết luận đổi
   theo profile thì ghi calibration ambiguity, không quy ngay lỗi cho LK.
5. Tham chiếu depth+mocap là sensor-derived approximation, không pixelGT tuyệt
   đối. Sensitivity envelope, không confidence interval: depth±max(.01m,.01Z²),
   pose translation±.01m/axis, rotation±.10deg/axis, pixel sampling±.5px; time
   offset ghi riêng, không giả vờ envelope này bao mọi sai số đồng bộ/occlusion.
   EPE ngoài envelope không tự động là match sai vật lý.

Giữ endpoint-error p50/p95, tỉ lệ lỗi>1/2/5px mô tả, LK không trả điểm trên
reference visible, missing reference và occluded riêng; đây là metric
correspondence, không đổi tên thành traffic approach FP/FN. Camera pose model
cũ kiểm độc lập; không nới cổng để bù noisy reference. Nguồn pose sai đã biết
qua control cần được phân biệt với missing pose.

### Phép kiểm bác bỏ

Control cố định trước study: yaw current+1deg; pose timestamp+40ms; fx×1.05;
LK endpoint+(10,10)px. Có thể reject khi vi phạm hợp đồng hoặc làm sai số tăng;
không bắt mọi pixel phải đổi nhãn. Không chọn độ nhiễu tốt nhất sau kết quả.
Chạy geometry tự soạn trước data: Z/range, quaternion order/inverse, async
static-plane warp, z-buffer/occlusion/hole, thiếu/malformed SHA/clock, gold
không đổi khi endpoint LK bị thay, K không chọn bằng score.

## Giới hạn thực thi / acceptance

Study một run≤600s, receipt≤32MiB,48 pair đủ denominators và hai calibration
profile tách biệt; không chứa ảnh/depth array/denseflow lặp trong receipt.
Chỉ CPU trong môi trường có sẵn; zero learned inference nhưng ghi công LK và
reprojection thực. Freeze source/test trước study, Reviewer kiểm GO; lỗi giữ
prefix/counters, không chạy lại vì kết quả không đẹp.

AC tool:48 pairs nguồn được seal; RGB branch không đọc depth/GT; reference có
own timestamp và uncertainty; negative controls/metrics thực; provenance và
code trước/sau nguyên vẹn; tests cần thiết đạt. Không cần ép một tỉ lệ 'pass'
road-quality từ một tập static trong nhà nhỏ. Không so tốc độ với pipeline
M3R452s vì nhiệm vụ khác. Baseline LLM/agent trực tiếp chưa đo, không claim hơn.

M3T không trực tiếp cấp quyền dùng estimator mới, không đo range người dùng,
không cảnh báo mới, không giữ cảnh báo qua veto. M3R12 FN không đổi. Nếu gold
không đủ chắc hoặc tool cho thấy calibration/timing chưa đúng, dừng ở kết quả
chưa chứng minh; không thử thêm model hay sửa từng clip để tạo TP.

## Nguồn chính thức đã đối chiếu

- https://cvg.cit.tum.de/data/datasets/rgbd-dataset (License, CC BY4.0)
- https://cvg.cit.tum.de/data/datasets/rgbd-dataset/file_formats
- https://cvg.cit.tum.de/data/datasets/rgbd-dataset/download (hai scene static)

## Completion / Verify

Đã hoàn tất công cụ, tải chọn lọc, một lượt study thực và kiểm độc lập.
Không thay runtime sản phẩm. Kết quả không phải chứng nhận an toàn hoặc
nghiệm thu nhận biết vật tiến gần.

### Phạm vi thực thi và chi phí

- Hai scene TUM trong nhà, 48 cặp, 54 RGB và 54 depth. Giữ nguyên mẫu số
  khi pose/depth thiếu. Contractor kiểm SHA toàn bộ 114 file giữ lại và xem
  6 ảnh nguồn; Reviewer kiểm độc lập cả SHA, 54 RGB pixel hash và 48 seal.
- Tổng network 732,459,023 byte, gồm lượt metadata preflight và metadata
  tải lại trong fetch. Giữ 30,260,243 byte, không lưu archive, không retry.
- Fetch 73.708 giây. Study một lượt 10.289 giây: 48 RGB correspondence pass,
  46 pass của camera guard cũ, 188 lời gọi LK xuôi/ngược, 96 lượt đánh giá
  reference profile và 180 depth reprojection. Không gọi detector, model học
  hay LLM. Không so tốc độ với pipeline nhận diện đầy đủ.
- OpenCV được yêu cầu 1 thread nhưng báo 10; số worker thực chưa đo. Timing
  trên chỉ là quan sát của lượt chạy, không benchmark single-thread/realtime.
- Không dependency, venv, project copy hoặc build directory mới. Còn khoảng
  56 GiB. Fixture tạm tự dọn; giữ slice, receipt và QA plates để tái kiểm.

### Kết quả định lượng

Primary FR3 có 12,225 seed: 9,303 có reference gần đúng và khả kiến,
9,052 có LK endpoint được chấp nhận, 251 điểm khả kiến không được LK chấp
nhận. 2,922 seed còn lại có reason riêng, không đổi thành kết quả đúng.
Trên cùng 9,052 điểm, EPE trung vị 2.19 px, p95 4.39 px. Profile ROS phụ
có 9,046 điểm tương ứng, EPE 2.12/4.29 px; không chọn profile tốt hơn để báo.

Guard cũ: 13 cặp valid, 33 thiếu đồng thuận nền, 2 thiếu RGB pose hợp lệ.
Cả 10 cặp rơi vào fallback gần-chỉ-xoay đều bị veto. Baseline chỉ khoảng
1.18–2.45 cm nhưng reference vẫn dự đoán parallax sau bỏ rotation: trung vị
gộp 4.11 px, p95 7.04 px; 2,219/2,220 điểm vượt mức 1.3 px đang khóa.
Đây là bằng chứng có điều kiện theo depth/mocap cho thấy dịch chuyển nhỏ
theo mét không đồng nghĩa tác động nhỏ theo pixel. Chưa giải thích hết
33 veto, chưa chứng minh nguyên nhân của mọi traffic FN trước đó.

Phép bác bỏ cũng phát hiện giới hạn của công cụ: sensitivity radius trung vị
35.77 px, p95 44.79 px. Khi cố ý cộng endpoint (10,10) px, 9,049/9,052 điểm
vẫn nằm trong radius. Vì thế không dùng “nằm trong sai số” làm chứng nhận
match đúng, không gọi hai điểm ngoài radius là chỉ có hai match sai.
Hai outlier khoảng 40 px có dấu hiệu trượt dọc mép poster dù cycle và NCC
tốt; Contractor và Reviewer đã xem QA plates. Đây là suy luận thị giác,
không phải ground truth vật liệu mới.

### QA, sửa lỗi tích hợp và quyết định

Lượt full gate đầu ghi 641 Python test OK nhưng bị collector từ chối đúng
vì JSON fixture lọt ra sau dòng OK. Chỉ sửa test để thu stdout và đặt tên
thư mục tạm có ngày; không sửa importer, study, parser, timeout hay ngưỡng.
Giữ nguyên biên bản fail. Lượt gate thứ hai: 641 Python, 121 Swift, 14 Node
đạt, TypeScript đạt, 189 source file có fingerprint trước/sau giống nhau.
21 test M3T nằm trong tổng Python, không cộng lại thành test mới.

Reviewer không viết hai component đã tính lại số liệu, kiểm negative control
trên cùng mask và kiểm hash điểm M3R cũ không đổi. M3R vẫn 12 FN, chưa có
traffic A/B mới. Baseline LLM/agent trực tiếp, điện thoại, độ trễ đầu-cuối,
chất lượng giọng đọc và độ chính xác range đều chưa được chứng minh ở M3T.

Bước đúng tiếp theo: phát triển camera-motion model chọn theo tác động pixel
và khả năng quan sát, thay giả định baseline nhỏ là chỉ xoay. Phải kiểm trên
control độc lập mới và traffic A/B, giữ ngưỡng chất lượng; không dùng F/H
tự fit hoặc sensitivity radius hiện tại để tự cấp quyền cảnh báo. Thiếu
bằng chứng vẫn abstain. Không suy ra mét, không promote/deploy bản này.

Receipt gốc: `native/ios/.build-xcode/scene-qa/m3t-static-controls-r1.json`.
Kết quả gọn và bindings: `docs/evidence/tip65/m3t-verification.json`.
Kiểm độc lập: `docs/evidence/tip65/m3t-independent-verification.json`.
Full gate đạt: `docs/evidence/tip65/mac-readiness/runs/2026-11-17T10-28-10-967Z-7e52dde6/summary.json`.
