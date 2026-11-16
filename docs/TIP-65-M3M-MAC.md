# TIP-65 M3M: correspondence toàn khung, không giới hạn cặp ROI

16/11/2026. Contractor: Vibecode Kit v6.3. Mac M1 Max, 32 GiB.
TIP ghi trước xem RGB mới và trước inference. Chưa cần iPhone.

## Outcome, đối chứng và giới hạn

Người dùng cần xử lý cảnh nhiều vật, đo cả báo nhầm và bỏ sót trên clip mới.
M3L direct-ROI không có TP trong 13 checkpoint dương tính; 9 checkpoint bị
giới hạn competitor ba vật chặn trước phép đo. Không kết luận rằng pixels
không thể đo, cũng không tăng cap để che vấn đề O(n²).

Thay đổi: mỗi cặp thời điểm tính một trường correspondence toàn ảnh hai
chiều. Mọi vật dùng chung trường này để đối chiếu, không chạy model cho
từng cặp ROI. Hai origin thật (liền trước và anchor 320–800 ms) cho tối đa
bốn direction model calls mỗi frame, độc lập số vật. Giữ ngân sách detector
tối đa 12 vật, ảnh làm việc tối đa 768 px, RAFT xử lý toàn khung tối đa
640 px. Đây không phải native-resolution flow hoặc hỗ trợ vô hạn vật.

Không suy ra mét, TTC hay vận tốc. Không cảnh báo khi thiếu camera proof,
pixels hai chiều, association duy nhất hoặc bằng chứng ba thời điểm thật.
Projected expansion không tự chứng minh vật đang tự di chuyển tới camera.
Không thêm tracker, không kéo dài cảnh báo cũ và không mượn tuổi ID.

| Lane | Detector | Phép đo |
|---|---|---|
| A | frozen YOLO hiện có | DIS/cohort hiện có |
| B | cùng detections | ROI-RAFT/cohort hiện có |
| C | cùng detections | toàn khung RAFT, direct exposure windows |
| S | cùng detections | bbox diagnostic, không fallback |

M3L direct-ROI là đối chứng lịch sử cho bottleneck đã quan sát, không gọi
lại M3L trên clip mới nếu không cần cho phép kiểm. A/B là so sánh thật trên
cùng clip mới; development được phép reuse A/B/S đã chạy thật trên M3L100
với fingerprint, input/model/policy binding, ghi rõ thời gian lịch sử.
Agent/VLM mô tả trực tiếp chưa được đo lại: không thay phép đo pixel bằng
ngôn ngữ và không gửi ảnh lên cloud.

## Blueprint và phân vai

- Builder field: provider toàn ảnh mới; pin checkpoint hiện có, explicit MPS,
  không CPU fallback. Đổi tọa độ/padding/vector scale kiểm bằng unit tests.
- Builder measurement: bank exposure thật, full same-class competition,
  reciprocal transport và pixel/FB/NCC/affine gates; không cap ROI đối thủ.
- Builder runner: receipt và kiểm độc lập source, clock, detector index,
  field-pair identity, all-competitor matrix, actual call/cost, no-metres.
- Contractor: TIP, dữ liệu, rà nhãn trước inference, chạy thật và kiểm chứng.

Chỉ thêm module R&D và QA, giữ nguyên app và các engine đối chứng. Không
commit, deploy, cài phone, mua API hay tải model mới trong phạm vi này.

## Nguồn và quyền

[RAFT paper](https://arxiv.org/abs/2003.12039) dùng correlation volume toàn
ảnh và cập nhật flow lặp; điều này gợi ý chia sẻ correspondence giữa nhiều
vật, không chứng nhận chất lượng trên dữ liệu này.
[Torchvision RAFT-small](https://docs.pytorch.org/vision/stable/models/generated/torchvision.models.optical_flow.raft_small.html)
cung cấp checkpoint C_T_V2 và transform [-1,1]. Reuse đúng bytes đã có;
code BSD-3 và quyền dữ liệu/checkpoint là hai việc khác nhau. Chỉ R&D local,
chưa xác nhận quyền phân phối weights thương mại. Không gọi đây là SOTA mới.

Boreas [CC BY 4.0](https://github.com/utiasASRL/pyboreas/blob/master/DATA_LICENSE.md),
ASRL, UTIAS/University of Toronto và đồng tác giả. Hai khoảng mới chọn theo
timestamp/cadence, không xem ảnh/detection để chọn ca đẹp:
1598987525026635 và 1598987784079070, mỗi khoảng 4 giây. Không trùng exposure
window đã thử, nhưng vẫn cùng recording/domain. Pose đồng bộ là dữ liệu
được cấp trong thử nghiệm, không giả định smartphone sẽ có pose tương đương.

## Kế hoạch kiểm và điểm dừng

1. Unit/adversarial và authored pixel-positive với >=4 vật, ID đổi, static,
   zoom, pan/rung; phân biệt fixtures với mô hình đã chạy thật.
2. Một lượt development M3L100 đã mở; tối đa một sửa có evidence trước freeze.
3. Hai clip mới tối đa 110 frames, 10 checkpoint có nhãn 2D được trợ lý rà
   trước inference. Nhãn không exhaustive, không phải human certification.
4. 80 authored controls từ ảnh mới: static, zoom, pan, shake. Tách false
   notices ở controls khỏi FP/TN ở checkpoint đã review.
5. Đối chiếu TP/FN, FP/TN, unknown, unmatched/unreviewed; thời gian paired
   p50/p95, cold/startup, actual calls và trường hợp từ chối. Không suy ra FPS
   trên phone từ offline media clock.

Ngân sách local: tối đa 110 development +190 fresh exposures, C tối đa bốn
direction/frame; B giữ budget cũ và tổng directions <=5000 cho lượt fresh.
Mỗi replay tối đa 30 phút, không chạy model/GPU song song. Check disk >=10GiB
trước tải, không copy repo/temp venv, dùng cache/runtime hiện có. Dừng khi
chạm ngân sách hoặc không tạo cải thiện, không hạ floor sau khi xem holdout.

Chỉ đề nghị promote nếu C giảm FN so với cả A/B trên cùng nhãn mới và không
tăng FP trên negatives/controls đã đo; nhỏ mẫu vẫn không chứng nhận sản phẩm.
Nếu không đạt: báo NOT READY, giữ kết quả thất bại và không tích hợp app.

## Completion / Verify

### Freeze trước natural-data inference

- Global provider: `32f03ec4fbdd754be555d8849d63b8fd3412d404f159ad97005df0a82d2f5848`.
- Global window: `8163edb853089f9e87a16ed2c7cd506aa5a0f8c8da32d63870a02585d73fa86b`.
- Runner: `5eb13066fd92019ca7567d7e43c64ba3672e02155ac567a9945850027d4b7427`.
- Authored checks: provider 13, engine 9, runner 10; collector policy 9.
  Đây là kiểm cấu trúc và fixtures, không chứng nhận chất lượng nhận biết.
- Trợ lý rà cả 10 tile trước inference, giữ 10 positives, 15 negatives,
  5 unknown. Sáu cuboid negative bị che hoàn toàn không gán được visible
  extent được ghi unscorable trước inference, không tính thành TN.
- Input mới: `be77119bb740204ccc5d2e020deae1b3409b577155cfd749452775e83c352b05`.
  Reviewed truth: `f9733ab9bf74a907fc02785b6f4703ad5c308f28ff5a59b8384ef477142cc349`.
  100 token mới không trùng 1.179 token distinct trong 14 manifest cũ đã rà.

Phân biệt preflight: actual DIS vượt authored four-object expansion với
bốn eligible rivals hai chiều. Actual RAFT trên chính fixture sáu frame
đó chạy 14 directions nhưng 0 cảnh báo, anchor association chưa đủ chứng
cứ. Không gọi kết quả DIS là nghiệm thu checkpoint RAFT. Smoke translation
toàn ảnh RAFT đo (4,019;1,933) px cho dịch chuyển biết trước (4;2) px;
đây không phải kiểm approach recall. Hai receipt authored được giữ riêng.

### Development đã chạy thật, trước xem kết quả holdout

M3L100 đã mở: A/B lịch sử cùng 4 TP, 9 FN, 0 FP, 4 TN; C mới 0 TP,
13 FN, 0 FP, 4 TN, không có cảnh báo trên 100 frame. S vẫn 11 TP, 2 FN,
1 FP, 3 TN. A/B/S không chạy lại trong lượt development, không tính công
lịch sử thành compute mới.

C thực sự chạy 148 direction calls, 74 shared field pairs, 3.010 candidate
comparisons, 49 comparison có supported pair proof. Eligible set lớn nhất
12, không còn veto cap ba ROI. Wall development toàn replay 116.713,496 ms,
gồm staging/current C, không là latency live hay thời gian chạy mới của A/B.

Đây là thất bại recall, không gọi 0 FP khi im lặng hoàn toàn là thành công.
Không sửa ngưỡng sau kết quả này. Root tiếp tục holdout đã chốt để đo khả
năng khái quát và cả hai loại sai số; bộ tham số/source giữ nguyên freeze.

### Posthoc diagnostic, không sửa inference

Sau khi chấm holdout mới thấy C 0/10 TP, root cho phép một công cụ QA riêng
tách sample-valid, forward/backward consistency và photometric NCC trên
hai recorded fresh fields. Tối đa hai cặp, bốn direction calls, bốn unique
source exposures, không đổi core, không dùng nhãn làm input và không thay
kết quả holdout. Đây là posthoc diagnosis, không phải thêm ca kiểm độc lập.
Tái dựng working JPEG phải khớp source/working-pixel/field hashes; nếu field
khác thì ghi khác, không gọi exact reconstruction. Không dùng kết quả này
để sửa ngưỡng rồi chấm lại chính holdout đã mở.

### Kết quả holdout: NOT READY, không promote

Hai clip mới, 100 exposure, 10 checkpoint, 10 positive target-keyframes,
15 negative và 5 unknown. Cả A, B, C đều 0 TP, 10 FN, 0 FP, 15 TN.
Candidate C im lặng 100/100 frames. Diagnostic S đạt 9 TP, 1 FN nhưng có
1 FP trên negatives đã review, 14 unmatched và 181 unreviewed reports.
Không dùng S làm fallback. A/B có lần lượt 7/6 báo ở frame chưa gán nhãn;
chưa xác định chúng đúng/sai. Không gọi 0 FP trên nhãn thưa là 0 lỗi toàn clip.

80 authored controls từ ảnh mới: A/B/C cùng 0 false notices, S có 48
(43 zoom, 5 pan). Đây là một ảnh được biến đổi, không phải 80 clip field
độc lập. Zero false notices của C không bù được việc không phát hiện ca dương.

Thực thi thật fresh: 180 detector calls, 1.612 ROI-RAFT directions của B,
428 global-RAFT directions của C, tổng 2.040. Không tính 148 development
directions hoặc các authored smoke thành thực thi holdout mới. Candidate
toàn khung chạy 109 field pairs/3.469 comparisons trên clip thật và
105 pairs/7.337 comparisons trên controls. Max 4 directions/frame được kiểm.

| Paired product sample, ms (p50 / p95) | A | B | C |
|---|---:|---:|---:|
| Clip thật mới | 369,03 / 614,86 | 1.306,83 / 4.700,89 | 721,09 / 1.060,55 |
| Controls mới | 209,13 / 345,18 | 1.459,96 / 4.982,88 | 706,67 / 1.926,27 |

Các sample cộng detector perform, staging/shared prep và engine theo từng
frame rồi mới lấy percentile. C tính cả dependency A; B/C đã chứa flow,
không cộng lần hai. Detector sample chỉ đo Vision perform nên đây vẫn là
lower bound, không latency live hay FPS phone. Startup/study wall riêng:
clip thật 207.644,837 ms, controls 201.955,045 ms, là wall cho cả nhiều lane
tuần tự. C có nhiều frame không chạy field do camera/history veto, không
dùng median thấp này làm bằng chứng tốc độ khi phép đo thực sự hoạt động.

Đối chiếu tất cả 10 ca positive mới: đều có raw detection overlap và một
current track khớp scorer duy nhất. First veto gồm 3 camera/background,
1 chưa có fresh exposure sau reset, 6 fresh association không đủ chắc.
Ở cả sáu ca sau, selected row winner chỉ có lower support 0,125–0,484375,
không đạt 70% grid. Đây là association hypotheses, không có reviewed identity
cho exact fresh origin; không gọi chúng là confirmed same-object pairs.
Chỉ bỏ rival veto cũng chưa tạo được pair proof trong sáu hàng này.

Development có 3 camera, 9 fresh association và 1 grid-support first veto.
Trong 9 association misses: 7 selected winners còn thiếu grid support,
1 không nhất quán growth hai chiều, chỉ 1 có fresh pair supported. Ca cuối
vẫn thiếu anchor proof: cùng instance đã review ở origin đạt 32/64 forward,
34/64 reverse assigned points. Unknown rivals là một bottleneck có thật,
không được khẳng định là nguyên nhân duy nhất hoặc chắc chắn cứu được ca nào.

### Hai field tái dựng đúng hash: bottleneck không chỉ là matching budget

QA posthoc chạy thêm đúng 4 model directions trên 4 source exposures, không
chạy detector mới. Cả forward và backward của hai cặp khớp SHA-256 với
receipt gốc; working JPEG pixels cũng khớp. Không sửa inference/gates.

| Source/current population | FB pass /64 | NCC pass /64 | FB∩NCC /64 | FB nhưng texture yếu | FB có texture nhưng correlation thấp |
|---|---:|---:|---:|---:|---:|
| city13 selected source raw0 | 63 | 34 | 34 | 20 | 9 |
| city13 current raw0 | 58 | 27 | 26 | 26 | 6 |
| turn28 selected source raw1 | 47 | 35 | 32 | 9 | 6 |
| turn28 current raw2 | 42 | 42 | 32 | 4 | 6 |

Tất cả 64 points đều nằm trong vùng patch và sample-valid ở hai cặp này.
City minh họa photometric/texture verification mất phần lớn bằng chứng dù
FB khá tốt; turn còn có mất FB. NCC pass không đồng nghĩa assigned support
vì còn phải nằm trong đúng destination box. Các selected source là giả
thuyết association, không được gán reviewed physical identity cho exact
timestamp chưa có annotation. Hai cặp posthoc không đại diện cho mọi miss.

Hướng nghiên cứu tiếp cần kiểm là chọn hỗ trợ có texture từ source trước
khi xem correspondence, verification cục bộ phù hợp biến dạng và detector
chống boxes quá rộng/khó xác minh. Không loại điểm sau khi xem kết quả để
đổi denominator, không xóa unknown rivals, không hạ NCC/70% rồi gọi recall
đã tốt hơn. Bất kỳ biến thể nào cũng cần clip chưa mở và đo lại cả FP/FN.
Chưa chứng minh hướng nào trong số này cứu được ca hoặc có lợi thế sản phẩm.

### Evidence paths và provenance

- Runtime receipts giữ trong `native/ios/.build-xcode/scene-qa/m3m-*-receipt.json`.
  Development: `8c92b71f1789eda56d145d52a8828f8a8528801c6e55dff28a9e3ef489c92e6e`.
  Real: `1744e01220bb8a8935430ead31c690ca3631008064aec928af2aecd38d620e78`.
  Controls: `68f3462b52e86b4a879ad71aaddbfa87e919089cbea347393e7ed96c204278df`.
- Compact scores: `docs/evidence/tip65/m3m-{development,boreas,controls}-score.json`.
- Actual pixel replays: `m3m-city13-pixels.json`, `m3m-turn28-pixels.json`
  trong cùng evidence directory. Tool có unit tests và source hash riêng,
  không được tính là independent human semantic review.
- Authored smokes giữ riêng `m3m-global-smoke.json` và
  `m3m-raft-authored-smoke.json`, không gộp vào holdout counts.
- Dataset labels: assistant visual review trước inference; source paper/license
  dẫn ở trên. Không tái gán nhãn sau khi xem model output để nâng score.

### Verify disposition

USER OUTCOME: đã có đường chạy correspondence toàn khung, đủ toàn bộ graph
12×12 declared detections và kiểm A/B mới; chưa tạo cải thiện nhận biết tiến gần.

REQUIREMENT COVERAGE: full-frame sharing, no three-ROI cap, new A/B, FP/FN,
fail-closed, no metres, Mac-only đều implemented/tested trong scope R&D.
Useful recall improvement không đạt; phone/live/thermal/range chưa kiểm.

SCENARIO RESULTS: authored DIS positive pass; actual RAFT authored positive
fail; actual natural candidate 0/10 TP, 0 FP/15 negatives, controls 0 notices.
Recall failure là blocker, không đổi thành READY nhờ unit tests xanh.

VALUE EVIDENCE: regressed trên development, không cải thiện trên holdout mới
so với baseline đã đo. C ít model
calls và paired samples thấp hơn ROI-RAFT trong lượt này, nhưng im lặng nên
không coi đó là speed/product win. Direct LLM/agent baseline chưa đo lại;
không gọi local tốt hơn cloud hay thương mại tốt hơn đối thủ.

LIMITS + DISPOSITION: không promote, không thay app/iPhone, không deploy,
không commit/push. Giữ các engine đối chứng và toàn bộ bằng chứng thất bại.
Không chứng nhận pretrained checkpoint dùng thương mại chỉ từ code license.

TECHNICAL HEALTH: final Mac gate PASS: 416 Python tests, 121 Swift tests,
9 Node policy tests và TypeScript typecheck; không skip/failure. Đây là số
test discovery của một lượt QA, không cộng các lần kiểm lại cùng test.
Receipt: [Mac QA](evidence/tip65/mac-readiness/runs/2026-11-16T08-16-00-231Z-cfb9b040/summary.json).
Fingerprint 137 source files trước/sau và root-current đều
`3685ffa3d5a238bdc83d8b49a49b1bcb5a1825cc947105907dbbc0ba7de650f1`.
Root chấm lại độc lập ba receipt, totals và code fingerprints trùng. Có
1.120 lane/frame no-metre checks (400 development, 400 real, 320 controls),
không phải 1.120 video hoặc sự kiện độc lập. Hai pixel diagnostics tái dựng
đúng field hashes và khớp toàn bộ verified-point counts ở 38/21 eligible
comparisons tương ứng. Không gọi đây là ground-truth optical-flow accuracy.

Disk cuối 38 GiB free. Không cài dependency/model mới, không copy project,
không thêm build directory. Staging của ba replay M3M và hai pixel replays
đã tự dọn bằng TemporaryDirectory; không còn own staging ở scene-qa hoặc
scratch readiness-test trong macOS temp. Giữ dữ liệu thật, nhãn và receipts
cần cho tái kiểm. 11 tracked dirty files cũ vẫn được bảo toàn, không stage.

OVERALL STATUS: NOT READY cho tính năng cảnh báo; thử nghiệm R&D hoàn tất,
structural QA xanh không nâng thành nghiệm thu semantic, phone hoặc thương mại.
