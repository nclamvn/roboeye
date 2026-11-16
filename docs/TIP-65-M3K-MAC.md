# TIP-65 M3K: detector mới và correspondence có học trên Mac

16/11/2026. TIP trước mọi model inference trên holdout mới.

## Yêu cầu, outcome và cách build

Người dùng giao thay detector, thử correspondence có học, ưu tiên mã nguồn
mở; A/B trên clip mới, đo FP/FN; thiếu bằng chứng không báo, không suy ra
mét, chưa cần iPhone. Contractor áp dụng Vibecode Kit v6.3, giao Builder
ba vùng độc lập (detector, learned field, runner), tự chọn và kiểm nhãn,
chạy lại/thẩm tra evidence. Không tự gọi tác giả là independent reviewer.

M3J đã bác bỏ fixed4tiles YOLOv3 và SIFT-init bắt buộc: cả A–D0/24 TP
trên clip mới, chỉ12/24 positive có qualifying detection. Không tiếp tục
nới minMatches hay thêm tracker. Hai giả thuyết mới: model detection có
chất lượng khác giúp thấy vật nhỏ/khó; learned dense correspondence giảm
mất điểm mà không cần đủ SIFT keypoints hoặc nới pixel verification.
Đó là giả thuyết, không phải kết luận sẽ tốt hơn.

## Model, nguồn và giấy phép

### Detector

[PekingU RT-DETRv2 R18vd](https://huggingface.co/PekingU/rtdetr_v2_r18vd),
revision `5650961749fa93567c0d46fc7f43ea4f9e914107`. Model card ghi Apache2.0;
[upstream RT-DETR](https://github.com/lyuwenyu/RT-DETR) cũng Apache2.0.
Tận dụng triển khai Transformers sẵn có, không import remote custom code.
Đây là checkpoint nhỏ có thể thử trên Mac, không tuyên bố mới nhất/SOTA.
Các số COCO/FPS từ upstream không phải kết quả RoboEye.

| Local artifact | Bytes | SHA-256 |
|---|---:|---|
| config.json |5437|`ed051ec77cb41c5d9d5e3af21a979b1e890599dfd68434d7636ff82ded4c1527`|
| preprocessor_config.json |444|`cd38cd59999e7a95d68e487fbe5132df3d4e5c32a0836add57e6126ba0c4eaf1`|
| model.safetensors |80904640|`d18309d0d7ea57048138885c4c6ecfcb1e24506fc6153b94ad484f8ab62c7115`|

Main tải đúng revision vào SceneQA/learned-models/rtdetr-v2-r18vd, không
model copy khác. Local-only safetensors, disable_custom_kernels=true,
float32, MPS explicit, không CPU fallback ngầm. Upstream processor640x640
anisotropic resize, BGR→RGB, output quy lại native rồi working<=768.
Score>=0,38, deterministic same-class IoU>0,65 dedup, max12. Giữ80-class
vocabulary, không ưu tiên road classes để đẹp bảng chấm; model mới có
thể dành slot cho traffic lights/vật khác. Confidence không được coi là
xác suất đã hiệu chuẩn hay so trực tiếp ngang model cũ.

### Correspondence

[Torchvision RAFT-small](https://docs.pytorch.org/vision/stable/models/generated/torchvision.models.optical_flow.raft_small.html),
official C_T_V2,990.162 parameters,4.006.189 bytes. URL:
`https://download.pytorch.org/models/raft_small_C_T_V2-01064c6d.pth`.
Full SHA-256 Main kiểm: `01064c6dba73b0fc9fc8edf772248560a00a3acfd62ac6677e9eeebad9680e27`.
Local weights_only load strict; không implicit pretrained download.

[Torchvision code](https://github.com/pytorch/vision/blob/main/LICENSE) và
[RAFT gốc](https://github.com/princeton-vl/RAFT/blob/master/LICENSE) BSD3.
[Torchvision pretrained caveat](https://docs.pytorch.org/vision/stable/models.html):
weights/dataset có thể có điều kiện riêng; C_T_V2 dùng FlyingChairs và
FlyingThings3D. Không lấy BSD3 của code để chứng nhận mọi quyền thương mại
của weights/training data. Lượt này R&D local, không phân phối hoặc phát
hành sản phẩm với weights; commercial clearance vẫn là gate chưa hoàn tất.

Chọn RAFT-small thay learned sparse SIFT matcher để không lặp phụ thuộc
keypoint đã làm M3J im hoàn toàn. Nó không phải flow SOTA được chứng minh
ở đây; SEA-RAFT/WAFT và matcher khác chưa chạy. Không tuyên bố local này
vượt cloud/VLM/agent trực tiếp; baseline loại đó chưa đo trong lượt này.

## Kiến trúc nhỏ nhất và bất biến

`LearnedCohortWindowLoom` kế thừa M3H cũ, chỉ đổi constructor và `_field`.
Giữ đúng code lifecycle/ID association, cohorts, pose/zoom, NCC, FB, support,
spread, similarity, current proof, age và angular-growth gates. Learned
field dùng cả trong fresh identity certificate đã có và cohort validator,
không thêm tracker, ID engine, coast hoặc nối tuổi giả.

ROI common-coordinate từ `_tile` cũ<=384, grayscale lặp3kênh, official
[-1,1] normalization. Pad bottom/right tới>=128/multiple8 bằng replicate,
không resize ROI; crop flow về đúng H/W, không lấy padding làm bằng chứng.
12 updates mỗi direction, forward+backward2actualmodel calls/field. Mỗi
lane tối đa12 field/exposure. Chỉ pipeline có real current support mới
được báo. Không suy từ expansion thành mét, radial speed hoặc TTC.

Mọi code M3H/M3I/M3J cũ giữ nguyên. Model lỗi/unsupported op phải fail
loud, không biến exception thành hoàn tất với0 cảnh báo. CPU chỉ được
chọn bằng explicit device trong trial khai báo, không silently substitute.

## A/B đăng ký trước

| Lane | Detector | Field supplier | Lifecycle/evidence |
|---|---|---|---|
| A | YOLOv3 FP16 cũ | DIS cũ | M3H frozen |
| B | RT-DETRv2 R18vd | DIS cũ | cùng M3H frozen |
| C | YOLOv3 FP16 cũ | RAFT-small | kế thừa M3H, chỉ `_field` khác |
| D | RT-DETRv2 R18vd | RAFT-small | kế thừa M3H, chỉ `_field` khác |

Mỗi lane có IDs thật riêng vì detection/field khác; không đòi C==A hay
D==B như adapter M3J. Kiểm inheritance và cùng policy, không đánh tráo
khác ID thành tracking accuracy. Cohort proof contract cũ áp cho mọi
event. Shared actual detector inference một lần/model/exposure, provider
RAFT dùng tuần tự chung C/D; không cache flow mơ hồ giữa exposure.

Score theo physical approaching labels cũ, IoU>=0,35/margin0,08, same
family. Unknown/unmatched/unreviewed riêng. Cyclist gold vehicle family,
detector chỉ có person chưa đủ được chấm là vehicle match; nói rõ
qualifying-match absence, không mặc định không thấy bất kỳ vật nào.

## Dữ liệu, budget và điểm dừng

Development dùng100 exposure M3J đã mở. Full YOLO cache chỉ khi bind
source/model/exe/config chính xác và explicit development-only; timing
cũ phải ghi historical. Có100 RT-DETR calls mới và tối đa4800 RAFT
direction calls (2 lanes*12 fields*2 directions*100). Không quét thresholds.
Một candidate detector, một learned flow, tối đa một sửa cơ chế được
evidence development hỗ trợ trước freeze; không sửa theo holdout.

Main đã chọn pose/cadence metadata trước RGB/nhãn: anchors
1598989115031027 (49frames,7,837m/s trung bình) và1598991449097712
(50frames,11,076m/s),4giây mỗi đoạn, không overlap các interval M3C–J
đã lưu. Cùng recording/đoạn kế cận, không chứng minh độc lập miền/đối
tượng. Không chọn RGB thuận lợi sau khi thấy model results.

Review10tile cố định trước inference mới, giữ failing cases và mọi
omission có lý do. Controls4x20frame từ một ảnh M3K mới, authored
static/zoom/pan/shake, không phải field clips độc lập. Controls targets
rỗng thì đếm all-scene false notices, không lấy FP0/0 làm precision.

Ghi công: Boreas, Autonomous Space Robotics Laboratory, UTIAS/University
of Toronto và các đồng tác giả, [bài công bố](https://arxiv.org/abs/2203.10168),
[CC BY 4.0 data license](https://github.com/utiasASRL/pyboreas/blob/master/DATA_LICENSE.md).
Lát cắt dùng nội bộ, điều chỉnh bbox qua ảnh thu nhỏ và chuyển nhãn3D
sang tham chiếu tương đối để chấm; không phân phối ảnh gốc, không ngụ ý
được tác giả chứng thực. Pose là đầu vào riêng có thật trong trial, không
giả định camera điện thoại tự có pose chất lượng tương đương.

Holdout99+80=179 exposure; tối đa358 detector evaluations và8592 RAFT
direction calls. Actual count/timing phải đo, không lấy trần làm số thực.
Không GPU worker song song; startup/first-call warmup riêng, per-exposure
service cộng detector + prep + lane engine đã gồm flow (không cộng flow
hai lần), lấy percentile sau sum. Không suy FPS phone từ replay offline.
Fail/runtime/call-budget violation phải ghi rõ trial chưa hoàn tất.

Promote chỉ khi cải thiện TP/FN trên clip mới mà không tăng observed FP
ở labelled negative/controls, giữ sàn integrity và công bố latency. Nếu
không cải thiện thì giữ ngoài app, không giải thích bằng test count xanh.
Không iPhone/app build/install, commit/push/deploy trong lượt này.

## Setup và smoke (không semantic acceptance)

Disk preflight49GiB>10GiB. Main reuse checkout/SceneQA venv, cài đúng
torch2.14.0,torchvision0.29.1,mpmath1.3.0,networkx3.7,setuptools84.2.1,
sympy1.14.0. Không upgrade NumPy/Pillow/Transformers/OpenCV cũ. Versions:
Transformers5.23.0,NumPy2.5.4,Pillow13.0.0,OpenCV5.0.0; hardware M1Max32GiB.
Không venv/build/project copy mới. Model~81MiB và runtime dùng một nơi;
uv-cache cố định tái sử dụng, không per-task cache folder mới.

Main independently smoke RAFT MPS192x256 identical development review
tile:2pair finite fields, cold3292ms,warm95,6ms. Builder authored128x128
2px translation smoke median~1,83px horizontal, warm75,7ms, finite.
RT-DETR actual MPS forward trên old annotated review tile thành công;
đây chỉ feasibility (có gold overlay), không chấm quality/latency đại diện.
Builder blank synthetic forward thành công zero detections. Không tính
smoke vào real-holdout outcome hoặc dùng chúng để chọn threshold.

## Completion / Verify

### Blind reference và source freeze

Main xem đủ10tiles trước mọi M3K inference. Review giữ30 target-keyframes:
24 approaching,5 unknown,1 not-approaching. Một unknown bị che hoàn toàn
được bỏ có lý do trước inference; không tính thành abstention thành công.
Đây là nhãn do assistant kiểm, không độc lập human-reviewed. Các vùng
nhỏ/tối vẫn giữ. Review artifact: `docs/evidence/tip65/m3k-boreas-reviewed-2d.json`.
Input SHA `7b6508c348920c1105438994e30779e087c777fcd599885e1c518e8a7be3bbe7`;
bound reviewed truth SHA `48f7031e5548810b82b2990c0d5d1652718a2c8d40b6d9198a9709029cca0ffc`.

Preflight root độc lập chạy22 model-adapter tests và12 study tests, đạt34/34.
Không coi fake/authored tests này là semantic recall. Source freeze trước
development replay:

| Source | SHA-256 |
|---|---|
| Learned detector |`4258c1c7164b5c16ac0e48173dc932a8a2577709a19822adc42e9b564300bb9a`|
| Learned field |`594c9c52cdc4e79db0fad19432fae99b23b0a064321f6b4b44607fbaadf7092a`|
| M3K runner |`bbe5892b9c69ab9d249543ecaac0a322ff3fea9427da66e371bc04f876f3b894`|
| Original cohort, unchanged |`b7915e194867e09a218742f8b779631fb00ec631ddfdd39b784eaa5e1bb4bea4`|

Runner decode native từ đúng bytes đã hash, không reopen sau xác minh.
Development dùng đúng M3J full actual cache qua validator M3H nguyên vẹn;
không dùng M3J historical-development receipt. Learned events phải có
current supported field trace, không chỉ model đã được load. A/C/S
timing là lower bound vì detector cũ chỉ đo Vision perform, B/D đo full
adapter; không so chúng như latency end-to-end hoàn toàn đối xứng.

### Development đã mở, không dùng làm acceptance

100 exposure M3J: A/B/C/D đều TP0,FN24,FP0,TN2. Unmatched A2,B5,C1,D4;
unreviewed-frame reports A13,B42,C12,D40. S diagnostic TP4,FN20 và8
unmatched, không phải fallback. Qualifying positive detection old12/24,
learned10/24: không có cơ sở gọi detector mới tốt hơn. Detector configuration
khác là một whole-workflow candidate, không phải architecture-only proof.

Actual100 learned detector calls; RAFT C820+D792=1612 direction calls,
dưới4800 cap. Study wall119,45s+576,68s, không cộng startup. Một live-stack
sample1s được root dùng kiểm tiến trình ở đoạn development thứ2; timing
development không dùng làm nghiệm thu hay benchmark tối ưu. Peak physical
footprint tại lần sample12,7GiB, không phải phép đo peak toàn phiên.
C/D engine p50~1995/2477ms,p95~10077/10262ms, chưa phù hợp realtime.
New detector aggregate7,47s/100 exposures, chưa phải cost ứng dụng.

Independent artifact audit PASS:3958 current tracks,223 events(119 cohort
warnings), tất cả100 baseline-A surfaces tái lập bằng original M3J cache
không so timing. Auditor kiểm current detector-to-track membership khắc phục
lỗ hổng scorer không tự kiểm mối nối đó. Learned trace chỉ gắn frame, chưa
gắn field-to-track, nên không độc lập quy từng field cho từng warning;
runtime source inheritance và current cohort certificate là bằng chứng
riêng, không gọi trace đó đầy đủ hơn thực tế.

Không sửa cơ chế hoặc threshold sau development; giữ nguyên source freeze
ở trên cho holdout mới. Model không chứng minh cải thiện ở development,
chạy holdout để hoàn tất A/B đã đăng ký, không mặc định promotion.

Root tính lại từ raw receipt:806 field-pairs,303 padded shapes;647,16s
field wall, bằng93,0%696,13s study wall.303 first-seen shapes chiếm594,26s
(91,8%field wall),median1842ms,p953375ms;503 lần dùng shape đã gặp chỉ
52,90s,median99,3ms,p95156,0ms. Tương quan first-shape/overhead phù hợp
giả thuyết specialization của MPS nhưng chưa chứng minh compilation là
nguyên nhân. Không trừ overhead này khỏi headline. Smoke128 cố định không
đại diện shape churn. Tất cả806 `field-supported` chỉ nghĩa model trả
finite arrays, không nghĩa đã qua NCC/FB hoặc đủ tuổi/growth proof.

### Holdout mới: kết quả thực đo

Không thay code/policy/model sau development.99 exposures từ2đoạn mới,
10 checkpoints đã kiểm2D,24 positive target-keyframes,1 negative,5 unknown.
Đơn vị là lượt đối chứng theo khung, không phải24vật thể độc lập.

| Lane | TP | FN | FP / TN | Unmatched | Unreviewed-frame reports |
|---|---:|---:|---:|---:|---:|
| A: YOLO cũ + DIS |1|23|0 / 1|1|13|
| B: RT-DETRv2 + DIS |2|22|0 / 1|3|33|
| C: YOLO cũ + RAFT |3|21|0 / 1|1|21|
| D: RT-DETRv2 + RAFT |3|21|0 / 1|5|38|
| S: bbox diagnostic, không fallback |8|16|0 / 1|8|137|

Unknown targets5 mỗi lane; unknown-target report0 A–D,1 S. Không có báo
mơ hồ tại checkpoints. Unmatched và unreviewed không được âm thầm coi
là đúng hoặc thành zero false alarms. Chỉ1 reviewed negative nên FP0
không phải bằng chứng precision cao. Hai đoạn cùng recording và nhãn do
assistant kiểm chưa đại diện deployment hoặc người khiếm thị.

Qualifying positive detector overlap cùng19/24, nhưng không cùng tập:
old-only urban index35 target03e526a8; learned-only traffic index20
target25584d5b. Vì thế không có bằng chứng detector mới nâng coverage tổng.
Confidence/resize/preprocessing khác nên đây là whole-pipeline trial.

Paired kiểm từ FULL target set, giữ ambiguity margin: C so A thêm2TP
(traffic index36:7dd1fcbb; index44:d14d3039), không mất TP cũ. D so B
thêm1TP (traffic44:d14d3039), không mất TP cũ. C/D mỗi lane trúng3 unique
GT identities, nhưng xe urban18063ff4 được C xác nhận ở index43 và D ở35.
Không gọi mọi event là true positive vì nhiều frame chưa có exhaustive gold.

Current proof ở traffic36 C: cohort77,age478,858ms,46points confirmed;
traffic44 C/D: cohorts113/105,age479,940ms,50/46points confirmed. A/B ở
những ca đó chưa đủ xác nhận growth. Đây là tiến bộ nhỏ của learned flow,
không xóa được phần lớn bỏ sót, không chứng minh radial velocity hay mét.

### Negative controls và chi phí

80 authored frames từ một ảnh nguồn M3K: static/zoom/pan/shake20 mỗi ca.
A/B/C/D đều0 all-scene false notices. S45 false notices (zoom30,pan15).
Không có labelled object-negative denominator ở controls; không dùng
FP0/0 để tính precision. Camera transforms có chủ ý, không phải4 video
thực độc lập hoặc test camera tịnh tiến/che khuất đầy đủ.

Holdout thực gọi detector358lần (198real+160controls), RAFT2250direction
calls (real1180,controls1070), dưới cap8592. Models thực chạy MPS, không
CPU fallback. Raw99 real studywall257,38s; controls124,06s, mỗi trial còn
startup khoảng3,8–4,0s. Đây là tuần tự nhiều lane chung model, không tính
thời gian download/research/label review và không phải thời gian1lane.

| Real99 exposures | A | B | C | D |
|---|---:|---:|---:|---:|
| Engine p50 ms |42,88|44,46|725,74|917,58|
| Engine p95 ms |85,39|84,17|3080,42|3325,82|
| Paired product sample p50 ms |267,65|308,87|956,80|1181,27|
| Paired product sample p95 ms |310,70|425,13|3307,38|3581,20|

Paired sum gồm staging/decode/prep + lane detector + lane engine trước
khi lấy percentile. A/C old Vision timing thiếu request setup/parsing nên
là lower bound, không latency đối xứng với B/D full adapter. Offline
staging ảnh native cũng khác live camera. Không lấy nghịch đảo số này
thành chứng nhận FPS/latency điện thoại hoặc realtime end-to-end.

### Quyết định và phần việc còn lại

**RESEARCH COMPLETE / REJECT PRODUCT PROMOTION.** Đã triển khai detector
khác và correspondence có học thực, không mock model hoặc thêm tracker.
Learned flow có2 paired gains trên clip mới, nhưng recall tốt nhất3/24
(12,5%), bỏ sót21/24 (87,5%); chi phí và lượng cảnh báo chưa được chấm còn
cao. RT-DETRv2 candidate chưa có lợi thế coverage tổng và D không thêm TP
so C trong trial này. Không thay model đang phát hành, không iPhone/deploy.

Không nới gate để đổi FN thành báo giả. Bước nghiên cứu kế tiếp hợp lý:
chỉ giữ learned field như đối chứng; kiểm chứng shape-bucketing/fixed
canvas như tối ưu có đo, không suy từ tương quan thành bản vá đã chứng
minh; ưu tiên một detector candidate khác chỉ khi cải thiện coverage trên
blind reviewed inputs trước. Quan trọng hơn, phải phân rã riêng detector
miss, identity age, mất cohort và growth disagreement trên ca khó trước
khi đổi estimator tiếp. Không hứa model mới sẽ chữa mọi lỗi. Dữ liệu
đường phố/pose này chưa đủ quyết định cho cảnh trong nhà hoặc smartphone.

Chưa đo direct LLM/tool-enabled-agent baseline cho cùng task/clock/inputs;
S là simple deterministic bbox baseline, không phải agent. Không có
claim hơn VLM/agent, đủ an toàn dẫn đường, hay hơn model mới nhất khác.
Commercial checkpoint/dataset clearance và physical-device acceptance
vẫn là gate riêng chưa hoàn tất.

### Artifacts, tái chạy và vệ sinh đĩa

- [Development score](evidence/tip65/m3k-development-score.json),
  [real score](evidence/tip65/m3k-boreas-score.json),
  [controls score](evidence/tip65/m3k-controls-score.json).
- Independent artifact audits: `m3k-development-audit.json`,
  `m3k-boreas-audit.json`, `m3k-controls-audit.json` cùng thư mục evidence.
  Chúng kiểm current boxes/tracks/events/cohorts/no-metres và call budgets,
  không chứng nhận semantic truth hay field-to-warning attribution đầy đủ.
- Runtime receipts giữ tại `native/ios/.build-xcode/scene-qa/m3k-*-receipt.json`;
  source/policy/model SHA và actual versions/device có trong mỗi receipt.
- Reproduce: `scripts/assist_scene_m3k_study.py replay --input PATH
  --sceneqa PATH --yolo PATH --learned-model-dir PATH --flow-weights PATH
  --device mps --output NEW_PATH`, rồi `score --input PATH --truth PATH
  --receipt PATH --output NEW_PATH`. Development thêm `--development-only
  --cached-detections` đúng original M3J receipt. Auditor:
  `scripts/audit_assist_scene_m3k.py --receipt PATH [--old-cache PATH]
  [--output NEW_PATH]`. Không tự tải model trong inference.
- Temporary JPEG staging của cả3trials đã tự xóa, root kiểm không còn
  `codex-tmp-assist-m3k-*` dưới SceneQA. Giữ một bộ model81MiB và lát cắt
  nguồn425MiB cho tái lập, không whole-project copy hoặc venv mới. Disk
  sau trials46GiB trống. Không Docker, không xóa dữ liệu/tính năng cũ.

### Verify cuối, sau toàn bộ inference

`npm run qa:assist-scene-mac -- --typecheck` PASS:331 Python tests,
121 Swift tests,8 Node policy tests, TypeScript sạch; không skip hoặc
silent runtime fallback. Những số này là structural QA, không phải
331+121+8 ca semantic thành công hay độ chính xác ngoài thực địa.
[QA receipt](evidence/tip65/mac-readiness/runs/2026-11-16T06-37-19-704Z-043ba51d/summary.json)
ghi rõ `releaseApproved=false`, physical-device và semantic acceptance
chưa đạt. Không chạy native build/install/iPhone trong gate này.

Root sau QA tái score độc lập cả3raw receipts với đúng input/truth:
mọi totals và code SHA khớp saved scores. Tái chạy auditor cả3PASS;
1395 unique lane/frame surfaces không có mét (500 development,495 real,
400 controls). Baseline A100frames tái lập đúng originalcache; giả lập
warning không có detection hiện tại bị auditor chặn. Auditor là bước
kiểm riêng bắt buộc trong workflow này, không tuyên bố scorer cũ tự có
mọi kiểm tra đó. Source cohort,region motion,M3J và M3Krunner vẫn đúng
hash freeze. QA source fingerprint121files trước/sau và root kiểm lại:
`27751336925e298967e7f9469b7835ed76a5eb0f157b213a67a2204ae5720193`.

`git diff --check` sạch.11 tracked changes có trước lượt này được giữ
nguyên, không stage/commit/push. Không thay source app/iOS trong lượt
M3K này. Không phát sinh folder build theo task. Đã tự xóa JPEG staging
tạm của3lượt; không xóa source, model hoặc tính năng người dùng.
