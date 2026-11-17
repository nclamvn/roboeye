# TIP-65 M3U: camera motion theo tác động pixel, A/B trên lát cắt mới

17/11/2026. Mac only. Contractor thiết kế và verify, Builder camera/study,
Builder dữ liệu, Reviewer không viết hai component. Vibecode Kit cá nhân v6.3.
Không iPhone, cài dependency/model mới, deploy hoặc commit/push.

## Outcome và baseline

Sửa giả định sai: baseline dưới 2.5 cm không đảm bảo parallax dưới 1.3 px.
Thử camera authority mới trên cùng detector, phép đo pixel, association và
temporal floors. Đo cả báo nhầm và bỏ sót, không chỉ số cặp camera valid.

A: camera CohortWindowLoom cũ + TexturedGlobalWindowMotion warped cũ.
B: camera authority pixel-impact mới + cùng TexturedGlobalWindowMotion warped.
Đây là camera-only A/B, không đổi M3R appearance-chain overlay cùng lúc.
LLM/agent trực tiếp chưa đo; không claim hơn mọi phương án hay realtime.

## Hợp đồng camera và bất biến

- Module mới, không sửa module/receipt M3R/S/T hoặc monkeypatch module globals.
  Giữ kiểm clock, K, SE3, epoch nguồn, tốc độ, rotation, image và exposure hash.
- Background seed chọn từ ảnh nguồn và mask detector, tối đa 256, các tham số
  LK/NCC/FB không đổi. Lưu mọi seed; lỗi LK/NCC/outside/foreground không biến
  mất khỏi mẫu số support. Không đọc nhãn, depth hoặc endpoint đối chứng.
- H chỉ bỏ rotation từ K/R đã cung cấp. Không fit F/H để tự chứng nhận pose.
  Nhánh rotation cần residual <=1.3 px, >=24 điểm, >=.70 toàn seed, >=5 cells,
  span >=.40. Không lấy độ dài baseline làm quyết định chấp nhận.
- Nhánh translation cần tín hiệu không-chỉ-xoay >1.3 px cùng >=24/.70/5/.40;
  kiểm epipolar từ pose chuẩn hóa, MAX hai khoảng cách điểm-đường <=1.3 px,
  sin(ray,baseline)>=.025, denominator/finite/inbounds không đổi. Kiểm dấu
  cheirality: parallax tương thích độ sâu dương hai view, không chỉ thẳng hàng.
  Không giải hoặc xuất khoảng cách vật thể. Đây là hợp đồng residual mới,
  không tuyên bố tương đương độ tin cậy với residual MIN cũ.
- Baseline direction từ pose không được chứng nhận chỉ vì SE3 hợp lệ. Kết quả
  camera có điều kiện theo chất lượng metadata; giữ các control sai pose và
  công bố thiếu covariance. Unobservable/thiếu kiểm thì abstain, không best-fit.
- Common image scale giữ VETO ambiguity theo thông số cũ, không dùng làm
  acceptance. Không giữ cảnh báo qua veto, không đổi min growth/window/rival.
- B có epoch riêng theo hard/soft reset của chính authority. Handle detection
  hiện tại có thể tái dùng từ A để trình bày, không lấy age/epoch/lifetime của
  tracker A làm bằng chứng liên tục. Source-index/time/pixel proofs vẫn sở hữu
  lịch sử phép đo B. Không thêm tracker hoặc chữa identity trong milestone này.

## Dữ liệu và review trước inference

Nguồn Boreas chính thức, CC BY 4.0, metadata đã có. Chọn hai cửa sổ bằng quy
tắc +6 giây từ anchor M3R, không xem RGB/kết quả để chọn:

- City: 50 exposure, 1598989152056413..1598989155979205.
- Gần đứng yên: 50 exposure, 1598987814129989..1598987818048959.

Đã kiểm metadata: không trùng 1,699 exposure Boreas đã giữ trong manifest cũ.
Không gọi clip thứ hai là lia thật: tốc độ metadata chỉ khoảng .066 m/s.
HEAD ảnh + listing nhãn chính thức trước RGB, hard budget 600 MiB ảnh +5 MiB
metadata/nhãn, retained <=420 MiB. Không full recording, không retry ngầm.
Fetch <=600 giây, 4 transfers đồng thời tối đa. Nếu thiếu nhãn giữ prefix và
không tính nghiệm thu. Disk floor10 GiB, hiện khoảng55 GiB.

Tạo runtime manifest tách nhãn, kiểm original SHA. Dùng bộ review cũ:
5 checkpoint cố định/clip, toàn candidate được tính lý do chọn/không chọn,
duyệt 2D mù detector/flow. Bounding box 3D chiếu không được coi tự động là
vật khả kiến. Sai/che khuất/không chắc giữ unknown hoặc omitted có lý do.
Approach reference radial từ nhãn3D không đồng nghĩa optical expansion:
báo metric theo đúng loại nhãn, xem thêm positive sequence trước khi suy
kết luận optical recall. Không dùng chính B để tạo truth hay đổi nhãn sau A/B.

## Thực thi hữu hạn và phép bác bỏ

Re-use executable, detector và RAFT weights đã có. Một actual A/B <=900 giây,
100 frame, receipt<=192 MiB. Detector mỗi frame chạy một lần. Hai estimator
frozen dùng cùng một resident RAFT provider nhưng chạy tuần tự, không cache
liên lane ở bước này. Quyết định L2: tránh copy _origin hoặc giả counter
inference để giữ kiểm chứng camera-only nhỏ nhất. Tối đa 8 direction/frame
gộp A/B; đếm thực riêng mỗi lane, công trùng và tổng timing đều công bố.
Không lưu toàn bộ tensor/flow trong receipt. Một repair chỉ
cho lỗi thực thi có nguyên nhân cụ thể; giữ prefix, không retune vì score xấu.

Analytic tests: small translation/high parallax, pure rotation, epipole,
reversed translation/negative depth, yaw/clock sai, planar common-scale/zoom,
thiếu điểm hoặc coverage, all-seed denominator, veto resets, no metres.
Existing M3T là development/regression, không gọi là dữ liệu mới. Actual
traffic mới khóa input/review/code trước inference; không đổi ngưỡng sau score.

Score: TP/FN/FP/TN theo reviewed target-checkpoint, unknown/unmatched/unreviewed
notices riêng, detector recall riêng; không gọi checkpoint là sự kiện độc lập.
Camera availability, first veto reason, cost từng tầng và tổng công riêng.
Reviewer kiểm code trước actual, rồi độc lập kiểm bindings/counters/score.
Full Mac regression sau integration, tests xanh không cấp quyền release.

## Nguồn kỹ thuật đã đối chiếu

- Hartley/Zisserman, epipolar geometry: https://www.robots.ox.ac.uk/~vgg/hzbook/hzbook2/HZepipolar.pdf
- MIT, rotation homography và điều kiện áp dụng: https://visionbook.mit.edu/homography.html
- Boreas licence: https://github.com/utiasASRL/pyboreas/blob/master/DATA_LICENSE.md
- Boreas camera/pose/timestamp: https://github.com/utiasASRL/pyboreas/blob/master/DATA_REFERENCE.md

## Completion / Verify

### Kết luận sản phẩm: NOT READY, không promote B

Đã triển khai và chạy đủ 100 frame mới một lượt, 91.563 giây, không lỗi,
không retry, không sửa nguồn/nhãn/ngưỡng sau khi xem kết quả. **Không đạt
mục tiêu cải thiện cảnh báo.** B là công cụ nghiên cứu, không thay mặc định.

| Chỉ số theo reviewed target-checkpoint | A cũ | B pixel-impact |
| --- | ---: | ---: |
| TP theo nhãn radial | 0 | 0 |
| FN theo nhãn radial | 13 | 13 |
| FP trên ca âm đã duyệt | 0 | 0 |
| TN | 18 | 18 |
| Target unknown | 2 | 2 |
| Cảnh báo trên toàn bộ 100 frame | 0 | 0 |

0 FP không chứng minh hệ thống an toàn khi cả hai không đưa ra cảnh báo nào.
Đây là checkpoint cùng chuỗi, không phải 31 sự kiện độc lập. 18 candidate
khác không đủ khả kiến/identity được giữ unscorable, không nhập vào TN.

### Dữ liệu, nhãn và nguồn bằng chứng

Hai cửa sổ +6s được chọn bằng metadata trước RGB/inference, không trùng
1,699 exposure Boreas đã giữ. Nhận 100 PNG và 38 nhãn chính thức, reuse 3
metadata file: 141 source file, 374,279,714 byte, Contractor kiểm SHA toàn bộ.
Payload mạng nguồn gồm 366,444,458 byte ảnh, 190,547 byte nhãn và 31,108 byte
listing; không bao gồm HTTP header hoặc traffic tra cứu tài liệu. Fetch 66.966
giây, không retry. Bộ chuẩn bị khoảng 377.7 MB, dưới 420 MiB.

Contractor xem 10 sheet mù, Reviewer kiểm 10 sheet và crop native các ca khó.
51 candidate ban đầu trở thành 33 target có hộp nhìn thấy và 18 unscorable:
13 radial-positive, 18 radial-negative và 2 unknown. Không có human review.
Primary truth được khóa trước model, không đổi radial label từ pixel B.

Secondary kiểm toàn bộ 14 radial-positive candidate ban đầu bằng đúng ba
exposure của trend gốc. Contractor xem 21 crop, Reviewer riêng xem 21 crop.
Với uncertainty extent đã khóa, chỉ 1 ca đủ corroboration tăng extent sau
bỏ camera rotation, 13 ca unknown (occlusion, clipped, gait/aspect hoặc bound
chưa phân biệt). Ca concordant `city-08:3` cũng không có cảnh báo ở cả A/B.
Đây là annotation heuristic, không material-point ground truth và không
chuyển 13 unknown secondary thành TN hoặc xóa FN primary.

### Delta camera và nguyên nhân chưa đạt

City: A valid 17/50 frame, B chỉ 1/50; B veto 48 và không tích lũy được hai
nguồn valid kế nhau nên dispatch 0 RAFT direction ở city. Stop: 49/50 valid
ở cả A/B. Độ sẵn sàng camera của B giảm ở đoạn có positive, không cải thiện.
Tất cả 13 positive primary thuộc city, không thuộc nhánh baseline nhỏ cần
chứng minh; clip stop negative-only không chứng minh positive recall.

City có 256 seed mỗi cặp, median LK accepted 98.83%, median qua thêm
photometry/current-background 96.09%. Không phải thiếu số lượng seed hoặc LK
không trả điểm. Tuy nhiên cycle/NCC cao chưa chứng minh điểm đúng vật lý.
Phép chẩn đoán sau thử (không sửa thuật toán) cho thấy 12 cặp bị loại có thể
đạt các floor khi lấy union hai mask R/E, nhưng 36/49 cặp vẫn không đạt ngay
cả union. Không tính các cặp này là camera valid hay TP được cứu. Pose/calib/
timing/rolling shutter và độ đúng correspondence vẫn cần đối chứng riêng;
không quy lỗi chắc chắn cho sensor hay LK từ dữ liệu này.

DEV trên 48 cặp M3T cũ, chỉ RGB+RGB-pose/K, không đưa depth/expected endpoint
vào candidate: 14 valid mới so với 13 baseline đã lưu, khôi phục 2 cặp và
loại thêm 1 cặp. Chỉ 2/10 fallback gần-chỉ-xoay cũ được khôi phục. Đây là
development component test, không dữ liệu giao thông mới hoặc warning recall.

### Kỹ thuật, chi phí thực và QA

- Giữ nguyên các module cũ và proof của TexturedGlobalWindowMotion. Camera
  mới có current-only handle và epoch riêng, không vay tuổi ID hay giữ cảnh
  báo qua veto. Epipolar MAX dual-distance, positive cheirality và cap 1.3 px.
- Reviewer chặn lỗi dùng sai mẫu số làm yếu zoom veto trước actual; đã khôi
  phục mẫu số plausible cũ cho VETO, full-seed N chỉ dùng acceptance. Một
  nghi vấn khác về history cap được rút lại sau khi Contractor kiểm trực tiếp
  `deque(maxlen=8)`; không sửa thuật toán theo giả thuyết chưa xác nhận.
- Một lỗi test phụ thuộc inventory sau import được sửa riêng fixture để
  dùng snapshot preflight đã seal. Không sửa plan/fetcher/dataset hoặc chạy
  lại actual fetch/study. Không nới parser, timeout hay quality threshold.
- 26 test M3U riêng đạt; nằm trong tổng 667 Python. Full Mac gate đạt 667
  Python, 121 Swift, 14 Node, TypeScript; zero failed/skipped. Fingerprint 197
  source file trước/sau QA và sau actual giống nhau. `git diff --check` đạt.
- Detector thực CoreML YOLO cũ: 100 call/2 batch; không cached observations.
  Một resident RAFT-small MPS, A 214 direction, B 188, tổng 402. Có công trùng
  hai lane ở stop, không cache liên lane. Study 91.563 giây, model startup
  2.233 giây; receipt 42,633,538 byte, dưới 192 MiB.
- Per-lane diagnostic product p50/p95: A 603.54/769.69 ms, B 359.90/705.37 ms.
  B bỏ xử lý city vì veto nên số nhỏ hơn **không phải** tăng tốc xử lý thành
  công. OpenCV requested 1 nhưng reported 10 thread, timing không controlled.
  Không cam kết realtime, nhiệt, smartphone hoặc chất lượng người dùng.
- Không model/dependency/venv/build directory mới, API trả phí, project copy
  hoặc deploy. Các temporary fixture/staging đã tự dọn. Giữ dataset, receipt,
  review và QA plates để tái kiểm; còn khoảng 55 GiB. Human effort và chi phí
  compute quy tiền chưa đo. LLM/agent trực tiếp chưa benchmark.

Đối soát cuối của Reviewer gọi trực tiếp `score_frame` cũ, không dùng scorer
M3U mới, và nhận đúng cùng số. 141 source file, 100 native-gray hash, 100
working-JPEG-gray hash, 98 control exposure và 24,783 photometric/mask check
được tái kiểm, 100 proof contract đạt. Không chạy lại detector/LK/RAFT.
38 code hash actual và 35 code hash legacy không đổi; score M3R giữ nguyên.
Trong 13 positive, 10 có detector match nhưng bị camera veto ở cả hai lane,
3 không đạt detector/handle criterion. Numeric audit có một NumPy warning
không fatal (`invalid value encountered in det`) từ verifier cũ; không sửa
nguồn hoặc suppress warning để làm đẹp báo cáo.

### Disposition và bước tiếp theo

Giữ baseline và toàn bộ bằng chứng thất bại. Không phát hành B, không đổi
threshold, ghép mask để tạo TP, thêm tracker hoặc đổi nhãn sau kết quả.
Giả định “baseline nhỏ thì chỉ xoay” đã có component phản chứng, nhưng chỉ
thay nhánh camera chưa giải quyết được pipeline cảnh báo.

Bước có căn cứ tiếp theo là kiểm riêng tính đúng của phép chiếu pose/calib/
timing và per-ray correspondence trên camera chuyển động, với cả positive
và negative thuộc đúng stratum cần sửa. Mô hình ảnh phải xử lý nhiều độ sâu
đồng thời và được kiểm độc lập; union hậu nghiệm hiện tại không phải giải pháp
đã chứng minh. Chỉ chạy candidate tiếp theo khi có phép bác bỏ và holdout mới,
không tiếp tục vá theo từng clip hoặc tự chấp nhận F/H fit.

### Evidence

- `docs/evidence/tip65/m3u-preflight.json`
- `docs/evidence/tip65/m3u-boreas-score.json`
- `docs/evidence/tip65/m3u-secondary-visible-extent.json`
- `docs/evidence/tip65/m3u-post-trial-diagnosis.json`
- `docs/evidence/tip65/m3u-development-m3t-camera.json`
- `docs/evidence/tip65/m3u-independent-verification.json`
- `docs/evidence/tip65/m3u-verification.json`
- Full QA: `docs/evidence/tip65/mac-readiness/runs/2026-11-17T12-14-43-243Z-1f9106da/summary.json`
