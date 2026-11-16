# TIP-65 M3L: đo trực tiếp từ ảnh thật, không phụ thuộc tuổi ID

16/11/2026. Contractor dùng Vibecode Kit v6.3. TIP trước inference và
trước xem RGB của holdout mới. Mac M1 Max32GiB; chưa cần iPhone.

**Kết luận sau thử nghiệm: PARTIAL / NOT READY.** Đã xác định nguyên nhân,
triển khai và đối chứng phương pháp khác, nhưng chưa đạt mục tiêu tốt hơn.
Trên clip mới DIS/RAFT cùng4TP9FN, candidate0TP13FN; không promote hoặc
thay app. Phần lớn candidate bị policy competitor budget chặn trước đo,
không được suy thành bằng chứng mọi registration method đều kém.

## Outcome và giả thuyết có thể bác bỏ

Người dùng giao deep dive21/24 bỏ sót M3K, đối chiếu phương pháp khác và
triển khai giải pháp tốt hơn, không chỉ tăng tốc RAFT. Đo FP lẫn FN trên
clip mới; thiếu bằng chứng không báo; không suy ra mét. Không commit,
deploy, cài app, gửi ảnh lên cloud hoặc mua API trong lượt này.

M3K bestC có3/24 TP,21FN; baselineDIS1/24. Cả old/new detector có19/24
qualifying positive overlaps. RAFT chỉ đổi field, vẫn cần ID và cùng cohort
điểm tồn tại liên tục320–800ms. Đây là bottleneck cần kiểm thực tế từng ca,
không kết luận mọi FN do cùng một nguyên nhân. Một diagnostic tool giữ
đủ24 positives, source clock và reference hash, tách C/D và không đưa gold
vào inference. Không nội suy projected GT vào những frame không có nhãn.

Candidate: timestamp-indexed snapshot bank và registration trực tiếp đa tỉ
lệ. Nó kiểm lại pixels của mỗi cặp ảnh thật, không cộng tuổi ID/nhóm điểm,
không nối transform hoặc coi detector bbox lớn lên là phép đo. Phải chứng
minh hơn frozenRAFT/DIS trên dữ liệu mới; nếu không, không promote.

## Đối chiếu phương pháp và nguồn

- [OpenCV template matching](https://docs.opencv.org/4.x/d4/dc6/tutorial_py_template_matching.html)
  và [ECC affine registration](https://docs.opencv.org/4.x/dc/d6b/group__video__track.html):
  dùng tìm kiếm pixels đa tỉ lệ làm initializer cho affine thay translation-only
  initializer đã yếu ởM3I. Correlation cao không tự chứng minh cùng vật hoặc
  tiến gần. Grid là kiểm pixels riêng, không gọi held-out nếu đã dùng pixels
  đó cho optimization. Có [upstream issue về scale bias](https://github.com/opencv/opencv/issues/29774);
  phải kiểm phép đo bằng authored ground truth, không mặc định ECC không sai.
- Affine flow/divergence không tự chữa dependency vào cửa sổ thời gian.
  M3I đã thử direct dense-flow affine/ECC; không đổi tên cơ chế cũ thành mới.
  [Looming và surface normals](https://arxiv.org/abs/2210.04108) phân tích
  quan hệ flow/looming với điều kiện hướng bề mặt. Không đồng nhất projected
  surface expansion với radial closing, self-motion, distance hoặc TTC.
- [LightGlue upstream](https://github.com/cvg/LightGlue) vẫn cần local features;
  matcher không tự tạo những keypoints màSIFT thiếu. Code/weights LightGlue
  Apache2, SuperPoint gốc có điều kiện khác; không gom mọi thành phần thành
  một giấy phép. [LoFTR](https://github.com/zju3dv/LoFTR) là detector-free
  matcher khả dĩ nhưng ROI context, quyền checkpoints và latency Mac chưa đo.
  Chưa tải/chạy hai model này; không tuyên bố template là SOTA hay tốt hơn chúng.

Khác biệt cần kiểm so vớiM3I/J: snapshot không còn thuộc persistent ID;
không cần5 lần cùng corner sống liên tục; mỗi direct pair có certificate
riêng và kiểm pixel hai chiều. Đây là thay đổi hợp đồng phép đo được ghi
rõ, không âm thầm hạ gate rồi tuyên bố thuật toán cũ tốt hơn.

## Blueprint nhỏ nhất, phân vai

- Builder diagnostic:2file mới `diagnose_assist_scene_m3k_misses.py` và test.
- Builder measurement:2file mới `assist_scene_direct_window.py` và test.
- Builder runner:2file mới `assist_scene_m3l_study.py` và test.
- Contractor: nguồn/kiến trúc/nhãn/TIP, chạy thật, kiểm lại và báo kết quả.
  Không tự gọi tác giả là human reviewer độc lập.

Reuse frozen M3H/DIS, M3K/RAFT, snapshots/common coordinates/grid củaM3I,
scoring IoU0,35 và ambiguity margin0,08. Mọi file inference cũ giữ nguyên.
Không thêm tracker, không coast warning, không chuyển ID thành evidence.

| Lane | Same shared old YOLO detections | Measurement |
|---|---|---|
| A | có | frozen DIS cohort |
| B | có | frozen RAFT cohort (M3K.C) |
| C | có | direct multiscale registration, snapshot bank |
| S | có | bbox diagnostic, không fallback |

C dùng A chỉ để lấy camera status/epoch/current tracks và current handles;
không dùng A cohort, age, growth hay alerts. Output tracks/epoch phải đúngA.
Snapshot keyed timestamp/token/rawdetectionindex, không keyed current ID.
Mỗi snapshot giữ ảnhROI thật<=384, masks, K/pose, mapping và source hashes.
Cadence160ms, horizon800ms, tối đa7timestamp×12crops; previous raw exposure
được giữ riêng để kiểm current motion, không gọi snapshotcadence là FPS.

Camera/zoom/clock/gap/geometry veto cũ giữ nguyên. Epoch đổi hoặc camera
veto phải xóa bank, không nối qua cảnh không chắc chắn. Current detection
vắng thì không có warning. Không dùng width/height detector để init scale
hoặc làm phép đo growth; bbox chỉ giới hạn vùng tìm và kiểm consistency.

Mỗi anchor so current bằng tìm kiếm17logscales[-0,4;0,4], rotations[-10,0,10]
sau camera-rotation compensation, rồi ECCaffine forward/reverse có budget.
Same-class mutual unique matching, margin0,08; localpeak margin0,04 ngoài
basin gần tương đương được pin trong code. Tối đa3 eligible competitors
sau spatial/pose gate; quá cap phải abstain, không vứt competitor bất lợi.
Pin actual pair/search/ECC counts và certificate trước development.

Giữ pixel floors:>=9points,>=70%support,NCC>=0,70,cycle<=1,3px, own actual
interior/span/hull, positiveJacobian, |logscale|<=0,40,anisotropy<=0,20,
rotation<=15°,box-disagreement<=0,12. Không gọi score model là accuracy.
Ba real timestamps: oldest eligible anchor320–800ms, fresh previous actual
exposure12–300ms, current. Cả long và fresh pair phải supported; longnet
>=0,040,fresh>=0,0005; contradictory supported evidence veto. Không chọn
positive winner sau khi thử anchors. Không mượn age hoặc point denominator.

## Dữ liệu, budget và điều kiện dừng

Development dùng99M3K exposures đã mở. Reuse chính xác rawM3K receipt
model/exe/source/code/config hashes và audit: A=oldA,B=oldC,S=oldS,
detector outputs thật. Chỉ chạyC mới; old timing phải ghi historical.
Tối đa một repair cơ chế có evidence trước holdout, không threshold sweep.
Nếu authorsynthetic scale/static/occlusion/ambiguity tests không đạt,
không chạy một full trial để lấy zero-alert thành thành tích.

M3L holdout chọn metadata trước RGB: start1598987519026635 và1598987778079070,
50exposures mỗi đoạn,~9,143/8,779m/s trung bình. Cửa sổ4s không overlap
M3C–K đã lưu, cùng recording nên không chứng minh độc lập miền/objects.
Không tìm đoạn đẹp sau khi biết outputs.10 reviewtiles cố định, giữ ca nhỏ,
tối và bị che nếu còn visible extent; omission phải có lý do trước inference.

Controls80frame từ một ảnhM3L, static/zoom/pan/shake20mỗi ca, authored,
không4video thực độc lập. Real100+controls80=180exposures; actualoldYOLO180
calls, RAFT cap4320directioncalls cho toàn180frames. C có bound theo policy
và actual count; fail loud nếu vượt, không giả lập model hoàn tất. Chạy GPU
tuần tự, không benchmark lúc chạy QA nặng. Max30min mỗi replay, không lặp
chỉnh policy theo holdout; giữ intermediate và báo chưa hoàn tất nếu timeout.

Chấm TP/FN,FP/TN,unknown,ambiguous/unmatched/unreviewed riêng; controls
đếm allSceneFalseNotices, không lấy FP0/0 thành precision. Phải có số thực
và camera-negative controls, source/policy hashes và timing end-to-end sum
trước percentile. Không lấy test xanh chứng nhận semantic hoặc iPhone.

Baseline direct LLM/tool-agent chưa đo cho task/clock này; S là deterministic
tool baseline. Không claim hơn VLM/agent/cloud. Useful improvement phải giảm
misses mà không che phần báo nhầm/unknown và có cost dùng được. Không hứa
21FN đều phục hồi: detection absent, pixel ít, deformation, occlusion vẫn veto.

## Completion / Verify

### Diagnosis trước thử candidate

Root chạy diagnostic thật từ raw frozen receipt, input/truth hash khớp,
10tests đạt. Đủ24 positive cases mỗi lane, không chỉ giữ các failure dễ sửa.

| Phân loại21FN, theo ưu tiên veto hiện tại | M3K.C | M3K.D |
|---|---:|---:|
| Không có mature cohort được hỗ trợ |7|5|
| Không có current qualifying detector overlap |5|5|
| ID mới |3|4|
| Current global camera veto |4|4|
| Cohort disagreement |1|2|
| Nhỏ/truncated |1|1|

Có current target-attributed pixel support nhưng lifecycle bị gián đoạn
ở4 C-misses/3 D-misses. Không gọi chúng là những ca đã được cứu. Có10/11
ca có same-family detection ở mọi source-GT sample đã quan sát nhưng
vẫn thiếu lifecycle proof; các exposure không có GT vẫn UNKNOWN, không
nội suy thành dense truth. M3K không lưu failed numeric growth nên21/21
FN chưa thể phân biệt chính xác sub-floor, negative growth, noise hay
box contradiction chỉ từ receipt. Root giao một QA reconstruction riêng:
wrap phương thức frozen để ghi trả về thật, không đổi gate, bắt buộc
mọi output C phải tái lập nguyên bản. Chưa gọi đây là root cause số học.

[Diagnostic artifact](evidence/tip65/m3k-miss-diagnosis.json) là posthoc,
không đầu vào runtime và không phải ground truth cho inference.

### Blind reference M3L

Root xem đủ10tiles trước mọi M3L inference:19 target-keyframes giữ lại,
13approaching,4not-approaching,2unknown. Một positive person bị whitevan
che hoàn toàn bỏ trước modelrun, ghi nguyên nhân và giữ originalcandidate;
không tính thành abstention thành công. Dark và sensor-truncated visible
vehicles vẫn giữ. Đây là assistant review, không human certification.
Input SHA `c08ee5c9b42dd9bb1befc1325987e615107577635447c74045302d2823afecd4`;
reviewed truth SHA `10aabdf34600b9d9cc291c617a8680b2dbafd054d032b2c65a78410c057742c0`.

Ghi công: Boreas, ASRL/UTIAS/University of Toronto và đồng tác giả,
[bài công bố](https://arxiv.org/abs/2203.10168),
[CC BY4.0](https://github.com/utiasASRL/pyboreas/blob/master/DATA_LICENSE.md).
Lát cắt local143files372.490.967bytes; không full dataset, không phân phối
ảnh gốc, không ngụ ý tác giả chứng thực. Pose thật là một đầu vào đặc thù
trial, không giả định điện thoại có pose chất lượng tương đương.

### Tái dựng số học thật và nguyên nhân đã xác nhận

Root chạy riêng frozenM3K.C trên99 exposures cũ, reuse detections thật,
actualRAFT588directioncalls,0detectorcalls,114,24s. Wrapper chỉ ghi dữ liệu
trả về và phép kiểm số học thuần, không đổi estimator/gate. Toàn99 surfaces
và field traces tái lập nguyên bản (trừ wall timing). Không dùng nhãn khi
reconstruction.9 authored tests của tool đạt trước khi chạy thật.

265 cohort-measurements toàn stream gồm202 warming,27 unsupported,36
supported. Không coi265 thành265 reviewed targets. Posthoc join giữ24
positive target-keyframes,21FN; root tự tính lại từ raw reconstruction:

| Trạng thái measurement ở21FN | Số ca |
|---|---:|
| Không có current track khớp |5|
| Có current track nhưng không có cohort measurement |11|
| Chỉ có warming measurements |4|
| Có mature numeric growth, bị cross-cohort veto |1|

Như vậy20/21 chưa có mature numeric decision ở vật được đối chiếu, không
thể nói chúng đều do RAFT đo growth quá yếu. Ca mature duy nhất urban35,
track145: cohorts108/118 đã confirmed positive, nhưng cohort131 trẻ321,48ms
có robustBoxGrowth=-0,018211 (pixel/currentgrowth vẫn dương) phủ quyết cả
cảnh báo. Không gọi đây là lý do được phép nới gate; candidate phải đưa
ra current direct-pixel certificate thay cho việc chọn cohort thuận lợi.

[Báo cáo diagnosis](TIP-65-M3L-DIAGNOSIS.md) và
[join đủ24cases](evidence/tip65/m3k-growth-miss-join.json).
Reconstruction SHA `31d2f37fd50d065f9f3f40a0fb2ebd5e16b35d0eb621e274d73a3300f80dd821`;
tool SHA `54838fbc32972ff18afba85a20989da75764bd139cac6ec3a83c8b83e2705515`.

### Preflight candidate, không semantic acceptance

Root chạy15/15 authored-pixel/structural tests đạt. True pixels tăng scale
và ID thay mỗi frame vẫn tạo chứng cứ; tại400ms measuredlonglog0,0616 so
authored0,0700. Ba real exposures0/240/320ms cũng được kiểm, không fake5
frame history. Static detector-only growth, lookalikes, periodictexture,
occlusion, missingdetection và camera/clock/epoch veto đều có regression.
Đây không phải real-video accuracy hoặc model safety certificate.

Independent review phát hiện rival ambiguity: một eligible competitor
correlation cao nhưng chưa phân giải không được biến thành score-1 rồi
gọi winner chắc chắn. Đã sửa trước development bằng upper bound correlation
cho chiều chưa biết; matching độc lập với growth/ECC-success và regression
được thêm. Không đổi thresholds theo holdout.

Candidate freeze SHA `101e2934f5fdd368993c55881910c1b173cad3828f079c12ece16169cc8290cd`.
Runner v1 SHA `86af251c66bc4639909b634a8eed377631e921b56a4ef68e4a8c37798424cb66`,
10/10 tests root chạy độc lập đạt; source cạnh tranh/currentbox/pinnedbank
được review riêng. Không coi tác giả test là independent human semantic QA.

### Development v1 và đúng một repair trước holdout

ActualC-only99old exposures, reuse exact M3K A/B/S historical surfaces:
C1TP23FN, soB3TP21FN;A1/23. C1unmatched,3unreviewed-frame reports.
Không gọi đây là cải thiện. C wall115,99s, replay138,31s. C paired p50
1365,47ms gồm A dependency, old detector timing historical, không phải
end-to-end realtime. Không phát sinh detector hoặc RAFT calls mới.
[V1 score](evidence/tip65/m3l-pre-repair-development-score.json), raw receipt
`scene-qa/m3l-development-receipt.json` SHA
`05d2799da27a59ed8d171df7eb8228b13340114901759e136b0f089de39f6750`.

548directpairs:223forward/reverse coarsepeak ambiguities,100supported pairs;
supported pair không tự là đủ3timestamp warning. Diagnostic chỉ2OLDpairs
CPU, không GPU/holdout: traffic20 NCC best0,94916874 và rival0,91045702,
margin0,03871173, hai coarselogscales±0,05. Sau ECC, finefits chỉ khác
0,04411089px trên verificationgrid, joint50/61>=70%. Đây là bằng chứng
coarse initialization có thể tự tạo false ambiguity trước optimizer.
Urban35 vẫnkhác1,37449006px, joint30/63<70%, phải bị từ chối.
[Structured probe](evidence/tip65/m3l-coarse-alias-probe.json) có đầy đủ
source/receipt/code hashes và actual affine arrays, không dựa vào bản chép
tay các tham số. Không dùng hai ca để tuyên bố whole-window recall tăng.

Root cho phép đúng một repair cơ chế trước holdout, không sweep thresholds:
refine ALL distinct coarse modes nằm trong margin0,04, tối đa3/direction;
nếu nhiều hơn phải veto, không chọn3nghiệm thuận lợi. Merge chỉ khi mọi
fine mode hội tụ<=0,5px và loggrowth span<=0,005, mọi oldshape/grid/NCC/
cycle/support floors giữ nguyên. Tối đa6ECC calls/pair. Fresh/long gate
kiểm LOWER envelope của mọi forward và sign-corrected inverse reverse
growth, không chọn point estimate dương nhất. Envelope không phải
calibrated confidence interval. Urban counterexample phải tiếp tục fail.

Đã giữ đúng byte4v1source/test files (104KiB) trong
`docs/evidence/tip65/m3l-pre-repair-source/`, không whole-project/build/model
copy. Dependency sources cũ vẫn đúng SHA. Có thể tái lập v1 bằng đúng4file
này cùng frozen dependencies/model/input; archive không phải build độc lập.
Sau repair chạyC-only development một lần nữa rồi freeze. Không sửa theo
M3L holdout dù kết quả không tốt. Chưa có claim cải thiện.

### Repaired freeze trước holdout

Candidate SHA `5c0854542e03e70959ac012a483596e10a1259b57ca7d0a1ccecbf207e98f1bf`;
runner SHA `14de9667f42fed6194c8f33e5a7ef97604dede03ba57ee6f3fb1b32b899670c0`.
Root độc lập chạy18candidate và12runner tests đều đạt. Runner tự tính
lower/upper từ ALL forward loggrowth và ALL NEGATED reverse loggrowth,
không tin envelope được cung cấp. Pair/association/currentdetector/pinned
anchor checks và originalcamera authority giữ nguyên. Three-mode overflow
và unsearched high-score remainder phải veto; không chọn nghiệm thuận lợi.

Một oldtraffic pair authorized được kiểm lại thật:2forward+1reverse modes,
3actualECC calls,50/61support, full BOTH-direction growth envelope
[0,03250554;0,03346061]. [Repair check](evidence/tip65/m3l-coarse-alias-repair-check.json).
Không gọi kết quả một cặp thành whole-window success.

ActualrepairedC-only99exposures: vẫnC1TP23FN,FP0/TN1,1unmatched,
4unreviewed-frame reports. B historical3TP21FN; A1TP23FN. Không có semantic
recall gain ở development. Root không đổi thêm policy, không tăng competitor
cap hoặc đổi selection rule sau kết quả này. [Repaired development score](evidence/tip65/m3l-development-score.json),
raw `scene-qa/m3l-repaired-development-receipt.json`. Chạy holdout đã chọn
để hoàn tất đối chứng, không mặc định promote failed candidate.

## Completion / Verify cuối

### Kết quả trên clip mới

100 original exposures,10 reviewed checkpoints,13positive target-keyframes,
4negative và2unknown. Những lượt theo khung có tương quan thời gian, không
phải13objects độc lập. Cùng nguồn/pose/boxes cho mọi lane, không đổi input,
label,policy hoặc source sau repaired freeze. Nhãn do assistant kiểm qua
ảnh trước inference, không phải human certification hoặc official test set.

| Lane | TP | FN | FP | TN | Unmatched | Unreviewed-frame reports |
|---|---:|---:|---:|---:|---:|---:|
| A: DIS cohort |4|9|0|4|6|37|
| B: RAFT cohort |4|9|0|4|4|35|
| C: direct registration |0|13|0|4|0|0|
| S: bbox diagnostic |11|2|1|3|24|300|

Unknown targets2, không lane nào báo trên unknown; không report ambiguity
ở checkpoints. Root đối chiếu full matching graph: A/B cùng đúng4 target-
keyframes, không có A-only hoặc B-only TP trên lát này. Điều đó không xóa
được M3K trước nơi RAFT có paired gains. Không suy từ4negative thành độ
chính xác báo giả cao; unmatched/unreviewed vẫn chưa đủ gold để phân loại.

Root tự tính lại13positive đều có current qualifying detector/track overlap.
Candidate C im100/100frames. First veto ở13misses:

| Veto hiện tại | Số lượt |
|---|---:|
| Current insufficient-background-agreement |3|
| Fresh appearance competitor budget |9|
| Long anchor không có eligible object |1|

Chín budget refusals quan trọng: cap3competitors được pin để giới hạn
compute, không phải phép đo chứng minh vật không tiến gần. Không lén
nâng cap hoặc chỉnh spatial gate sau khi xem holdout. Kết quả bác bỏ
whole workflow hiện tại trong cảnh nhiều vật, không chứng minh thuật toán
registration sẽ thất bại nếu được đo đầy đủ. Tăng cap đơn thuần có nguy cơ
làm brute-force matching thànhO(n²) và đắt hơn nữa; chưa đo biến thể đó.

Actual100shared detector calls,748RAFT direction calls;27directpairs,
10supported pairs,49ECCcalls. Pair supported không đủ current3timestamp
notice. Replay wall265,89s cho cả nhiều lane tuần tự, không là runtime
một sản phẩm realtime. Không có nguồn ảnh mới hoặc điều chỉnh sau kết quả.

### Negative controls và hiệu suất

80frame authored từ một ảnh nguồn mới: static/zoom/pan/shake20mỗi ca,
không4video thực độc lập. A/B/C đều0all-scene false notices; S44false
notices (zoom38,pan6). C cũng bỏ sót toàn bộ positive holdout nên sự im
lặng này không phải quality advantage. Không tính precision từFP0/0.

| Paired product sample (ms) | A | B | C |
|---|---:|---:|---:|
| Real p50 |297,96|2349,03|311,83|
| Real p95 |363,86|6324,17|972,23|
| Controls p50 |179,69|1493,37|4395,48|
| Controls p95 |212,24|3557,66|5661,23|

Tính sum từng sample trước percentile. C gồm detector+prep+A+C, B đã
gồm RAFT nên không cộng flow hai lần. Shared old CoreML perform-only
timing bỏ request setup/parsing nên là lower bound; offline staging/decode
cũng khác live camera. C có vẻ nhẹ trên real chỉ vì phần lớn không chạy
được comparisons do budget veto. Khi thật sự đo nhiều ở controls, C rất
đắt. Không lấy nghịch đảo bảng này thành FPS iPhone hoặc claim realtime.

Actualcontrols80detectorcalls,1128RAFTdirections,855directpairs;
replay382,08s. Tổng fresh180detectorcalls và1876RAFTdirections dưới cap
4320. Không GPU worker song song, không benchmark khi chạy regression.
Development baselines/cache timings là historical, không gọi inference mới.

### Phạm vi đạt và quyết định

| Yêu cầu | Kết quả |
|---|---|
| Deep dive21/24 với số học thật | Đạt trong frozenM3K.C, không suy sang D |
| So phương pháp khác, triển khai trên Mac | Đã thực thi direct-registration candidate và một repair có evidence |
| A/B clip mới, báo nhầm và bỏ sót | Đã đo đủ, giữ cả unknown/unmatched/unreviewed |
| Thiếu chứng cứ không báo, không suy mét | Đạt các contract checks đã nêu |
| Chất lượng tốt hơn baseline | **Không đạt** |
| Realtime/iPhone/commercial safety | Chưa thử, không claim |

**REJECT PROMOTION.** Candidate để ngoài app. Không thêm tracker, không
nới pixel/camera gates, không OR alerts để chọn nghiệm thuận lợi. Giữ
baseline cũ; trên lát M3L, DIS đơn giản có cùng true-positive set với RAFT
và chi phí thấp hơn. Không kết luận DIS luôn hơn RAFT ở mọi scene.

Bước nghiên cứu hợp lý cần kiểm riêng: correspondence toàn khung ảnh cho
mỗi cặp nguồn thật, rồi gán các matches cho objects thay cho brute-force
ROI pairs/cap3 khiến cả cảnh bị từ chối. Có thể đối chiếu learned matcher
với fixed-lag dense field, giữ current pixel validation/ambiguity/camera
certificates và metricFP/FN. Đây là giả thuyết tiếp theo, **chưa triển khai
hoặc chứng minh tốt hơn**, không coi đổi model tự chữa thiếu maturity.

Nguồn mới kiểm thêm: [EfficientLoFTR](https://github.com/zju3dv/EfficientLoFTR)
có triển khai semi-dense matching, nhưng [LICENSE hiện hành](https://raw.githubusercontent.com/zju3dv/EfficientLoFTR/main/LICENSE)
là PRLv1, yêu cầu đăng ký trước Project Use của tổ chức, kể cảR&D/testing.
Không mặc định Apache2 từ kiến thức cũ hoặc model mirror. Root chưa đăng
ký, tải hay chạy model này. Không gửi contact/project details thay người
dùng. Cần kiểm quyền checkpoint hoặc chọn alternative có quyền phù hợp
trước thử nghiệm tiếp; không hứa tốc độ/tính chính xác từ paper trên Mac.

### Technical health và audit trail

Full `npm run qa:assist-scene-mac -- --typecheck` PASS:380Python tests,
121Swift tests,8Nodepolicy tests,TypeScript sạch. Không skip. Đây là
structural QA, không380field scenarios thành công. [QA receipt](evidence/tip65/mac-readiness/runs/2026-11-16T07-37-26-257Z-458e26af/summary.json)
ghi `releaseApproved=false`, semantic/phone acceptance chưa đạt.

Root sau QA tái score repaireddevelopment/real/controls từ đúng rawreceipt,
input và truth: mọi totals/code hashes khớp savedscore.1116lane/frame
no-metre checks (396dev+400real+320controls), không tính thành1116video
độc lập. Baselines dev reused được khai báo, không đếm inference mới.
Source fingerprint129files trước/sau QA và root kiểm lại:
`58fdb4e9eab4def1dcfe2c7146aa0d21740587a411a358ae52cc36b84c1146f1`.
Không thay frozenM3H/M3K/region algorithms trong lượt này. B trace vẫn
chỉ frame-level field attribution; C cảnh báo có actual pair/index/source
membership và full competitor/selection checks, không giả vờ đã rerun
pixels trong scorer. Direct LLM/tool-agent outcome baseline chưa đo.

- [Repaired development score](evidence/tip65/m3l-development-score.json).
- [New real score](evidence/tip65/m3l-boreas-score.json).
- [Controls score](evidence/tip65/m3l-controls-score.json).
- Raw receipts ở `native/ios/.build-xcode/scene-qa/m3l-*-receipt.json`;
  reconstruction và24case numeric join đã link ở trên.
- CLI: `assist_scene_m3l_study.py replay --input PATH --sceneqa PATH
  --yolo PATH --flow-weights PATH --device mps --output NEW_PATH`; explicit
  development thêm `--cached-observations ORIGINAL_M3K_ACTUAL99_RECEIPT
  --development-only`. Score cần cùngcache cho development, truth chỉ ở
  score. Reader artifact cap64MiB, replay30min; unsupported run phải fail.

Vệ sinh: JPEG staging của reconstruction và các replay đã tự xóa, root
kiểm không còn `codex-tmp-*m3l*`/`codex-tmp-*growth*` dưới SceneQA. Giữ
một lát nguồn372,5MB cùng metadata/receipts và4v1textfiles104KiB để tái lập,
không whole-project/model/venv copy. Disk cuối42GiB trống. Không Docker,
không package install mới, không app build/install, không iPhone, không
commit/push/deploy.11tracked changes đã có từ trước vẫn được bảo toàn.
