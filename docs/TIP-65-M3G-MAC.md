# TIP-65 M3G: điều tra bỏ sót và thay đổi cách tích lũy bằng chứng

Ngày: 16/11/2026. Chỉ Mac, không cài iPhone/deploy, không đo mét từ RGB.

## TIP và giả thuyết trước kiểm chứng

- **H1, được điều tra:** ảnh/hộp có sẵn nhưng nhánh nhỏ/tall ROI từ chối
  bởi giới hạn xử lý, thay vì thiếu tín hiệu thật. Truy dấu từng ca, không
  thay target hay nhãn để chữa điểm.
- **H2, được điều tra:** hệ thống ghép nhầm hai việc “duy trì đúng ID”
  và “có dấu giãn nở ở từng cặp”. Một bước nhỏ hoặc rung hộp làm mất lịch
  sử cần thiết để thấy thay đổi chậm qua nhiều khung.
- **H3, được điều tra:** nhãn khoảng cách Euclidean giảm và dấu kích thước
  ảnh tăng không đồng nhất, nhất là vật đi ngang hoặc đổi mặt. Giữ toàn bộ
  nhãn vật lý trong scoreboard; không đổi chúng thành âm hoặc bỏ ca khó
  để quảng cáo recall cao.

Đối chứng A là M3E/M3F tracker gốc với full-frame YOLO dùng chung, không
chạy lại crop detector đắt. S chỉ từ hộp là đối chứng đơn giản không
đủ điều kiện phát cho người dùng. B thử cách mới: giữ quỹ đạo điểm đã kiểm,
ước lượng xu hướng kích thước góc trên cửa sổ dài, tách duy trì ID khỏi
quyết định phát báo. Crop ảnh nguồn giữ tỷ lệ, giảm cỡ khi cần trong ngân
sách, không upscale và không tự loại vật chỉ vì trục dài vượt 192 px.
C nếu có là ablation B không dùng chi tiết native.

Các mốc đã xem M3F là development, chỉ dùng chẩn đoán và kiểm giải pháp.
Khóa B trước chạy holdout: Boreas objects-v1 cửa sổ mới
`1598987327084848` và `1598990956088125`, 50 khung mỗi đoạn.
Chọn theo cadence/tốc độ từ pose metadata (14,39 m/s và 0,71 m/s trung bình),
không theo kết quả nhận diện. Không coi đoạn thứ hai là camera đứng yên
suốt đoạn. Nhãn 2D đối chiếu trực quan trước chấm, không có human review.
Pose/LiDAR chỉ cấp nhãn vật lý ở scorer, không đưa metric ground truth vào
runtime. Tách clip thực khỏi các clip âm/dương được dựng có chủ đích.

Không sửa A/nhãn cũ, không bật S làm fallback, không dùng VLM đoán chuyển
động hoặc số mét. B vẫn phải có liên kết đúng vật, điểm ảnh mới ở khung
hiện tại, cổng pose/nền/zoom/clock/cắt cảnh; mất bằng chứng thì không phát.
Không mặc định “không báo” là “vật đứng yên/an toàn”. Thử phương pháp có
giới hạn: một ứng viên cửa sổ, tối đa một sửa thiết kế dựa trên ca development
trước khóa; không tối ưu theo holdout đã xem. Giữ ca không đạt và báo FP/FN,
không chỉ unit test hoặc số báo bằng không.

## Đối chiếu phương pháp từ nguồn gốc

| Phương pháp | Điều tận dụng được | Ranh giới trong vòng này |
|---|---|---|
| [Median-Flow / Kalal 2010](https://cmp.felk.cvut.cz/ftp/articles/matas/kalal-2010-phd.pdf), mục 3.2 | Forward–backward/photometric kiểm độ bám; median tỷ số khoảng cách các cặp điểm để ước lượng scale | Tự triển khai cách có cửa sổ thời gian, không tuyên bố tái lập toàn bộ tracker TLD hoặc kết quả benchmark của tác giả |
| [ByteTrack](https://arxiv.org/abs/2110.06864), [BoT-SORT](https://arxiv.org/abs/2206.14651) | Phân biệt liên kết track và detection; thông tin camera/appearance hữu ích để tránh phân mảnh | Không chỉ cài tracker rồi suy ra đã đo được hướng tiến gần; chưa chạy hai hệ này trên cùng tập |
| [Looming từ flow và surface normals](https://arxiv.org/html/2210.04108v2) | Cơ sở hình học của looming và giới hạn khi mặt vật thay đổi; camera quay không đồng nghĩa vật tiến gần | Unit-ray angular growth của B chỉ là bằng chứng quang học, không chứng minh mọi ca radial range giảm |
| [SEA-RAFT](https://github.com/princeton-vl/SEA-RAFT) | Flow học sâu và uncertainty là hướng thay sparse LK nếu ảnh không đủ texture; repo dùng BSD-3-Clause | Chưa tải/chạy model hay chứng minh latency trên Mac/Mobile; source mô tả môi trường PyTorch/CUDA, không mặc định chạy được trên điện thoại |
| [DIS trong OpenCV](https://docs.opencv.org/5.0/main_modules/classcv_1_1DISOpticalFlow.html) | Dense inverse search là phương án CPU có sẵn trong môi trường hiện tại để đối chiếu khi sparse features thiếu | Đã kiểm API tồn tại trong OpenCV 5.0.0, chưa chạy A/B DIS. Không lấy tốc độ công bố của tác giả làm tốc độ của sản phẩm |
| [OWL, preprint 24/10/2026](https://arxiv.org/abs/2610.33789) | Đối chiếu hướng giải tích dựa trên looming và perceived rotation để phân biệt các khối cứng chuyển động | Tài liệu mới, chưa tái lập trong dự án; giả thiết khối không tự quay và ước lượng flow cần kiểm; không gọi là đã tích hợp |

Đây là tổng hợp và lựa chọn thiết kế của nhóm, không phải chứng minh
phương pháp hiện tại vượt các công trình trên. Các robust spread/error floor
là ngưỡng kỹ thuật, không phải khoảng tin cậy thống kê đã hiệu chuẩn. Không
coi hàng trăm tỷ số từ vài điểm phụ thuộc nhau là hàng trăm mẫu độc lập.

## Điều tra và sửa thiết kế trước holdout

[Chẩn đoán từng ca](TIP-65-M3G-DIAGNOSIS.md) tái hiện đúng 100 khung
ở cả hai nhánh cũ: 0 sai khác với receipt đã ghi. Cả 10 ca có camera gate
hợp lệ; không thể quy tất cả cho thiếu pose. Bốn ca bị trần crop 192 px,
các ca khác bị flow, association, deformation, cắt mép hoặc thiếu detection.
Cả 10 ca có optical-Z giảm theo nhãn đối chiếu. Không xóa ca dương để
biện hộ bằng khác biệt giữa range và looming.

Ứng viên cửa sổ đầu tiên trên tập development cũ đạt 1 TP, 9 FN, 0 FP
trên 15 lượt âm; chưa đạt. Kiểm thêm phát hiện điểm khởi tạo bị loại dần
mãi theo tuổi track, dù cửa sổ chỉ dài 800 ms. Cơ chế này vẫn buộc xóa
lịch sử khi texture thay đổi. Cho phép đúng một sửa cấu trúc trước khóa:
giữ ảnh mốc ROI có ngân sách và đối chiếu trực tiếp current–anchor, làm
mới điểm cho identity sau cặp đã kiểm. Không hạ sàn tăng trưởng để sửa
ca 319,49 ms sát biên 320 ms. Không phát báo xuyên gap/cut/mất pixel.

Hai clip mới gồm 100 ảnh, tổng 40 nhãn LiDAR đồng bộ; checkpoint cố định
được xem trước mọi dự đoán mới. [Quyết định 2D](evidence/tip65/m3g-boreas-reviewed-2d.json)
ghi cả vùng bị che/mơ hồ bị loại, không coi vật bị loại là không tồn tại.
Đây là review của AI, không phải kiểm độc lập bởi người. Bộ ảnh thuộc
Boreas objects-v1, theo [CC BY 4.0 của đơn vị phát hành](https://github.com/utiasASRL/pyboreas/blob/master/DATA_LICENSE.md).
Các đoạn không trùng cửa sổ M3F nhưng vẫn cùng recording, chưa chứng minh
khả năng khái quát qua camera/thời tiết/thành phố khác.

Các ca static/zoom/pan/shake/local-scale được dựng thêm từ một ảnh mới
đã khóa hash. Đó là chuyển đổi có chủ đích, không phải cảnh quay thực hay
chứng cứ độ chính xác vật lý. Nhãn không được đọc trong replay; chỉ scorer
đọc sau khi có receipt. A/B/C dùng chung detection YOLOv3 Core ML hiện có;
không tải model mới hoặc coi thay detector là đã chữa lỗi temporal evidence.

Kiểm định độc lập runner phát hiện cần khóa thêm số hữu hạn của stream
clock, đối chiếu thời gian từng exposure, từ chối cảnh báo ở detector gap
và claim mét lồng trong track. Đây là ca đối kháng của bộ xác minh, không
phải bằng chứng các receipt thực đã ghi số mét bịa. Sửa và thêm test trước
khi chạy holdout.

### Quyết định đổi hướng, ghi trước mở holdout

Sửa ảnh mốc (R2, hash `cfb55ae…`) vẫn 0 TP / 10 FN trên development,
trong khi cửa sổ tích lũy ban đầu (R1) có 1 TP / 9 FN. Do đó **không
chọn R2 làm nâng cấp chỉ vì unit test đạt**. Bổ sung một thử nghiệm có
giới hạn: DIS dense flow trên CPU có sẵn, không tải dependencies/model,
đối chiếu trực tiếp với sparse KLT. Đây là thay cách tìm tương ứng pixel,
không quét ngưỡng cảnh báo. Giữ R1, R2 và box-only trong bảng so sánh;
không ghi đè kết quả thất bại. Clip mới vẫn chưa chạy dự đoán khi quyết
định này được ghi. Sau đúng một lượt DIS development sanity, khóa các
nhánh rồi chạy holdout; không sửa theo đáp án mới.

Runner cuối dự kiến: A=M3E, B=cumulative KLT native, C=B không native,
D=DIS, E=anchor KLT (R2), S=box-only. S vẫn không là fallback sản phẩm.
M1 Max 32 GiB là máy đo của vòng này, không giả định các phép đo trên
Mac chứng minh hiệu năng iPhone hoặc cam laptop không có pose đồng bộ.

Khóa trước holdout: Window `4981561e…`, DIS `98c5a0f0…`, runner
`af27a473…`. [Development sáu nhánh](evidence/tip65/m3g-six-development-score.json)
tái hiện B=1/10 TP, C=1/10, D=0/10, E=0/10, A=0/10; S=3/10 nhưng
chưa qua kiểm âm zoom. DIS không cho lợi ích trên tập khó đã biết.
Không có nhánh nào đủ cơ sở nâng lên production. Vẫn chấm toàn bộ các
nhánh trên holdout đã khóa để công bố cả thất bại và báo nhầm, không sửa
thuật toán theo kết quả sắp mở.

## Verify

**Kết luận: NOT READY. Đã triển khai và thử các ứng viên, chưa chứng minh
giải pháp mới tốt hơn trên clip thật. Không tích hợp vào app, không deploy,
không dùng việc unit test đạt để đổi kết luận này.**

### Clip thật mới, sau khóa mã

[Score](evidence/tip65/m3g-boreas-score.json) gồm 100 khung, 10 checkpoint
được review, 23 target-checkpoint: 10 tiến gần, 8 không tiến gần, 5 chưa rõ.
Một vật xuất hiện lặp lại ở nhiều checkpoint; không gọi đây là 10 episode
độc lập hoặc tỷ lệ chất lượng ngoài thực địa.

| Nhánh | Bắt đúng / 10 | Bỏ sót / 10 | Báo nhầm / 8 âm | Báo ở khung chưa có nhãn |
|---|---:|---:|---:|---:|
| A: M3E gốc | 1 | 9 | 0 | 0 |
| B: cumulative KLT + native | 0 | 10 | 0 | 2 |
| C: cumulative KLT không native | 0 | 10 | 0 | 4 |
| D: cumulative DIS + native | 1 | 9 | 0 | 5 |
| E: KLT ảnh mốc + native | 0 | 10 | 0 | 1 |
| S: chỉ kích thước hộp | 6 | 4 | 0 | 93 |

Cả 10 checkpoint dương có detector cùng họ đạt overlap IoU 0,35; camera
gate tại các checkpoint đều hợp lệ. **Thiếu bounding box hay camera gate
hiện tại không giải thích các ca này.** Khoảng trống trong lịch sử vẫn có
thể làm mất cửa sổ, nên không suy rộng thành detector không có vấn đề ở
mọi khung. Xem [điều tra holdout từng ca](TIP-65-M3G-HOLDOUT-DIAGNOSIS.md).

Ở 4/6 lần D thiếu flow, cặp hiện tại vẫn giữ 86–97% điểm, nhưng không còn
60% cohort seed ban đầu. Gate cấp ID mới, xóa cửa sổ. Đây là lỗi khớp vòng
đời feature với object identity, không phải cứ thêm dense flow là giải được.
B còn có các ca mất correspondence thật, fit kém và growth không đồng nhất;
không được đơn giản bỏ mọi điều kiện support hay MAD.

### Đối chứng ảnh thật biến đổi có chủ đích

[Tổng hợp](evidence/tip65/m3g-controls-score.json) liên kết hai score có hash;
không cộng percentile thời gian. Sáu đoạn từ một ảnh, 120 khung, gồm 80
khung âm toàn cảnh (static/zoom/pan/shake) và 40 khung local-scale.

- Trên 30 target-frame dương được dựng: A=0 TP/30 FN; B/C/D/E mỗi nhánh
  4 TP/26 FN; S=2 TP/28 FN. Chỉ 13/30 target-frame có detection overlap
  đủ ngưỡng, nên tập này có thêm bottleneck detector/ảnh biến đổi. Các
  báo ở hàng xóm không được review vẫn ghi riêng, không tự coi là đúng.
- Trên 80 khung chắc chắn âm: A–E không phát báo. S phát **53 báo sai toàn
  cảnh**: zoom 50, pan 2, shake 1. Trong đó chỉ 4 khớp đúng hai target-frame
  đã vẽ; 49 báo khác ngoài hai target. Chỉ công bố FP=4 sẽ che giấu phần lớn
  lỗi của baseline S. Không bật S làm fallback để làm demo trông hoạt động.
- Đây không phải clip quay độc lập, không có xác nhận vật lý/human QA.
  Cửa sổ local scale cũng có thể biến đổi hàng xóm bên trong envelope;
  báo không khớp ở clip dương chưa thể phân xử như FP hay TP.

### Chi phí và thời gian đã đo

Dùng cùng model YOLOv3 FP16 Core ML, cùng 220 exposure mới, trên M1 Max
32 GiB; nhãn/pose tham chiếu phục vụ chấm được tách khỏi RGB/detection
runtime (pose camera đồng bộ là đầu vào runtime được phép). Không có lượt
API trả phí, tải thêm model hay cài dependency. Cached development không
được tính là chạy model mới. Các control pose/intrinsics là dữ liệu dựng.

Trên clip thật mới, p95 phần tracker: A 53,04 ms, B 88,45 ms, C 36,72 ms,
D 192,18 ms, E 263,86 ms. p95 detection riêng 42,51 ms. Đây không phải
end-to-end latency, không cộng các percentile để suy FPS. Decode/prepare
nguồn còn p95 193,18 ms và runner offline staging toàn clip trước inference.
DIS/anchor tốn thêm compute mà chưa đổi lấy outcome tốt hơn. Không có
bằng chứng để hứa real-time hay đem độ mượt này suy sang iPhone.
Baseline đơn giản ở vòng này là tool detector + box trend (S). Không chạy
lại direct VLM/LLM, không suy ra đã vượt phương án LLM/agent tổng quát;
không ghi chính xác tổng công con người nên không công bố tỷ lệ tiết kiệm.

### QA kỹ thuật và thay đổi thực tế

- [Receipt QA cuối](evidence/tip65/mac-readiness/runs/2026-11-16T04-33-50-740Z-47f49de9/summary.json):
  178/178 Python, 121/121 Swift, 8/8 QA policy, TypeScript đạt;
  fingerprint trước/sau không đổi. Không build/cài thiết bị trong vòng này.
- Tái hiện chẩn đoán M3F 100 khung × A/B và M3G 100 khung × B/D: không
  sai khác status/event/reason. 23 test sparse/dense và 12 probe guard
  kiểm riêng epoch/gap/duplicate/mất detection là test cơ chế, không là
  chứng nhận model ngoài đường.
- Vá bốn lỗi kiểm cache/receipt, ràng buộc full frame set/stream clock,
  từ chối NaN, gap event và metric claim trong track. Các source parser,
  pose validator, scorer, thuật toán và model có fingerprint trong receipt.
- Mọi lane ở 220 exposure mới có explicit-null metres: 1.320 lượt kiểm
  hợp đồng, không phải 1.320 phép đo mét hoặc mẫu độc lập.
- Ba thuật toán thử nghiệm chỉ được gọi qua runner Mac. Không đổi app,
  không đổi baseline M3E, không sửa nhãn cũ, không commit/push/deploy.
  Scratch staging/test được tự dọn; không tạo bản sao project/build folder
  hay venv ngoài repo. Giữ dữ liệu/receipt R&D có chủ đích để tái kiểm.

### Hướng tiếp theo, chưa là bản vá đạt

Thiết kế lại vòng đời **object identity / feature cohort / valid measurement**
thành các trạng thái độc lập. Một cohort mất support không tự đồng nghĩa
vật mới; điểm mới không được ghép giả vào trajectory cũ. Cần tracklet/cohort
có thời hạn, tái xác minh bằng pixel thật, và uncertainty qua thời gian;
không chỉ đổi mẫu số seed, hạ MAD hoặc bỏ flow veto. Tách tín hiệu “vật hiện
diện/ảnh lớn dần” khỏi kết luận tiến gần vật lý và khỏi cảnh báo nguy hiểm.

Phép so sánh tiếp theo phải khóa thiết kế trước một holdout mới, có viewpoint,
che khuất, vật cạnh nhau, camera đi/lắc/zoom và số báo sai theo thời gian.
Giữ M3G thất bại như regression, không dùng lại nó làm “clip mới”. Nếu không
có lợi ích đo được so với baseline đơn giản đã kiểm camera, tiếp tục hẹp
phạm vi hoặc thay phương pháp, không tiếp tục tích lũy lớp vá.

### Tái tạo vòng chính

```sh
qa="$PWD/native/ios/.build-xcode/scene-qa"
py="$qa/venv/bin/python"
yolo="$PWD/native/ios/.build-xcode/Build/Products/Release-iphoneos/AssistiveDepthProbe.app/YOLOv3FP16.mlmodelc"
"$py" scripts/assist_scene_m3g_study.py replay --input "$qa/boreas-m3g/input.json" --sceneqa "$qa/sceneqa" --yolo "$yolo" --output "$qa/m3g-boreas-rerun.json"
"$py" scripts/assist_scene_m3g_study.py score --input "$qa/boreas-m3g/input.json" --truth "$qa/boreas-m3g/truth-reviewed.json" --receipt "$qa/m3g-boreas-rerun.json" --output "$qa/m3g-boreas-rerun-score.json"
npm run qa:assist-scene-mac -- --typecheck
```

Mỗi output replay/score phải là đường dẫn chưa có, không ghi đè bằng chứng.
Controls chạy riêng `input-negatives.json` và `input-positives.json` cùng
truth tương ứng trong `$qa/m3g-controls`; master sáu clip chỉ là inventory,
không nới giới hạn loader 2–5 clip.
