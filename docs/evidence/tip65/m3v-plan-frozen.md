# TIP-65 M3V: kiểm riêng pose, calibration, clock trên pixel đối chứng

17/11/2026. Mac only, Vibecode Kit v6.3. Contractor thiết kế/annotate/verify;
Builder diagnostic tool; Builder source-only reference preparation; Reviewer
riêng kiểm pixel và phép toán. Không iPhone, deploy, commit/push, model mới.

## Outcome và giả thuyết có thể bác bỏ

M3U A/B đều 0 TP, 13 FN, 0 FP, 18 TN, 2 unknown trên 33 target-checkpoint.
10 positive có detector match nhưng camera veto, 3 không đạt detector/handle.
Không còn giả định nhiều điểm LK/NCC tốt là hình học camera đúng.

Kiểm riêng ba giả thuyết, không mặc định cần một bản vá:

1. Sai phép đổi frame/pose/projection hoặc pixel preprocessing.
2. Metadata K/pose/time không giải thích được pixel tĩnh được đối chiếu.
3. Correspondence sai vật lý dù cycle/NCC cao, hoặc reference còn chưa đủ rõ.

SDK Boreas hiện khớp công thức native của importer. P_camera cột4 bằng0,
timestamp là midpoint, không có lý do tự đảo R hay cộng nửa exposure. Stage
resize K hiện diag-only; mapping tâm pixel có thêm (sx−1)/2, (sy−1)/2.
Phải đo tác động và kiểm INTER_AREA bằng control, không gọi đây là nguyên
nhân 13 FN chỉ từ chênh lệch khoảng0.343 working px.

## Baseline và dữ liệu giữ nguyên

M3U receipt/input/reviewed truth giữ nguyên SHA. Không chạy lại detector,
RAFT hoặc pipeline cảnh báo khi chưa có thay đổi runtime có căn cứ. Re-score
receipt cũ là cached evidence, không một lượt test model mới.

Sáu cặp đã chọn theo các checkpoint thất bại, không phải holdout clip mới:
city13→14,21→22,29→30,37→38,45→46; stop21→22. Tất cả PNG native2448×2048,
working768×643. Metadata pose tại own RGB timestamp, không nội suy.
Không tải thêm ảnh hoặc datasets. Giữ cả ba detector FN ngoài causal camera
audit; pixel tốt hơn không tự động cứu được ba ca này.

## Reference pixel độc lập

72 slot cố định: 12 cell4×3 mỗi source image ×6 pair. Chọn GFTT mạnh nhất
mỗi cell chỉ bằng ảnh nguồn, quality .012/minDistance4, không đọc target,
LK, RAFT hoặc pose prediction để chọn. Cell trống vẫn có slot unknown.
Khóa source coordinates/IDs/ảnh SHA trước khi mở target.

Mỗi slot có source/current crop ±40 và context ±120 native px, cùng tâm
SOURCE đã khóa. Hiển thị grid/axes/native tọa độ, không LK endpoint/epiline/
pose-projected target. Không mở rộng cửa sổ sau khi thấy điểm khó, không thay
slot nếu là người, xe, cây rung, hood xe mình, occluded hoặc texture lặp.

Annotator nhận dạng cùng một góc vật liệu thuộc cấu trúc tĩnh, tự gán source
và target bằng rectangle native riêng (nominal±2px, có thể rộng hơn nếu mờ).
Không dùng tâm GFTT hoặc patch-match tự động làm gold. Unknown giữ nguyên
mẫu số. Đây là AI-authored, independently cross-reviewed 2D reference, không
human/exact physical pixel ground truth hoặc certified confidence interval.
Reviewer độc lập đối chiếu bằng ảnh; bất đồng không được average về model:
mở rộng interval bao cả hai hoặc unknown nếu khác identity.

Checkerboard cell parity chia6 analysis/6 holdout mỗi pair trước kết quả.
Không fit/correct K/R/time vào analysis rồi tự tuyên bố là sensor calibration.
12 điểm/pair không đủ chứng nhận cổng production24/.70/5cell/.40span.

## Diagnostic tool nhỏ nhất

Module/script mới, không sửa old runtime/source/receipt hoặc module globals.
Mở reference sau khi seal. Không xuất object metres/TTC, không dùng pose để
tạo unique2D endpoint: pose không có depth chỉ ràng buộc epiline. Dùng
MAX dual pixel distance, positive-cheirality chỉ khi observable, cap1.3 không
đổi. Native-only kiểm tọa độ và scale threshold tương ứng working, không
so1.3 native với1.3 working như cùng một mức.

Các variant cố định, tất cả chỉ diagnostic:

- Native nominal SDK geometry, working legacy diag K + tọa độ hiện hành.
- Pixel-center affine A và K'=A K, tọa độ annotation dùng CHÍNH cùng A.
  Kiểm conjugacy với native và control INTER_AREA ramp/center footprint.
- DiagK+diagPoint và centerK+centerPoint nhất quán phải cho cùng kết quả:
  đây là sanity invariant, không bằng chứng sửa lỗi. Diagnostic mismatch
  cố định dùng diagK trên center-mapped observations; phải đối chiếu thêm
  actual working-JPEG LK và INTER_AREA control trước khi quy lỗi preprocessing.
- Cả hai endpoint pose cùng shift−2,−1,+1,+2 retained exposure index. Giữ
  TRUE pose timestamps, ghi rõ vi phạm20ms và ineligible runtime, dù residual
  thấp hơn. Không zero skew bằng cách đổi tên timestamp.
- Sai convention transpose R, translation sign và fx×1.05 chỉ falsification,
  không lựa chọn “cấu hình thắng”. Reverse t không đổi unsigned epiline nên
  không ép control đó phải fail khi chưa đủ cheirality.

Residual interval phải bảo thủ trên TOÀN rectangle hai đầu. Với epipolar:
bilinear numerator extrema trên vertices; denominator lower/upper phải là
bound thật (affine line norm), không chỉ lấy min/max16 residual samples.
Nếu denominator/epipole/horizon không thể bound, unknown. Definite pass khi
upper<=1.3, definite fail khi lower>1.3, còn lại unknown; có điều kiện theo
reference uncertainty, không tuyên bố xác suất.

Sau reference seal mới query frozen LK ở SOURCE anchor đã annotate, không
đưa target vào LK. Đây là oracle-source component test, không production seed
inventory. Native và đúng working JPEG được kiểm riêng nếu cần, ghi số lời
gọi thực (tối đa24 direction/6pair). EPE endpoint so rectangle target, cycle/
NCC hiện hành; accepted-wrong, missed, uncertainty báo riêng. Không chạy RAFT.

## Metric, causality và giới hạn

Ba nhóm không trộn:

1. Pixel component: known-static reference bị geometry từ chối, LK accepted
   nhưng sai endpoint, LK không trả được, unknown reference. Số cell/split và
   original selected denominator luôn được giữ.
2. Known-wrong endpoint controls: shift target rectangle cố định16 native px
   theo x/y, ghi là synthetic falsification. Geometry vẫn nhận wrong point là
   false compatibility, KHÔNG phải natural traffic FP. Unknown overlap giữ
   unknown; epipolar1D không đảm bảo loại mọi sai điểm dọc line.
3. Traffic warning: independently re-score cached M3U13FN/18negative; không
   đổi chúng từ một residual đẹp hoặc source có oracle. New warning FP/FN
   improvement NOT MEASURED nếu runtime không đổi.

Better clock/K variant chỉ là association/sensitivity, không tự nhận nguyên
nhân. Muốn xác nhận nguyên nhân phải có reference rõ, cùng mẫu/split, robust
separation và chứng minh mapping nominal sai độc lập. Giữ nguyên tất cả
variant và các kết quả xấu, không chọn clip/threshold theo score.

## Budgets và verify

Không model/dependency/venv/project copy/build dir mới. Source prep/ref crops
<=48MiB, diagnostic<=120s/32MiB output,1 run sau seal, tối đa1 targeted repair
cho lỗi thực thi có nguyên nhân và giữ prefix. Không retry để có score đẹp.
Disk floor10GiB, hiện55GiB. Không browser upload dữ liệu camera cá nhân.

Test analytic knownR/t projections, convention/sign/clock, halfpixel
roundtrip/INTER_AREA, interval contains dense interior samples/crosses1.3,
epipole/line-norm degenerate, source/annotation hash tamper, unknown slots,
all-slot denominator và không chứa object range. Reviewer code + reference
GO trước actual diagnostic, sau đó kiểm số độc lập. Full Mac regression
khi integrate xong; test xanh không phải user-outcome acceptance.

Outcome tối thiểu: tool + source-bound pixel evidence chỉ ra phần đã bác bỏ,
phần được hỗ trợ và phần chưa biết. Không hứa giảm13FN chỉ vì kiểm diagnostics.
Đối chứng LLM/agent trực tiếp và human accuracy chưa đo.

## Primary references

- https://github.com/utiasASRL/pyboreas/blob/master/DATA_REFERENCE.md
- https://github.com/utiasASRL/pyboreas/blob/master/pyboreas/utils/utils.py
- https://github.com/utiasASRL/pyboreas/blob/master/pyboreas/data/sensors.py
- https://github.com/opencv/opencv/blob/4.x/modules/imgproc/src/resize.cpp

## Completion / Verify

Đang triển khai; chưa có kết luận nguyên nhân pose/K/time/correspondence từ
pixel độc lập, chưa sửa runtime hoặc cải thiện warning recall.
