# TIP-64B3 — Completion / VERIFY

Ngày: 2026-10-11. Bản: **RoboEye Assist 0.2.1 / build 4**.
Phương pháp: **vibecode-kit v6.2 + frontend-design**.

## Kết luận

**READY — phần mềm native đã qua QA; còn các gate thiết bị thật.**
12/12 yêu cầu phần mềm trong TIP này đã triển khai (**100% phạm vi TIP**, không
phải 100% sản phẩm thương mại). Gate cuối `pass:true`, source không đổi trong
QA; Contractor trực tiếp xem sáu ảnh render cuối. Chưa cài B3 lên iPhone trong
lượt này; chưa có kết quả độ trễ, sai số hay độ bền của B3 trên điện thoại.

Đã scan repository và audit sâu app iPhone vừa được người dùng thử. Không coi
đây là nghiệm thu toàn bộ DriveSense, RoboHand, Android hoặc browser. Không
khẳng định zero-lag, nhận mọi vật thể hay khả năng dẫn đường an toàn.

## Bottleneck và nợ đã dọn

1. **Bám identity:** thay ghép greedy bằng ghép toàn cục có giới hạn; khi mơ hồ,
   tạo identity mới và bỏ coast trùng. Không chuyển số mét giữa hai vật.
2. **Đồ hoạ:** bộ lọc thích nghi tốc độ chỉ tác động bounding box hiển thị.
   Geometry đo, hỗ trợ depth và JSON giữ nguyên dữ liệu gốc. Giữ view/AX theo ID,
   cache fitting chữ, tránh va chạm nhãn, mọi nét khung nằm dưới mọi badge.
3. **Nhịp UI:** một owner expiry/presentation; kiểm tra tối đa 30 Hz nhưng không
   render lại khi dữ liệu/freshness/layout chưa đổi; maintenance tối đa 10 Hz.
   Đây là giới hạn lịch chạy, không phải FPS thực đo.
4. **Runtime:** một frame đang xử lý, không backlog; cache request, nhịp detector
   thích nghi, backoff lỗi tạm và chặn model không tương thích với lý do rõ ràng.
5. **Depth/metadata:** một cặp lock depth/confidence cho cả frame; không tạo
   packet/projection nếu không ghi metadata. Rút quyền ghi khi worker chạy cũng
   không phát packet ra UI. Không nới TTL 300 ms hoặc chính sách đo.
6. **Quan sát/QA:** cửa sổ timing giới hạn 64 mẫu, P50/P95 và drop/retry/error;
   QA hiện hành dùng cùng descriptor/ngưỡng model, receipt theo run và giữ
   nguyên bằng chứng B1/B2. Giữ license, checksum, Team và bundle ID.

frontend-design định hướng instrument camera-first, trung tính tương phản cao,
khung cyan khi đo được và amber khi chưa đủ dữ liệu, không nháy hoặc màu xanh
“an toàn”. Hiển thị mét xấp xỉ một chữ số thập phân, không giả độ chính xác cm.

## VERIFY yêu cầu

| REQ | Kết quả | Bằng chứng chính |
|---|---|---|
| Q01 | PASS | Pure-core freshness/loss tests và UI stale/background; raw geometry ngoài renderer |
| Q02 | PASS, fixture mô phỏng | RMS giảm 81,717%; jump 0,2 normalized đạt trong 1 observation |
| Q03 | PASS | Ghép global, permutation/greedy-conflict/ambiguity/no-ghost/max12 tests |
| Q04 | PASS | 18 presentation tests, dense/edge UI; Contractor xem ảnh composition cuối |
| Q05 | PASS | Review single UI owner/render cache; lifecycle/rotation UI |
| Q06 | PASS phần mềm | 10 runtime policy tests; review single-flight/backoff/schema; build/analyze |
| Q07 | PASS phần mềm | Review batch lock/consent cancellation; interop giữ v1 và support budgets |
| Q08 | PASS phần mềm | Bounded latency/counter core tests, Chẩn đoán UI; không dùng fixture như timing thật |
| Q09 | PASS UI mô phỏng | Compact/bright/dense/landscape/Dynamic Type/Reduce Motion, không blink |
| Q10 | PASS | Exact current counts, explicit xcresult, 9 policy cases; lịch sử hash không đổi |
| Q11 | PASS phần mềm | Asset/license/model schema/ngưỡng runtime, Release bundle, generator giữ signing |
| Q12 | PASS | Audit kiến trúc/model, TIP, kế hoạch thiết bị và báo cáo này |

## Kiểm thử định lượng

| Gate | Kết quả thực chạy | Giới hạn |
|---|---|---|
| `npm run typecheck` | PASS, 0 lỗi | Web check đầu lượt; không có web source mới trong B3 |
| `npm run test:unit` | **353/353 PASS**, 0 fail/skip/cancel, 61 files | Không phải browser E2E hay recall |
| `npm run security:audit` | PASS, 0 high / 0 critical | Kiểm browser bundle hiện có, chưa rebuild web trong lượt native này |
| Swift package | **94/94 PASS**, 0 failure | 25 Core +41 Tracking +18 Presentation +10 RuntimePolicy |
| UI simulator | **16/16 PASS**, 0 failure/skip/expected failure | Giữ đủ 11 case cũ, thêm 5 adversarial; runtimeWarnings của structured result rỗng |
| Swift → TypeScript | **7/7 PASS** | Closed v1, bbox-only; không giả semantic foreground |
| Core ML trên ảnh thật | **3/3 smoke PASS**: bird/person/ảnh tủ lạnh của người dùng | Cùng schema, confidence0.38/IoU0.45; không phải benchmark recall |
| QA restoration policy | **9/9 PASS** | Mock policy; exact simulator state proof riêng trong full gate |
| iOS unsigned Release / static analysis | **2/2 PASS**, không có dòng `error:`/`warning:` trong hai build logs | Chưa phải signed B3 installation hoặc chạy phone |
| Offline model/license + signing protection | PASS | Model compile trong bundle, license byte-identical, generator từ chối ghi đè project |

Command gate cuối: `ROBOEYE_IOS_SIMULATOR=<existing simulator> npm run
qa:assistive-objects -- --local-photo <user attachment>`; exit **0**. Pixels riêng
được đọc trực tiếp trên máy, không copy vào evidence và không upload.

Receipt cuối: [summary.json](evidence/tip64b3/runs/2026-10-11T06-20-27-943Z/summary.json).
Source before/after:
`cf755b7ee07b2b55bf3d96ef0233e80b62a02fd8262aa70290717ef2a8271f04`.
Historical B1/B2 before/after:
`cd41adf69d12b66281a71afb344fb524b6199429cfb64c7e3fb70128d8f3f152`.
Model SHA:
`276afae53da362e25ad21c827f8a929a8512254b1343433d970e725a0de57d8f`.

Không sửa nguồn fingerprinted sau gate cuối. Báo cáo, kế hoạch và root README
ở ngoài phạm vi source fingerprint. Không cộng các loại test thành chỉ số độ
chính xác hoặc tỷ lệ hoàn thiện thương mại.

### Chỉ số làm mượt

Fixture stationary 240 observations/30 Hz, bỏ 30 mẫu warmup: RMS gốc
**0,008485281**, RMS hiển thị **0,001551348** → giảm **81,717%**.
Jump x +0,2 normalized đạt đúng target trong **1 observation**; gate ≤2.
Đây là test thuật toán display có thể tái tạo, **không phải đo phone latency,
frame pacing, range error hay tracking recall**.

### Visual acceptance và lỗi tìm được trong QA

Lần full gate đầu giữ nguyên tại
[first summary](evidence/tip64b3/runs/2026-10-11T06-10-30-868Z/summary.json):
model/core/interop/build/analyze/16 UI đều PASS nhưng tổng gate **FAIL** do lệnh
shutdown trả149. Kiểm tra độc lập thấy simulator đã Shutdown. Sửa restoration
bằng bằng chứng trạng thái chính xác trước/sau, không bỏ qua mọi exit149.

Quan trọng hơn: xem ảnh dense thật phát hiện nét khung vật tạo sau đè lên nhãn
vật tạo trước, dù collision assertions xanh. Đã tách hai composition planes,
thêm invariant hierarchy và rerun **toàn bộ gate**; không bỏ assertion.

Contractor xem trực tiếp sáu ảnh cuối: automatic hai vật, dense12, compact trên
nền trắng, dense chữ lớn dọc/ngang, edge trên nền trắng ngang. Chữ đọc được,
không còn nét khung phía trên nhãn; source warning hiện rõ; controls sử dụng
được. Chữ accessibility cực lớn + landscape ưu tiên controls/scroll, có thể ẩn
badge thiếu chỗ nhưng giữ outline/AX. Không khẳng định mọi label luôn hiện ở
cảnh đông hoặc coi ảnh này là camera thật.

[Ảnh dense cuối](evidence/tip64b3/runs/2026-10-11T06-20-27-943Z/screenshots/A886F821-3E14-498C-9EC9-07A8F4C4F0A2.png) ·
[Ảnh compact nền sáng](evidence/tip64b3/runs/2026-10-11T06-20-27-943Z/screenshots/65498E5A-5162-44E5-84ED-E1F2DC107842.png) ·
[Manifest ảnh](evidence/tip64b3/runs/2026-10-11T06-20-27-943Z/screenshots/manifest.json).

## Scenario ledger

**11 nhóm phần mềm PASS /0 FAIL còn mở /5 gate vật lý UNTESTED.**
PASS không đồng nghĩa các trường hợp chưa kiểm máy đã được chứng nhận.

| Nhóm | Trạng thái | Mức tác động nếu chưa đạt |
|---|---|---|
| Raw range/freshness không bị filter/hold | PASS | P0 — không được dùng số cũ |
| Stationary jitter/discontinuity/reset/repeated timestamp | PASS synthetic | P1 |
| Identity ambiguity/greedy conflict/permutation/no ghost | PASS | P1 |
| Label collision/geometry-below-badge/edge/HUD exclusions | PASS core + rendered UI | P1 |
| Compact, large text, contrast, Reduce Motion | PASS simulator | P1 |
| Stop/background/manual switching/rotation | PASS simulator | P0 |
| Single-flight/backoff/config validation | PASS source + policy/build | P1 |
| Batched depth/consent-gated metadata projection | PASS source + interop | P1 |
| Real offline inference/artifact/license | PASS Mac smoke + iOS bundle | P1 |
| Closed v1 interoperability/support/null budgets | PASS | P1 |
| QA binding/history integrity/simulator restoration | PASS | P1 |
| Cài đúng B3 và smoke camera trên iPhone | **UNTESTED B3** | P1 — chặn bàn giao test thiết bị |
| Phone latency/pacing/memory/thermal 30 phút | **UNTESTED** | P1 — chặn claim mượt/bền |
| Held-out per-class precision/recall, ID switch/miss duration | **UNTESTED** | P0 nếu phát hành cho dẫn đường |
| Physical range error + foreground/refusal coverage | **UNTESTED** | P0 nếu dựa số đo để di chuyển |
| VoiceOver và thử với người dùng hỗ trợ thị giác | **UNTESTED** | P0 nếu phát hành hỗ trợ di chuyển độc lập |

Không có P0 source defect được xác nhận còn mở trong scan giới hạn này.
Các gate P0 chưa kiểm là **rủi ro phát hành**, không được xóa bằng số test xanh.
Receipt camera ngắn của B2 không được chuyển thành kết quả hiệu năng/accuracy B3.

## Model và phần chưa triển khai

Model shipping vẫn **Apple YOLOv3 FP16,80 nhóm COCO**. B3 thêm descriptor/schema
và error contract cho khả năng thay model có kiểm soát; không giả rằng decoder
khác đã cắm được ngay. Chưa tải/cài weights hay conversion environment mới.

[Audit và đối chiếu nguồn chính thức](ARCHITECTURE-AUDIT-TIP-64B3.md) đặt RF-DETR
Nano/Seg Nano vào evaluation lane, YOLO26 vào lane cạnh tranh cần chốt license,
YOLOX Nano vào lane nhẹ; FastVLM chỉ cho mô tả theo yêu cầu, ngoài hot loop.
Chưa model nào được promotion bằng tên/SOTA hoặc benchmark máy khác.

Bước nâng cấp chức năng đúng tiếp theo: holdout cố định → adapter Core ML
instance-mask → đăng ký mask/depth và mốc bề mặt đo thực → so sánh accuracy,
refusal, latency/memory/heat trên cùng phone → chỉ thay baseline khi chứng minh
lợi ích. Foreground/tilt/occlusion vẫn là gap thật của bbox-only hiện hành.
Non-LiDAR, Android, open-vocabulary, giọng nói/haptic và dẫn đường chưa được
bổ sung trong B3. Native0,5–5 m không thay phép đo camera cao tốc DriveSense.

## Bàn giao và disk hygiene

Các nhóm file B3: Core tracking/presentation/runtime policy và tests; App
pipeline/session/overlay/controller;16 UI tests; model QA; project/version;
current QA/preflight/generator/interop và restoration policy scripts; docs.
Builder reports nằm trong `evidence/tip64b3/builder-core.md`,
`evidence/tip64b3/builder-runtime.md`, `BUILDER-TIP-64B3-UI-QA.md`.
Working tree còn thay đổi B1/B2 và thay đổi có sẵn của người dùng; không reset,
không nhận toàn bộ chúng là code mới B3.

Reuse `.build` và `.build-xcode`, không copy project ra tmp, không thêm dependency
hay build directory mới. Disk trước final gate khoảng54 GiB, sau khoảng53 GiB.
Không tạo external task scratch cần xóa; không dùng Docker. Simulator hiện có
được xác minh trở về Shutdown, không tạo/erase runtime hoặc device. Giữ failure
receipts để đối soát. Không commit, push, deploy hay cài/mở camera iPhone trong
lượt này.

Bản mới cần cài native riêng sau khi được người dùng cho phép. Kế hoạch thử:
[TEST-PLAN-TIP-64B3-DEVICE.md](TEST-PLAN-TIP-64B3-DEVICE.md).
