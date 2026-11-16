# TIP-65 M3N: source texture selection và deformation-aware verification

16/11/2026, Contractor dùng Vibecode Kit v6.3. Mac M1 Max32GiB. TIP trước
RGB mới và trước inference. Chưa cần iPhone; không sửa app/deploy/commit.

## Outcome và giả thuyết

Người dùng giao chọn điểm có texture và cải thiện xác minh ảnh khi vật đổi
góc/biến dạng, không nới ngưỡng. Đo FP và FN trên clip mới; thiếu bằng chứng
thì không báo; không suy mét. M3M mới 0/10 TP dù 10 current detector matches.
Hai posthoc fields khớp hash cho thấy sample-valid64/64 nhưng FB∩NCC chỉ
26–34/64; cả texture yếu, correlation và FB có đóng góp. Không quy mọi miss
cho một nguyên nhân, không coi thêm compute là đã giải quyết chất lượng.

Thay đổi nhỏ nhất: chọn các điểm có cấu trúc ngay từ ảnh nguồn; xác minh
ảnh đích bằng local warp do full-frame correspondence cung cấp, không so
hai patch chỉ dịch chuyển. Đây là giả thuyết cần bác bỏ, không là bảo đảm
model mới/SOTA, cũng không chứng minh tiến gần của mọi bề mặt biến dạng.

## Blueprint và đối chứng

| Lane | Điểm nguồn | Photometric verification |
|---|---|---|
| A | frozen M3M uniform64 | frozen raw7px NCC |
| B | source-texture tối đa64 | cùng raw7px NCC, selection-only ablation |
| C | cùng source-texture như B | flow-warped7px NCC, không tối ưu correlation |
| S | bbox diagnostic | không làm fallback |

Camera/handle surface T là frozen DIS/cohort, không lấy tuổi ID làm bằng
chứng. A/B/C cùng detections YOLO hiện có, RAFT-small checkpoint đã có,
pose đồng bộ và intrinsics. Không thêm tracker, không thay detector trong
lượt này. Baseline trực tiếp LLM/agent chưa đo lại; không đưa VLM vào phép đo
hoặc gọi local ưu việt hơn cloud vì số lượng unit tests.

Builder patches: `assist_scene_texture_patches.py` và test. Builder engine:
`assist_scene_textured_window.py` và test. Builder runner: `assist_scene_m3n_study.py`
và test/collector. Contractor giữ TIP, dữ liệu/nhãn, inference thật và verify.
Giữ frozen M3M, không monkeypatch globals hoặc sửa đối chứng.

## Không nới ngưỡng, đổi population phải công khai

Selector chỉ đọc ảnh nguồn và raw source box: mỗi ô8×8 interior chọn tối đa
một điểm cornerMinEigenVal mạnh nhất, variance7px>=16 (std>=4), eigenvalue
>=0,01 của valid ROI maximum. Full patch phải nằm trong ảnh và source box.
Tối đa64 điểm, deterministic tie order. Không dùng target/flow/FB/NCC hoặc
nhãn để chọn lại điểm. Mọi điểm đã chọn đều giữ trong denominator sau đó.
Seed count N có thể khác64: đây là thay đổi evidence population được người
dùng giao, không giả vờ cùng population cũ hoặc bỏ điểm lỗi sau phép ghép.

Giữ min9, support70%, span0,24, hull0,035, FB1,3px, RANSAC/final fit1,2px,
NCC0,70 và norm-product49×4². Giữ existing shape/growth bounds: log0,4,
anisotropy0,2, rotation15°, box disagreement0,12, forward/negated-reverse
span0,005, current growth0,0005 và long growth0,04. Giữ camera/zoom veto,
ba real exposures, current evidence, full rival graph và unknown upper bounds.
N<9 hoặc geometry thiếu proof phải là unknown [0,1], không xóa rival.

Warped patch lấy offset7×7 từ source và field thật, không bbox normalization,
không tìm warp tối ưu NCC và không fallback cherry-pick sang raw khi fail.
Tất cả49 pixels hợp lệ, same0,70 NCC; thêm bounded local geometry và patch
FB checks. Nội dung biến dạng mạnh không phù hợp projected-growth proof
vẫn phải từ chối. Cả hai chiều và cả fresh/oldest anchor đều cần đủ bằng chứng.

## Dữ liệu và provenance

Development: M3M100 đã mở; reuse baseline A/T/S và detector từ actual M3M
receipt với source/model/policy/hash/timing binding, chỉ chạy B/C mới. Không
tính historical A thành model calls hoặc latency thực thi mới.

Holdout: hai khoảng4s chọn từ cadence/speed metadata, chưa xem RGB/model:
1598989121031027 và 1598987790079070. City continuation1598987531026635 bị
loại trước xem ảnh vì chỉ22 exposures, không đủ timeline; không loại theo
kết quả. Nguồn Boreas CC BY4.0, ASRL/UTIAS/University of Toronto và đồng tác
giả. Cùng recording/domain với các nghiên cứu trước, không cross-domain.
10 fixed checkpoint tiles sẽ được trợ lý rà visible2D trước inference;
không gọi human certification hoặc nhãn exhaustive.

80 controls từ ảnh mới: static/zoom/pan/shake, authored transforms không
phải80 field videos. Không dùng nuScenes. Không tải checkpoint/dependency mới.
Quyền thương mại checkpoint/training data vẫn tách khỏi code BSD license.

## Nguồn kỹ thuật đã đối chiếu

- [OpenCV feature detection](https://docs.opencv.org/4.x/dd/d1a/group__imgproc__feature.html):
  eigenvalue/corners từ source image, không tự chứng minh match hoặc motion.
- [OpenCV image transforms](https://docs.opencv.org/5.0/main_modules/imgproc_transform.html):
  subpixel sampling/remap; cần giữ pixel geometry, không sửa kích thước theo box.
- [Baker/Matthews, image alignment framework](https://publications.ri.cmu.edu/lucas-kanade-20-years-on-a-unifying-framework):
  phân biệt warp hình học và mục tiêu ảnh. Candidate dùng fixed field warp,
  không nhận vơ đã triển khai inverse-compositional optimizer của bài báo.
- [Boreas data license](https://github.com/utiasASRL/pyboreas/blob/master/DATA_LICENSE.md).

## Budget, kiểm bác bỏ và điểm dừng

Một development100 trước freeze; tối đa một repair có evidence trên authored
hoặc tối đa10 development exposures thêm, không tuning holdout. Fresh100 thật
và80 controls; mỗi replay<=30phút,<=110frames. Một resident model, sequential
A/B/C actual calls, tối đa4 directions/lane/frame, không fake cache counters.
Fresh tối đa2160 directions; development B/C tối đa800, extra probe<=80.
Authored MPS smoke nếu cần: riêng tối đa36 directions, không gộp với field
holdout và không gọi authored success là chất lượng trên cảnh thật.
Không GPU song song, check disk>=10GiB trước tải/build, không project copies.

Trước natural-data inference cần positive pixel fixtures, source-only/adversarial
tests và independent source/call/seed/envelope checks. So B–A để thấy selection,
C–B để thấy warped verification. Đo TP/FN/FP/TN, unknown và unmatched/unreviewed
riêng; mỗi lane paired timing cộng đúng dependencies trước percentile.

Chỉ đề nghị giữ C làm candidate tốt hơn nếu giảm FN mà không tăng FP ở phạm
vi đã đo. Nếu tiếp tục im lặng hoặc không có useful outcome, báo NOT READY,
không promote và không gọi giảm compute là thắng sản phẩm. Chưa đo phone,
live latency, safety, range hoặc thương mại. Không sửa tham số từ holdout.

## Completion / Verify

### Dữ liệu/nhãn đã khóa trước inference

100 exposure mới không trùng1.279 distinct tokens cũ đã đối chiếu. Trợ lý
rà cả10 fixed RGB tiles, giữ17 positive target-keyframes (10 vehicle,
7 person),6 negatives vehicle,3 unknown. Tám projected candidates không
gán được separately visible extent được ghi unscorable trước inference,
gồm1 positive person bị che. Không tính omission là TN hoặc hạ FN sau kết quả.
Một checkpoint không có target được giữ nguyên, không xem là exhaustive
negative vì còn nhiều người/vật chưa được gán physical state.

Input: `2c359c6296bcd191277a881280aa105044ff937cf189d2fe4ec61252bb75c8d5`.
Reviewed truth: `c12d0368bd309c266b778d3f8887eb92797f14dc8a03057dc10131669d3cbfca`.
Nguồn143 files,477.113.955 bytes, hai khoảng camera50frames mỗi khoảng.

### Preflight source/patch, chưa phải pretrained acceptance

Module selector/patch có14 authored tests. Fixture192×192 dùng analytic
affine forward/inverse fields: scale1,35, rotation12°, translation(-4,+3),
cùng64 source seeds, raw7/64 qua verification, warped64/64. Đây là ảnh và
field có đối chứng do tác giả tạo, không phải RAFT thật hoặc natural recall.
Repeated texture full-cycle có thể qua local pixels; không tuyên bố patch
đơn lẻ chứng minh cùng physical object. Rival/temporal/camera veto vẫn cần.

Chưa có natural-data M3N inference tại thời điểm ghi phần preflight này.

### Freeze trước natural-data inference

- Patches: `a2034129b5131414869aed78b16b9649e7901f4fa7ea80e52b7aee21ff737459`.
- Engine: `57e2fc804a9215bc214c0381e1a629144641e0ad78cde77e80988c9e27d30fc4`.
- Runner: `ac3c0ce7d6127e336451cd38756770d7dc5bc89a5b24d51f29b7c1c77a085e60`.
- Source/patch14, engine11, runner11 authored tests pass; actual DIS four-object
  expansion có >=4 eligible rivals, source inventories khóa trước field call.
  Đây không phải kết quả RAFT trên ảnh thật. Một lỗ hổng receipt geometry được
  peer audit phát hiện trước inference đã sửa: retained endpoints không thể
  đổi mà vẫn giữ assignment/affine/spread cũ. Không nới ngưỡng để sửa receipt.
- Actual RAFT MPS authored five-frame smoke dùng30 direction calls: A/B/C
  đều0 cảnh báo, anchor association chưa đủ chứng cứ. Giữ receipt riêng,
  không gọi các test analytic/DIS xanh là nghiệm thu checkpoint pretrained.
- Runtime receipt compact, bounded256MiB, không duplicate full point proof
  theo n² comparisons. Giữ population catalogs và original selected N/hash.
  Cache M3M cũ vẫn cap128MiB. Không truncation để che bằng chứng.

Từ freeze giữ nguyên core và thresholds trong development/holdout, trừ
blocking execution/proof bug có evidence trước khi xem holdout; nếu có
deviation phải ghi riêng, không relabel một run thành phiên bản khác.

### Deviation trước holdout: baseline timing alias

Lượt development100 đầu dừng trong clip city trước khi xuất receipt:
`Global execution omitted actual field cost`. `_view` đã map surface A/T
và counters nhưng chưa map timing tương ứng, nên audit của M3M so thời
gian historical A với timing của C mới. Đây là lỗi integration/audit, không
chứng minh algorithm nhận biết sai. Không bỏ gate, không đổi threshold.
Source runner của lượt dừng là `ac3c0ce7...a085e60`; không relabel thành bản sửa.

Không có telemetry frame/counter của lần dừng đầu: actual calls đã dùng là
UNKNOWN, không ghi0. Upper bound từ clip đầu: <=50 exposures, <=400 B/C
directions. Không có receipt hoàn chỉnh và staging đã tự dọn. Không gọi
development trial hoàn tất, không có development semantic score mới.

Để giữ ngân sách110 development exposures, Contractor không replay lại100.
Sau sửa alias và regression, chỉ chạy integration preflight10 exposures
prefix với đúng source/cached baseline, không chấm semantics hoặc dùng nhãn.
Worst-case development tổng<=60exposures,<=480directions, vẫn trong budget.
Holdout100 mới và controls80 sẽ chạy bản freeze sau sửa, không tuning theo
holdout. Telemetry tối thiểu được bổ sung để lỗi sau này có frame/call count.

Runner sau sửa alias/telemetry và13 regression tests:
`2f4cff0d60d5f8f37911f675641ba9a963388da33d35e31178a95477e2c9e2ec`.
Patches/engine/field và toàn bộ numeric floors giữ nguyên. Runner cũ và
runner mới được ghi khác phiên bản; không đổi provenance của smoke/trial cũ.

Actual bounded execution preflight sau sửa PASS trên10 prefix exposures,
12 B/C direction calls. Không có semantic evaluation, không ghi0 FN/FP;
đây không phải development100 hoàn tất. Artifact riêng
`docs/evidence/tip65/m3n-execution-preflight.json`, completeStudy=false.
Staging tự dọn, source trước/sau khớp; không chạy lại detector trong preflight.

## Completion / Verify cuối: NOT READY, không promote

### Kết quả trên clip thật mới

100 exposure mới,10 checkpoint,17 positive target-keyframes thuộc11 physical
instances (7 vehicle instances,4 person instances),6 negative và3 unknown.
Không gọi17 checkpoint observations là17 clip hoặc17 đối tượng độc lập.

| Lane | TP | FN | FP | TN | Unmatched | Báo ở frame chưa review |
|---|---:|---:|---:|---:|---:|---:|
| A frozen uniform | 0 | 17 | 0 | 6 | 0 | 0 |
| B source texture/raw | 0 | 17 | 0 | 6 | 0 | 0 |
| C source texture/warped | 0 | 17 | 0 | 6 | 0 | 0 |
| S bbox diagnostic | 7 | 10 | 1 | 5 | 11 | 138 |

A/B/C im lặng100/100 frames. Đây là fail về useful recall, không phải
thành công vì0 FP. S không được dùng làm fallback.

80 authored camera controls mới: A/B/C cùng0 false notices; S74 notices,
gồm67 zoom,5 pan,2 shake. Đây là một source photo được biến đổi, không
chứng minh false-positive rate ngoài thực địa hoặc thêm80 video độc lập.

Thực thi fresh:180 CoreML detector calls, RAFT524 directions mỗi lane
(314 real +210 controls), tổng1.572 directions thực. Một model resident,
không GPU model song song. Không tính30 authored smoke,12 bounded preflight
hoặc unknown calls của failed development thành holdout execution.

| Paired product samples, ms p50 / p95 | A | B | C |
|---|---:|---:|---:|
| Clip thật mới | 711,80 /836,60 | 732,12 /979,66 | 757,69 /1.005,38 |
| Controls, có caveat tải CPU | 609,45 /1.159,64 | 677,52 /1.193,95 | 753,11 /1.376,26 |

Chi phí cộng theo từng frame rồi mới lấy percentile: detector Vision perform,
staging/shared preparation, T camera dependency và engine của riêng lane đó.
Không cộng compute các lane đối chứng thành chi phí deployed C. Startup,
independent receipt audit và whole-study wall là phần riêng; detector chỉ
đo perform nên samples vẫn là lower bounds, không live/phone latency.
Shared checkpoint chạy fixed order A→B→C, candidate hưởng warm state; không
coi đó là benchmark cold độc lập. CPU-only scoring real receipt có chồng
với phần đầu controls; controls timing có tải khác, không dùng làm speed win.
Không có hai model/GPU inference runs đồng thời. Real whole-study wall
178.287,935 ms, controls164.391,436 ms, là wall nhiều lane cộng audit/staging,
không latency của một deployed lane. C không có lợi thế latency ở lượt này.

### Chẩn đoán theo17 target-keyframes, không tuning

Root và peer cùng nối current tracks theo đúng frozen scorer: same-family
IoU>=0,35, margin>=0,08, loại duplicate assignment. Không có binding ambiguity
ở17 positives. T camera tại các checkpoint dương đều valid.

| First veto, giống nhau giữa A/B/C | Vehicle | Person |
|---|---:|---:|
| Không có current detection/track khớp criterion | 2 | 4 |
| Fresh association chưa phân biệt chắc đối thủ | 7 | 0 |
| Chưa có fresh exposure sau camera reset | 1 | 0 |
| Fresh geometry chưa đủ độ phân giải | 0 | 1 |
| Fresh grid support không đủ | 0 | 2 |

Current coverage8/10 vehicle observations và3/7 person observations. Không
đồng nhất mọi bbox-match failure với hoàn toàn không nhận ra vật: case person
gần nhất có raw IoU0,3450275, dưới criterion0,35; không đổi nhãn/gate để cứu.
City29 không có fresh source sau camera veto ở27–28. Source/current minimum
side ở ba selected geometry failures đều gặp existing18px guard (person
14,590/13,289; vehicle13,628/13,314 và17,916/18,544px), dù N>=9. Không gọi
các ca này là thiếu source seeds hoặc hạ18px để cho kết quả.

Cả11 positive observations có current match đều không có supported comparison
nào kết thúc tại đúng current row, ở cả A/B/C. Do đó số cơ hội có đủ hai pair
và growth nhưng chỉ vướng unknown rival là0/17. Bảy association-veto cases
đều có rival upper=1 hai trục, nhưng selected hypotheses của chính chúng
cũng fail:5 grid support,2 geometry. Không khẳng định xóa unknown rivals
sẽ cứu được ca nào. Unreviewed source boxes không được gán physical IDs.

### Intermediate evidence không thay user outcome

Trên cùng3.279 raw comparisons mỗi lane: supported records A42/B63/C64.
Đó không phải42/63/64 đúng vật hoặc cảnh báo đúng. B/C overlap62, C gain2,
loss1; cả ba destination frames khác biệt đều chưa review. Không dùng net+1
để quảng cáo C tốt hơn B trên target có đối chứng.

B/C source inventories giống nhau100/100 frames và157 corresponding field
hashes giống nhau giữa A/B/C. Như vậy điểm/verification là biến số được thử,
không phải checkpoint/detector/field khác nhau. Gains/losses không chứng minh
improved useful recall; giả thuyết chưa đạt trên dữ liệu thật đã đo.

### Evidence, QA và scope

- Runtime real receipt: `native/ios/.build-xcode/scene-qa/m3n-boreas-receipt.json`,
  83.630.953 bytes, SHA `a1f5c880f50a12f3c938474cd7849d29b963041107c6608b2cc1c479375423da`.
- Runtime controls receipt: `m3n-controls-receipt.json`,87.222.789 bytes,
  SHA `dbd44ee8fbf51794fd2965795a81f098d8864d2f32806b276a9820f08275d1f0`.
- Compact scores: `docs/evidence/tip65/m3n-boreas-score.json` và
  `m3n-controls-score.json`. Development100 không có completed score;
  bounded preflight và authored smoke được giữ riêng, không nhập vào totals.
- Root đã recount cả hai bộ bằng frozen target scorer độc lập với runner mới:
  totals trùng,900 fresh lane/frame checks có metres=null (5surfaces×180).
  Đây không phải900 video/events độc lập hoặc kiểm độ chính xác khoảng cách.
- Peer từng báo sai hai receipt/truth hashes trong bản tóm tắt. Root đối soát
  raw file bytes bằng Python và `shasum`; peer đã rút lại hash sai. Các giá trị
  công bố ở đây là raw-byte hashes đã đối chiếu, không bịa rằng là bản canonical
  khác. Không có source/label file thay đổi trong sự cố báo cáo đó.
- [Final structural QA](evidence/tip65/mac-readiness/runs/2026-11-16T09-07-47-581Z-9c17bf30/summary.json):
  454 Python tests,121 Swift,10 Node policy tests và TypeScript typecheck PASS,
  không failure/skip. Không cộng thêm các lần chạy lại cùng focused tests.
  Fingerprint143 files trước/sau và root-current đều
  `c4966da1a4e9128b02816167f06fdba8fb8f2eb541fb9b42b6cc8e9e1cde17b7`.
  releaseApproved=false; phone/live/range/thermal/VoiceOver physical chưa kiểm.

USER OUTCOME: source-only texture selection và deformation-aware verification
đã triển khai, có actual offline A/B/C mới; chưa tạo tính năng cảnh báo có ích.

REQUIREMENT COVERAGE: selection-before-correspondence, no threshold loosening,
raw/warped ablation, new clips/FP/FN, fail-closed, no metres, Mac-only đã kiểm
trong scope R&D. Mục tiêu useful recall chưa đạt. Không tích hợp vào app.

VALUE EVIDENCE: không cải thiện recall trên holdout; chi phí C cao hơn A/B
trong lượt này. Direct LLM/agent chưa đo lại, không gán0 human effort hoặc
khẳng định model/công nghệ dẫn đầu thị trường từ unit tests.

LIMITS + DISPOSITION: không promote/deploy/commit/cài iPhone. Giữ các source
đối chứng và case thất bại. Bước cần kiểm tiếp là đầu vào detector/bbox và
correspondence có nhãn trực tiếp, cùng điều kiện quan sát/association; không
tiếp tục vá tầng cảnh báo khi chưa có valid pair trên current positives.
Chưa chứng minh thay detector hoặc matcher nào chắc chắn giải quyết.

OVERALL STATUS: NOT READY cho cảnh báo sản phẩm. Thử nghiệm R&D hoàn tất,
không đổi gate hay labels để tạo kết quả dương sau khi xem holdout.

Disk hygiene cuối:36GiB free, không cài dependency/model mới, không project
copy hoặc thêm build directory. Các staging của failed development, bounded
preflight, real replay và controls replay đã tự dọn (prefix
`codex-tmp-assist-m3n-*`, `codex-tmp-m3n-preflight-*`); external QA scratch
`codex-tmp-scene-readiness-test-20261116-*` cũng không còn. Giữ raw data/nhãn/
receipts cần tái kiểm. 11 tracked dirty files có sẵn vẫn bảo toàn; không stage,
commit hoặc push. Root-current fingerprint sau báo cáo vẫn khớp final QA.
