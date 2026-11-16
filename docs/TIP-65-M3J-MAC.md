# TIP-65 M3J: detection và đối chiếu pixel, không thêm tracker

16/11/2026. Mac-only. TIP lập trước mọi inference trên holdout mới.

## Outcome, nguồn yêu cầu và quyết định

Người dùng giao cải thiện detection và correspondence, A/B với bản hiện tại
trên clip mới, đo cả false notice/miss; thiếu bằng chứng phải im, không mét,
không iPhone. Áp dụng Vibecode Kit v6.3: Contractor thiết kế/chọn dữ liệu và
kiểm chứng; Builder implementation riêng; không coi self-review là độc lập.

M3I cho biết 13/32 positive không có detection cùng family khớp IoU 0,35.
ECC affine và DIS affine chỉ đạt 1/32, kém M3H 3/32. Không promote hai
candidate đó. Thử nghiệm này giữ M3H làm A, không lấy M3I làm mặc định.

Hai giả thuyết có thể bác bỏ: (H1) downscale toàn ảnh vào model 416 làm
mất vật nhỏ mà fixed tiles có thể tìm lại, kể cả chưa có bbox để tạo ROI;
(H2) affine ECC khởi tạo chỉ translation khó hội tụ ở baseline dài, trong
khi match đặc trưng ảnh có thể cho initializer tỷ lệ/quay từ pixel thật.
Không khẳng định các giả thuyết đúng trước kết quả.

## Tham khảo kỹ thuật và phạm vi tận dụng

- [SAHI sliced inference](https://raw.githubusercontent.com/obss/sahi/main/docs/guides/sliced-inference.md):
  giữ full-image pass, thêm tile chồng lấn và quy về cùng tọa độ. Tăng
  compute và có thể tăng false detections. Tự viết adapter nhỏ cho model
  CoreML đang có, không cài SAHI hoặc tuyên bố tái lập benchmark của họ.
- [OpenCV SIFT](https://docs.opencv.org/4.x/da/df5/tutorial_py_sift_intro.html)
  và [feature matching](https://docs.opencv.org/4.x/dc/dc3/tutorial_py_matcher.html):
  descriptor theo scale/orientation và matching hai chiều/ratio test.
  SIFT không tự chứng minh chuyển động hay an toàn, có thể thiếu feature.
- [OpenCV ECC](https://docs.opencv.org/4.x/dc/d6b/group__video__track.html):
  initializer từ pixel fit để cải thiện hội tụ, vẫn xác minh hai chiều,
  photometry, cycle và phân bố. Không lấy bbox scale làm số đo.
- [Boreas data license](https://raw.githubusercontent.com/utiasASRL/pyboreas/master/DATA_LICENSE.md):
  nguồn ghi CC BY 4.0. Giữ provenance/attribution và chỉ dùng lát cắt R&D,
  không khai thác định danh người trong ảnh.

Đây là các phương pháp cổ điển có sẵn để kiểm giả thuyết cụ thể, không
phải tuyên bố SOTA. Không đổi weights/dependencies, không cloud hay API
trả phí. OpenCV 5.0.0 có SIFT thực sự trong venv hiện hành. Learned-flow
và detector mới chưa benchmark; direct VLM/agent chưa đo lại. S box-only
là tool baseline đơn giản, không fallback sản phẩm.

## Blueprint / ranh giới bất biến

Detection: full-image YOLOv3 FP16 hiện tại giữ nguyên. Thêm tối đa bốn tile
2x2 row-major native, mỗi tile phủ 60% mỗi trục, overlap bằng 20% toàn ảnh
(33,3% cạnh tile, không nhầm với overlap fraction của SAHI). Không chọn
road ROI hay dựa vào nhãn/box khung trước. Tile mới phải score >=0,60,
qua artificial-edge/ambiguity/duplicate/geometry gate. Giữ full boxes,
không thay bằng trung bình hộp crop; giới hạn tổng 12. Không đổi confidence
0,38 / NMS 0,45 của model cũ. Đây là thêm quan sát, không tracker.

Correspondence: `FeatureRegionMotion` tái dùng vòng đời snapshot/window của
M3I RegionMotion, chỉ thay `_measure`. SIFT <=600 feature/ROI <=384, mutual
Lowe ratio 0,75, >=12 match, affine RANSAC 1,5 px, >=12 inlier và tỷ lệ
>=0,60 trên descriptor matches; span/hull như cũ. Affine này chỉ khởi tạo
ECC forward/reverse. Final pixel grid vẫn >=70%, correlation >=0,70,
cycle <=1,3 px từng điểm, spread/shape/box agreement không nới.

Phải phân biệt mẫu số descriptor-inlier với final fresh-grid support.
Initializer và tăng trưởng đều từ pixels thật, không từ bbox kích thước.
Không đủ feature/không hội tụ/thiếu support thì không đo. Giữ nguồn camera,
ID, epoch, clock, calibration và zoom veto. Warning cần current adjacent
pair và direct anchor 320–800 ms, net linear-log growth >=0,04, fresh growth
>=0,0005, không mâu thuẫn anchor. Scalar là projected image expansion,
không exact angular/radial speed hoặc mét.

## A/B và ablation đăng ký trước

| Lane | Detection | Identity owner | Measurement |
|---|---|---|---|
| A | Full image cũ | M3H cũ | M3H cũ |
| B | Full + fixed tiles | Cùng class M3H, không sửa | M3H cũ |
| C | Full image cũ | Nhận đúng surface A | Feature-seeded ECC |
| D | Full + fixed tiles | Nhận đúng surface B | Feature-seeded ECC |
| S | Full image cũ | Box baseline diagnostic | Box-only |

A và B có thể khác ID vì khác observation; chỉ kiểm C==A, D==B về tracks/
epoch, không giả A==B. Không thêm loại tracker hoặc thay association policy.
M3H, M3I engines/runners cũ bất biến. Mỗi source identity surface được
kiểm không bị candidate sửa. Ground truth chỉ vào scorer sau inference.

## Dữ liệu, budget, khóa và điều kiện dừng

Development chỉ dùng M3I đã mở: 100 exposure; full detections cache phải
validate nguyên source/model/config/hash, ghi historical timing. Tối đa
400 tile calls mới. Một candidate detection + một candidate correspondence,
tối đa một sửa cơ chế dựa trên development trước lock, không quét ngưỡng.

Hai đoạn M3J được chọn từ pose/cadence trước RGB/boxes: anchor
1598988945059928 (100 native 25 Hz, speed trung bình 10,585 m/s, lấy chỉ
số chẵn cố định thành 50), và 1598989903075981 (50 native 12,5 Hz, speed
7,293 m/s). Không overlap các interval M3C–I đã lưu. Là đoạn kế tiếp trong
cùng recording, không độc lập miền hay chứng minh khái quát địa lý.

Main review cả 10 checkpoint tile trước inference, sửa extent 2D độc lập
model; mọi omission có lý do, không loại ca sau kết quả. Nhãn approach
vật lý giữ nguyên. Controls 4x20 exposure static/zoom/pan/shake từ một
ảnh mới là dữ liệu dựng, không gọi là bốn clip thực độc lập. Danh sách
target controls rỗng nên đếm false notices toàn cảnh, không FP-rate 0/0.

Holdout tối đa 180 exposure, 900 actual full+tile model calls, batch <=50
ảnh/process để không nạp model lại mỗi khung. Không cache holdout. Freeze
code/policy trước lượt này; score FP/FN cùng tiêu chí cũ IoU0,35 margin0,08;
unknown/unmatched/unscored riêng, thêm detection ceiling full vs augmented.
Không chọn kết quả thuận lợi rồi đổi metric, label hay threshold.

Đo tổng service theo từng exposure trước percentile: full/tile inference,
prep, merge, identity owner, measurement; ghi batch/model startup, staging
wall riêng. Không sum p95, không gọi filter-only là end-to-end. B/D phải
trả chi phí tile thực tế; C/D trả identity owner A/B tương ứng.

Promote chỉ khi có cải thiện recall không tăng observed false notices ở
negative controls/negative targets và công bố latency. Nếu thua A thì giữ
candidate ngoài app, không nới guard hoặc tuyên bố test xanh là sản phẩm đạt.
Không iPhone, native app edit, cài app, commit/push/deploy trong lượt này.

Disk preflight khoảng50 GiB free (>10 GiB), reuse checkout/venv/model.
Không project copy, build/venv mới. Nguồn R&D giữ có mục đích; staging
`codex-tmp-assist-m3j-<date>-*` trong SceneQA tự dọn cả khi lỗi.

## Completion / Verify

### Trước development và holdout

Main đã kiểm độc lập16/16 tiled-detector tests,15/15 feature-region tests.
Đây là authored mechanism cases, không là độ chính xác video thực.
Hai module đã khóa, không thay M3H/M3I cũ:

- Tiled detector: `e442c2f4b3ccb4dbe19f12181db9a532025a9e5b1a29e5d59dd792a4e6a4fc6d`.
- Feature measurement: `0526b7ff1757a88a4407128f5ac95b3cd1c8b8e0a30963691383e782e1d6c3e4`.

Review hoàn tất trước inference M3J:10 tile,30 candidate,29 giữ lại:
24 approaching,2 not-approaching,3 unknown. Một negative distant car bị
che bởi SUV không có extent độc lập nên omit trước kết quả; candidate
gốc và lý do được lưu, không tính thành abstention đúng. Cyclist là
vehicle family, hộp bao rider+bicycle; detector chỉ ra person chưa đủ
được chấm là detection vehicle khớp. Nhãn là assistant visual review,
không human-certified hoặc exhaustive ground truth.

- [Review đã khóa](evidence/tip65/m3j-boreas-reviewed-2d.json).
- Input M3J SHA-256: `c16b667ee8fd61ffa30ae2e15effe613235c1c6741b3954bf5d8959d29e6d151`.
- Bound truth SHA-256: `87e032a80c17324c2ec85d942ab961c92d2617fedd3c2a96006ad4cc9106e05c`.
- Controls input SHA-256: `0224638ea5cc5fc2008ad3e59cda3a6bd719ad51ad6e5c03e928b0953b5d7ecb`.

Controls dùng generator M3H cũ nên prefix `m3h-control-*` giữ nguyên;
source token/hash/input thuộc M3J mới. Không nhầm prefix với dùng lại
ảnh cũ. Nguồn tải143 file435.377.704 byte, không full sequence.

Runner đang hoàn tất adversarial tests và kiểm chứng provenance/timing;
chưa có kết luận cải thiện, chưa mở inference holdout.

### Development đã chạy và khóa trước holdout

Runner hash `b9059204cc988f90c651282f39a2a278d1014fd8a0205db70b9ae795a5b3effa`,
hai module hash ở trên; không sửa thuật toán sau development. Main chạy
100 exposure M3I với full detector cache hợp lệ +400 tile calls thật mới.
A tái hiện chính xác100/100 status/tracks/events/epoch của M3I A.

| Development M3I (không holdout) | TP | FN | FP /2 negative |
|---|---:|---:|---:|
| A |3|29|0|
| B |3|29|0|
| C |0|32|0|
| D |0|32|0|
| S |10|22|0|

Tile tăng detection khớp approaching từ19 lên20/32,140 observation bổ
sung trên100 frame; không gọi140 additions là140 detection đúng. C có
260/427 pair đo bị thiếu feature matches; D294/488. Chưa có bằng chứng
SIFT-init cải thiện recall, không hạ minMatches/spread để cứu checkpoint.
Đây là candidate có khả năng bị bác bỏ, không là bản mới mặc định.

Main kiểm độc lập11 runner tests đạt trước development; independent
review đã dẫn đến bổ sung hash dependency ROI geometry, score-time
policy/config/call-count/provenance guards và tách tile-parsing cost
khỏi baseline. Các sửa này trước mọi real run, không đổi motion gates.
Guard flag development/cache đã có trong bản khóa, không cần sửa runtime.

Đã kiểm hash mọi dependency trong raw development receipt vẫn khớp
file hiện hành; hai model modules, runner và policy giữ nguyên cho
holdout kế tiếp. Main giữ nguyên29 nhãn đã review trước inference.

### Holdout: kết quả không đạt

Main chạy thực tế100 exposure của hai clip mới và80 exposure controls,
không cache. Tất cả500+400=900 model evaluations là CoreML local thật;
cộng400 tile evaluations của development là1300 trong lượt này. Không
đổi code, policy hoặc nhãn sau khi mở kết quả. Source/dependency hashes
trong cả ba raw receipt khớp nhau và khớp file hiện hành. C==A và D==B
về tracks/epoch được kiểm trên280/280 exposure cả dev và holdout.

| Lane trên clip mới | TP /24 | FN | FP /2 labelled negative | False notices /80 control frames |
|---|---:|---:|---:|---:|
| A: bản hiện tại |0|24|0|0|
| B: chỉ thêm tiles |0|24|0|0|
| C: chỉ feature-ECC |0|24|0|0|
| D: cả tiles và feature-ECC |0|24|0|0|
| S: box-only không camera/pixel gates |4|20|0|16|

S có15 notice sai ở zoom,1 ở pan,0 ở static/shake. Đếm notice, không
phải16 video độc lập. A–D đều im ở80 control frames. Với chỉ hai target
negative thực và recall0, không được gọi là an toàn hay precision tốt.
S là diagnostic **không có** các guard camera/pixel của A–D; kết quả này
không bác bỏ mọi thiết kế box-based có guard, và không chứng minh bất kỳ
hybrid chưa chạy nào sẽ tốt hơn. Không tự bật fallback box-only hiện có.

Unmatched reports tại checkpoint: A/B2, C/D0, S8. Unscored-frame notices:
A/B13, C/D0, S92. Có3 unknown target, không có notice khớp chúng. Các
notice unmatched/unreviewed chưa được chứng nhận thật/sai, không gán0
vào FP tổng quát. C/D không phát notice nào trên100 exposure thật: đây
là thất bại về hữu dụng, không phải thành công nhờ luôn im lặng.

Detection ceiling full và tiled đều12/24 positive khớp cùng-family IoU
>=0,35.15 tile additions trên100 exposure không cứu thêm target đã chấm.
Development tăng19→20/32 không khái quát sang holdout. Không đồng nhất
ceiling này với mAP/recall toàn bộ vật thể, vì nhãn chỉ là selected targets.

Main đối soát từng24 positive sau inference, không sửa thuật toán:

| First current category | A/B | C/D |
|---|---:|---:|
| Không có qualifying detection khớp |12|12|
| Current camera veto |1|1|
| New/unverified identity |5|5|
| Small/truncated |1|1|
| Cohort disagreement |3|không áp dụng|
| Không có mature cohort hỗ trợ |2|không áp dụng|
| Fresh feature matches không đủ |không áp dụng|4|
| Không có direct long proof hỗ trợ |không áp dụng|1|
| Tổng FN |24|24|

Đây là first-veto attribution, không bằng chứng cứ bỏ một guard là sẽ
đúng. Across100 frame: mỗi A/B owner có96 valid,2 camera-invalid,2 first
frame. Riêng C có289/352 pair call thiếu feature matches; D291/354,
không phải289 đối tượng độc lập. Chỉ45 call mỗi lane được pixel-support;
không đủ tạo chuỗi current+long-anchor hợp lệ. Nguyên nhân phù hợp với
việc SIFT không có đủ texture/descriptor đối ứng trên nhiều ROI nhỏ,
tối/biến dạng, không phải lời giải chỉ cần tăng tuổi tracker.

### Công thực thi và latency

Mac thực tế kiểm bằngsysctl: Apple M1 Max,32 GiB RAM. Không install,
download weights mới, cloud, API trả phí, iPhone hoặc native app edit.
Nguồn public R&D giữ cục bộ; số tiền compute và công người không đo,
không gán0 vì không có hóa đơn API.

Paired service trên100 exposure thật, cộng từng operation sample trước
percentile, theo protocol của M3J (gồm full-image staging/decode/inference):

| Lane | p50 ms | p95 ms |
|---|---:|---:|
| A |497,33|631,44|
| B |970,60|1223,01|
| C |566,68|771,33|
| D |1047,95|1348,43|
| S |360,14|491,76|

Không cộng p95 riêng lẻ. B/D có đủ tile preparation/parsing/four-call
inference/merge; C/D có identity owner tương ứng. Full staging tái decode
native và encode JPEG thật, rồi runtime lại decode native; đây là replay
cost đã chạy, chưa tối ưu thành camera pipeline. Model-startup/batch wall,
queue/UI/audio không quy về per-exposure inference giả. Tổng study wall
hai clip≈59,50+77,23 giây, chạy cả năm lane tuần tự. Không so trực tiếp
sample này với M3I vốn không charge full staging, không gọi là phone FPS
hoặc realtime. Thêm compute nhưng không cải thiện outcome trong holdout.

### Disposition và bằng chứng

**REJECT PROMOTION / NOT READY. Mục tiêu cải thiện detection + nhận biết
tiến gần chưa đạt.** Các module mới và runner dùng lại được cho nghiên
cứu, không thay đường chạy mặc định hay quảng cáo là đã nâng cấp chất
lượng. Giữ nguyên mọi ca thất bại và không hạ ngưỡng để che FN.

Kết quả đủ để dừng nhánh tối ưu hiện tại theo kiểu thêm tile cho YOLOv3
và yêu cầu SIFT làm initializer bắt buộc. Bước nghiên cứu sau cần đối
chiếu detector khác và correspondence có học trên Mac với baseline đơn
giản có camera guards, đánh giá từng tầng trên ROI đã kiểm. Chưa chọn
model/license/runtime mới, chưa có bằng chứng phương án đó sẽ đạt. Không
thêm tracker hay tiếp tục nới gate để biến0/24 thành con số thuận mắt.
M3J đã mở kết quả phải coi là development trong vòng sau; cần holdout mới.

- [Score development](evidence/tip65/m3j-development-score.json),
  [score clip mới](evidence/tip65/m3j-boreas-score.json),
  [score controls](evidence/tip65/m3j-controls-score.json).
- Raw dev: `native/ios/.build-xcode/scene-qa/m3j-development-receipt.json`,
  SHA-256 `9bcff8edf67e87fd00313ca1fd91d396ae00c1b783f986a6c768a9645c15e8c3`.
- Raw real: `native/ios/.build-xcode/scene-qa/m3j-boreas-receipt.json`,
  SHA-256 `4873c3d5f8d72d3639954e7f17046d86b1f92d04ef64ba5befbe648fdbc17fab`.
- Raw controls: `native/ios/.build-xcode/scene-qa/m3j-controls-receipt.json`,
  SHA-256 `928cfeb4069dc94682738120b374901515f3c2ce7d4c9fda8f026ad8a414b61f`.
- Tái chạy: venv SceneQA hiện hành, `scripts/assist_scene_m3j_study.py replay
  --input <input.json> --sceneqa <sceneqa> --yolo <YOLOv3FP16.mlmodelc>
  --output <new-receipt-path>`, rồi `score --input … --truth … --receipt …
  --output <new-score-path>`. Development cache bắt buộc đi cùng
  `--development-only`, chỉ old M3I100 exposure. Không overwrite evidence.

### Completion / Verify cuối

[Structural regression receipt](evidence/tip65/mac-readiness/runs/2026-11-16T05-53-47-063Z-5b7fd96d/summary.json):
289/289 Python,121/121 Swift,8/8 readiness-policy tests đạt; TypeScript
`--noEmit` và `git diff --check` đạt. Không cộng trùng các lượt focused
test trước đó vào tổng289. Source fingerprint113 files không đổi trước/
sau: `429befc4fae0aed29fc462e9cb6e0441d1ccd6380734493609a5062ff990cf68`.

Main tái score độc lập cả ba raw receipt sau QA bằng đúng input/truth và
scorer hiện hành: totals khớp toàn bộ saved scores;500+500+400=1400 lane
surface no-metre contracts đạt (khác1300 actual model calls). Main kiểm
toàn bộ code hashes, track-owner equality, bộ clock/nguồn và first-veto
attribution24/24 target trên holdout. Không chỉ dựa vào lời báo Builder.

Requirement coverage: hai research adapters và runner A/B đầy đủ đã
implement; authored negatives, provenance/flag/cost adversarial tests,
real local calls và fresh heldout FP/FN đã kiểm. **User outcome cải
thiện: FAIL**, không có lợi ích recall trên holdout; thêm latency.
Value evidence=measured/not achieved, không lấy số module/test làm giá
trị sản phẩm. Partial implementation không được gọi là product READY.

Không có app/UI thay đổi trong lượt này; không cần iPhone để hoàn tất
thử nghiệm. iPhone/device acceptance, signed app build, mobile latency,
thermal, accessibility và safety validation: NOT TESTED (ngoài phạm vi).
`releaseApproved=false`, không commit/push/deploy.

Không install/dependency/model mới, không project copy hoặc build dir
mới. Staging `codex-tmp-assist-m3j-*` và test fixtures tự dọn, Main xác
nhận không còn staging. Giữ dataset/controls/receipts R&D có mục đích
trong SceneQA hiện có; không xóa feature, build hay dữ liệu khác. Disk
cuối≈49 GiB free, cao hơn sàn10 GiB. Trạng thái cuối: **NOT READY** về
mục tiêu nhận biết tiến gần hữu dụng, thí nghiệm đã hoàn tất có bằng chứng.
