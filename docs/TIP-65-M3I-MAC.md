# TIP-65 M3I: đổi phép đo chuyển động, không thêm tracker

Ngày 16/11/2026. Mac M1 Max 32 GiB, không iPhone/deploy/commit, không mét.

## TIP trước triển khai và mở holdout

Yêu cầu: điều tra nguyên nhân 21/21 lượt bỏ sót M3H, đối chiếu phương pháp
đo khác và chạy clip mới; báo cả false notice/miss, không suy ra mét.
Giữ mọi nhãn cũ và mọi veto camera/zoom/clock/epoch hiện hành.

Giả thuyết cần kiểm: (H1) phép đo similarity/đường điểm sống mãi không
phù hợp biến dạng phối cảnh, (H2) camera background disagreement là xung
đột thật hay sai biểu diễn chứ không phải thiếu texture đơn thuần, (H3)
physical range giảm không đồng nhất optical observable. Không gọi một
veto trong code là nguyên nhân đã chứng minh nếu chưa xem biến trung gian.

Điều tra chỉ replay nguồn M3H đã biết từ pixels/detection bị khóa hash;
không sửa locals/ngưỡng/nhãn. Đối chiếu toàn bộ status/events/tracks và
diagnostics trước khi diễn giải trace. Full-affine fit thử trên cùng điểm
chỉ là phép kiểm giả thuyết, không là kết quả cảnh báo mới hay cơ sở nới gate.

## Phương án được chọn và ranh giới

Không thêm ID engine, tracker hay cohort. A là M3H `CohortWindowLoom` bị
đóng băng, chạy một lần. B/C nhận **đúng cùng identity surface, track IDs,
pose, exposure, pixels** của A; không tạo ID hoặc tự thay camera gate.

- B: đăng ký vùng ảnh ECC affine hai chiều, tính biến đổi diện tích từ
  Jacobian của pixel fit thật. Đo trực tiếp ảnh mốc–hiện tại, không cộng
  dồn tỷ lệ detector hoặc nối đường điểm đã mất.
- C: fit affine từ dense flow mới mỗi cặp, đo cùng log-area để so cách
  tìm correspondence. Không dùng lại cohort seed cũ của A.
- S: tool box-only cũ, chỉ là đối chứng, không fallback sản phẩm.

Quyết định bổ sung trước development/holdout: không mặc định mọi bbox
hàng xóm đè lên ROI là occlusion vật lý. Replay M3H xác nhận 23/47 lần
thiếu flow có first failure ở phép trừ bbox khác; có cặp giữ 57/60 và
62/64 điểm qua FB/NCC/own-box rồi bị loại thêm 34/31 điểm vì hộp khác.
B/C dùng interior của chính vùng, pixel validity và photometric/cycle
support >=70% để kiểm phần quan sát thật, không lấy bbox overlap làm
visibility truth. Frozen A vẫn quyết định ambiguity/ID và camera; không
override. Thêm test overlap-hộp nhưng pixel không đổi, occluder thật thay
45% bề mặt, source ID mơ hồ và fit mâu thuẫn. Không gọi thay đổi biểu
diễn này là đã giải occlusion mọi tình huống.

Scalar là `linearLogGrowth = 0.5 * log(det affine)` và `logAreaGrowth`,
không giả làm exact angular growth, radial speed hay khoảng cách. Giãn
diện tích ảnh có thể do quay mặt/biến dạng, không tự chứng minh tiến gần
vật lý. Giữ nguyên nhãn physical approach trong scoreboard để đo thiếu sót.

B/C giữ tối đa 8 snapshot ROI thật/ID (gồm ảnh adjacent), 12 ID, ROI
<=256 working/384 native; keyframe thưa vẫn phủ cửa sổ <=800 ms. Muốn
báo cần cặp adjacent mới hỗ trợ tăng trưởng, và direct anchor 320–800 ms
đạt sàn linear-equivalent 0,04. Có cặp hợp lệ mâu thuẫn thì không báo.
Tối đa hai anchor dài + một adjacent/ID/frame; không làm anchor dài nếu
adjacent không hỗ trợ. Clock/calibration/epoch/gap/ID/camera không hợp lệ
thì xóa history tương ứng. Search initializer chỉ translation, không lấy
bbox scale làm số đo. Không hội tụ/không đủ support thì im, không coast.

## Nguồn kỹ thuật đối chiếu

| Nguồn gốc | Điều tận dụng / giới hạn |
|---|---|
| [OpenCV findTransformECC](https://docs.opencv.org/4.x/dc/d6b/group__video__track.html) và docstring OpenCV 5.0.0 đang cài | Area-based registration với affine 6 tham số, cần đúng chiều warp; có thể không hội tụ và cần khởi tạo khi chuyển vị lớn. Không lấy ECC score cao đơn lẻ làm cảnh báo |
| [Evangelidis/Psarakis 2008](https://doi.org/10.1109/TPAMI.2008.113) | ECC là họ phương pháp cổ điển, không phải model mới nhất. Tận dụng alignment có xét khác biệt brightness/contrast, không hứa bất biến mọi lighting/shadow |
| [Visual looming và surface normals](https://arxiv.org/html/2210.04108v2) | Cơ sở phân biệt flow/biến đổi ảnh với radial looming, phụ thuộc giả thiết bề mặt. Không tuyên bố code này tái lập toàn bộ công trình |
| [SEA-RAFT](https://github.com/princeton-vl/SEA-RAFT), [WAFT](https://github.com/princeton-vl/WAFT) | Đối chiếu learned-flow hiện đại, chưa chạy benchmark trong vòng này. Source mô tả môi trường PyTorch/CUDA; không mặc định hiệu năng/khả dụng trên Mac hoặc phone. Đổi flow model chưa tự sửa được camera/mô hình đo; không tải weights/deps chỉ để có tên mới |

Đây là lựa chọn thiết kế để bác bỏ trên dữ liệu, không phải kết luận ECC
vượt các công trình deep learning. Ngưỡng support/cycle/anisotropy là sàn
kỹ thuật, không phải uncertainty thống kê đã hiệu chuẩn.

## Dữ liệu mới và protocol

Development chỉ M3G/H và controls đã xem. Một thiết kế với hai phép đo,
tối đa một sửa cơ chế dựa trên development trước khóa; không quét ngưỡng
hoặc sửa theo holdout. Không đổi detector YOLOv3 FP16 hoặc frozen M3H.
Direct VLM/agent chưa đo lại, không tuyên bố vượt đối chứng đó.

M3I chọn hai anchor chưa dùng từ pose/cadence metadata, trước RGB/boxes:
`1598988939059928` (9,652 m/s trung bình) và `1598989897075981` (6,010 m/s).
Đoạn thứ nhất native 25 Hz, lấy chỉ số chẵn cố định thành 50 exposure
~80 ms/khung để tất cả baseline hỗ trợ clock. Đoạn thứ hai 50 exposure
12,5 Hz. Không trùng M3C-H, cùng recording nên không chứng minh đa miền.

Review 2D checkpoint trước mọi inference M3I, nhãn physical approach chỉ
cho scorer. Không vẽ gold từ output detector. Test FP/FN trên target-
checkpoint, unknown/unmatched/unreviewed riêng. Control static/zoom/pan/
shake từ một ảnh mới là dữ liệu dựng, đo mọi false notice toàn cảnh;
không gọi là clip thực độc lập hay dùng target-FP=0 khi target list rỗng.

Disk preflight 53 GiB free (>10 GiB). Reuse checkout/venv/model; không
copy project, build folder/venv mới hoặc inference cloud. Không thay app.
Main Contractor chạy model/holdout và kiểm evidence của Builder độc lập.

## Verify

### Causal audit trước mở holdout

[Báo cáo chẩn đoán](TIP-65-M3I-DIAGNOSIS.md) và
[trace](evidence/tip65/m3i-m3h-diagnosis.json) tái hiện chính xác 100/100
khung M3H, không sai khác chín trường được kiểm. Cả 21 reference đều
giảm norm và optical Z: không đổi nhãn để bỏ qua ca khó.

- 5/21 chưa có detection khớp; 6/21 khớp nhưng camera hiện tại bị veto;
  1/21 small/truncated; 1/21 chưa xác minh identity; 8/21 giữ identity
  nhưng không có measurement trưởng thành còn hợp lệ.
- 20/98 cặp camera bị loại, không có scale-ambiguity veto. Ở các cặp
  thất bại vẫn có 92–248 correspondence photometric hợp lý: không thể
  quy toàn bộ cho thiếu texture. Pose agreement và phân bố không gian
  mới là nơi mất support. Import K/pose/clock khớp nguồn 100/100,
  không chứng minh nguồn calibration/timing hoàn toàn đúng vật lý.
- 47 cohort-flow call thiếu support; 23 first failure từ trừ bbox khác,
  9 từ NCC, 9 đã bắt đầu dưới seed floor, 5 từ FB, 1 từ own bbox.
  Count là call lặp, không là 47 đối tượng độc lập.
- Trên đúng cặp điểm cũ, unrestricted affine đạt cùng inlier floor ở
  9/10 lần similarity thất bại. Có thêm bậc tự do nên đây là chẩn đoán,
  không phải bằng chứng affine báo đúng chuyển động vật lý.

### Development, không được tính là holdout

Mã region `bcd0219a7f7303bb533f8bc90d5a221a5efed7379235ce00b142c27257eb72d7`
và runner `bfa4109e2972cdf5f8bf33648edf99096bacfa0061a126330e1fd25cf96aa142`
đã chạy lại 100 khung H với detector cache có provenance. A tái hiện đúng
100/100 status/tracks/events/epoch cũ; B/C dùng đúng 100/100 track surface
của A. A/B/C vẫn TP=0, FN=21, FP=0, TN=3 trên checkpoint cũ. S có TP=4,
FN=17 và 11 unmatched reports. B có 6, C có 1 cảnh báo ở khung chưa chấm;
không được gọi đó là TP. B/C không là cải thiện recall đã chứng minh.

Review M3I đã hoàn tất trước mọi inference mới: 10 tile, 40 candidate,
37 target giữ lại (32 approaching, 2 not-approaching, 3 unknown).
Ba omission do không xác định được extent riêng khi occlusion/tối,
có lý do và candidate gốc giữ nguyên. Đây là assistant visual review,
không là nhãn đã được chuyên gia con người chứng nhận. Kết quả mới chưa
mở; đang kiểm nốt phép đo và proof contract trước khóa cuối.

### Khóa trước inference holdout

Không sửa thuật toán sau development: probe kiểm giả thuyết NCC trước
affine đã tái hiện 100/100 C events và xét 86 call bị thiếu flow. 66/86
đã thiếu FB/own-mask support; 20 còn lại vẫn không qua cùng affine và
aligned-NCC floor. Không có cặp nào được cứu khi chỉ đổi bước đó. Do vậy
không bỏ gate, không nới ngưỡng, không thêm tracker.
Đây là bounded read-only probe do Builder báo cáo; không giữ một receipt
runtime mới cho phép thay thế đó và không tính nó là benchmark độc lập.

QA đối kháng phát hiện và sửa proof tooling (không thay runtime): receipt
bị sửa ECC correlation, anisotropy, rotation hoặc camera-invalid anchor
origin trước đây có thể qua scorer. Đã thêm kiểm và regression, giữ
first-frame origin hợp lệ và subset support >=70%; P90 toàn seed vẫn
chỉ diagnostic. Main chạy độc lập runner tests 13/13 đạt trước khóa.

Khóa cho mọi inference M3I, không chỉnh theo kết quả:

- Region SHA-256: `bcd0219a7f7303bb533f8bc90d5a221a5efed7379235ce00b142c27257eb72d7`.
- Runner SHA-256: `65975246ddbd975b58b0f4089a328e0aa26de76ef9c82408edbf7553006f457b`.
- Nhãn 2D: [bản đã kiểm trước inference](evidence/tip65/m3i-boreas-reviewed-2d.json).
- Input thật SHA-256: `67d0b9841623f3f177f8a2bb6e8ee95d701f7d81b7b19e2353643073d39397dd`.
- Input controls SHA-256: `20c8d7d818a424d23d436b88466814f38a4f4572504f444f42f93145de5098ad`.

Controls tái sử dụng generator cũ nên prefix clip vẫn `m3h-control-*`,
nhưng ảnh gốc, token và input hash thuộc nguồn M3I mới. Không gọi đây
là các cảnh thực độc lập; danh sách target rỗng nên chỉ thống kê false
notice toàn cảnh, không tính tỷ lệ FP trên mẫu số target bằng 0.

### Kết quả holdout đã khóa

Main chạy 180 exposure với **mô hình CoreML thật trên Mac**, không cache:
100 khung từ hai đoạn Boreas chưa dùng, 80 khung controls dựng từ ảnh
M3I mới. Detector, ID owner, pose, clocks và policy giống nhau giữa A/B/C.
Không chỉnh code/nhãn sau khi mở kết quả. Hash toàn bộ dependency trong
cả hai receipt khớp file hiện hành và khớp nhau; tracks/epoch B/C giống
A ở cả 180/180 khung. Scorer kiểm 720 lane surface không phát số mét.

| Phép đo | TP / 32 approaching | FN | FP / 2 negative thật | False notices / 80 control frames |
|---|---:|---:|---:|---:|
| A: M3H đang có, không đổi | 3 | 29 | 0 | 0 |
| B: ECC affine vùng ảnh | 1 | 31 | 0 | 0 |
| C: dense-flow affine vùng ảnh | 1 | 31 | 0 | 0 |
| S: box-only, chỉ diagnostic | 10 | 22 | 0 | 28 |

Controls của S: 24 notice ở zoom, 4 ở pan, 0 ở static/shake. Count là
notice, không phải 28 clip hoặc 28 khung độc lập. Cả A/B/C im trên 80
control frames. Chỉ hai target negative thực nên **không** suy ra hệ
thống có độ an toàn/precision cao. S bắt nhiều hơn nhưng có 28 báo sai
trên controls; không bật fallback box-only để che FN.

Có 3 target unknown ở cảnh thực. Tại checkpoint, unmatched reports là
A=0, B=2, C=1, S=6; chưa kết luận thật/sai vì nhãn không exhaustive.
Ở các khung không chấm, số notice tương ứng 29/39/15/130: không tính TP,
không im lặng bỏ chúng để tuyên bố FP tuyệt đối bằng 0.

Posthoc độc lập, phân loại đủ 32 positive của B/C:

[Audit từng target](TIP-65-M3I-HOLDOUT-AUDIT.md) được Main đối soát lại
độc lập bằng raw receipt/truth: cả 32 hàng và mọi category tổng khớp.

| First current category | B | C |
|---|---:|---:|
| Bắt đúng theo scorer | 1 | 1 |
| Không có detection cùng family khớp IoU >=0,35 | 13 | 13 |
| Source camera hiện tại veto | 0 | 0 |
| Small/truncated | 1 | 1 |
| ID hiện tại mới/chưa xác minh | 3 | 3 |
| Fresh pixel measurement bị loại | 7 | 8 |
| Chưa có anchor đủ 320 ms | 2 | 2 |
| Mọi long-anchor đã thử đều bị loại | 5 | 4 |

Không được quy 31 FN mới chỉ cho camera: current camera hợp lệ tại các
positive checkpoint có detection khớp. Camera reset ở lịch sử vẫn có thể
làm thiếu cửa sổ. 13/32 không có detection khớp là giới hạn quan sát, còn
fresh/long correspondence vẫn là bottleneck trực tiếp của phép đo mới.

### Công thực thi, độ trễ và giới hạn giá trị

Không tải model/dependency mới, không gọi cloud/API trả phí. Tái sử dụng
YOLOv3 FP16 đang có để cô lập thay đổi measurement; không giả đây là
detector mới nhất. Tool baseline S đã đo; direct LLM/VLM/agent chưa đo
trong vòng này, không tuyên bố hơn các baseline đó hoặc learned flow.

Trên 100 khung thật, per-exposure service sample cộng detector inference
đã đo + shared prep/decode + A và B/C tương ứng **trước khi lấy percentile**:

| Lane | p50 ms | p95 ms |
|---|---:|---:|
| A | 167,97 | 252,39 |
| B (bao gồm A identity owner) | 319,71 | 547,00 |
| C (bao gồm A identity owner) | 236,70 | 368,16 |
| S | 102,80 | 127,86 |

Không cộng các p95 riêng lẻ. B/C chưa tách riêng phần cohort cũ của A nên
đây là candidate adapter cost thực sự đã chạy, không phải chi phí của một
identity-only engine tương lai. Median native JPEG decode khoảng 73,36 ms;
không gọi đó là latency của camera app. Study wall hai clip là khoảng
20,03 và 31,44 giây, chạy bốn lane tuần tự, gồm staging. Sample table không
gồm startup/staging/queue/UI/audio và không là end-to-end hay phone FPS.

**Quyết định: REJECT PROMOTION / NOT READY.** Giữ A, B/C chỉ research
adapter và runner riêng, không tích hợp app mặc định. Thay similarity bằng
affine vùng ảnh trong thiết kế này chưa chứng minh cải thiện, còn chậm hơn.
Giá trị vòng này là xác định nguyên nhân, thử bác bỏ hai phương án, khóa
scorer chống proof giả và tránh đưa một regression vào sản phẩm.

Hướng kế tiếp phải là kiểm camera compensation và chất lượng correspondence
trên ROI đối chứng theo từng tầng (detector, identity, fresh fit, long fit),
đối chiếu một phương pháp correspondence khác với A/S. Không thêm tracker
hoặc cứ kéo tuổi ID để thay tuổi phép đo. Chỉ được promote khi vượt A trên
clip **mới khác M3I**, giữ sàn FP, recall và latency; không chỉnh theo holdout
này rồi gọi chính nó là bằng chứng khái quát hóa.

### Artifact và tái chạy

- [Score clip thật](evidence/tip65/m3i-boreas-score.json),
  [score controls](evidence/tip65/m3i-controls-score.json),
  [score development](evidence/tip65/m3i-development-score.json).
- Raw receipt thật: `native/ios/.build-xcode/scene-qa/m3i-boreas-receipt.json`,
  SHA-256 `49c320389f9d454973082b0a20650719fd20ad6aa94cd8d9fa5ae66a643532e6`.
- Raw receipt controls: `native/ios/.build-xcode/scene-qa/m3i-controls-receipt.json`,
  SHA-256 `a4cf765f333efc6191c80af68b49374fa24c39b0747cadaa830cd8a3a7ad0a9f`.
- Thực thi bằng venv SceneQA đã có, runner `scripts/assist_scene_m3i_study.py`:
  `replay --input … --sceneqa …/sceneqa --yolo …/YOLOv3FP16.mlmodelc --output <new-path>`;
  `score --input … --truth …/truth-reviewed.json --receipt … --output <new-path>`.
  Controls dùng `m3i-controls/input.json` và `m3i-controls/truth.json`.
  Output path phải mới; không ghi đè evidence cũ. Input/schema kiểm clocks,
  source hashes, model/executable hashes, policy/algorithm fingerprints.

### Completion / Verify cuối

[Full regression receipt](evidence/tip65/mac-readiness/runs/2026-11-16T05-26-58-157Z-af2a1f9f/summary.json):
246/246 Python, 121/121 Swift, 8/8 readiness-policy tests đạt; TypeScript
`--noEmit` đạt, `git diff --check` đạt. Fingerprint 107 source files giữ
nguyên trước/sau QA: `9a0fe2d91be2e0d5b4a62807b27384e7496eae687c23db3d42efb9e6d7db49de`.
Đây là structural regression, không chứng nhận chất lượng model/recall,
camera thật, dẫn đường hoặc thermal. `releaseApproved=false` giữ nguyên.

Main kiểm lại trace độc lập đã lưu trước đó so với audit cuối: cả frames,
cases, replay, category, reason và measurement-call traces giống nhau;
100/100 replay, 21 case, không mismatch. Main kiểm lại development bằng
scorer đã harden, totals không đổi. Main xác minh 180 model calls thật,
720 no-metre contracts, frozen code và identical identity surfaces của
cả hai receipt mới; không dựa riêng vào báo cáo của Builder.

Không iPhone, không deploy/commit/push,
không sửa app, không bảo đảm an toàn dẫn đường. Nguồn R&D ~426 MiB và
controls ~72 MiB giữ có mục đích trong folder SceneQA đã có; mọi staging
`codex-tmp-assist-m3i-*` đã tự dọn, không còn scratch copy/build/venv mới.
Không xóa dữ liệu tính năng hoặc bản build khác. Dung lượng trống cuối
khoảng 52 GiB. Báo cáo hoàn tất thí nghiệm và chẩn đoán, **không** báo
hoàn tất mục tiêu sản phẩm nhận biết tiến gần đáng tin cậy.
