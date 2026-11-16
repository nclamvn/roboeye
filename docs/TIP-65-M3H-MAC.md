# TIP-65 M3H: tách ID vật thể khỏi feature cohort

Ngày 16/11/2026. Phạm vi Mac, không iPhone/deploy/commit, không suy ra mét.

## TIP, trước triển khai và mở holdout

Người dùng giao tách ID vật thể khỏi vòng đời nhóm điểm bám, kiểm trên clip
mới, ghi cả báo nhầm và bỏ sót; thiếu bằng chứng không báo. M3G xác nhận
cohort seed hao hụt làm reset cả ID và cửa sổ dù cặp ảnh hiện tại còn tốt.
Không giải bằng bỏ support gate, hạ MAD hay nâng số cảnh báo cho đẹp.

Một ứng viên: `CohortWindowLoom`. Object identity giữ detection, tuổi, box và
appearance riêng. Association phải unambiguous, cùng lớp, phù hợp hình học
và ảnh ROI mới. Flow failure không tự tạo ID mới nếu identity có bằng chứng
độc lập. Identity có mặt không đồng nghĩa phép đo có mặt.

Mỗi ID quản lý tối đa ba cohort có tuổi/seed/history riêng; mỗi cohort tối
đa 64 điểm, ROI <=384 px/cạnh, hết hạn <=800 ms, khởi tạo theo cadence hữu
hạn. Không nối điểm mới giả vào lịch sử cũ, không dùng tuổi ID làm tuổi đo.
Cohort chết không giết ID hoặc cohort khác. Chỉ cảnh báo nếu có cohort đủ
tuổi và có pixel support ngay hiện tại, không mâu thuẫn cohort còn hợp lệ.
Mất detection, occlusion/association mơ hồ, cut, epoch/pose/zoom/clock không
hợp lệ thì không phát. Không coast cảnh báo qua gap. DIS và các sàn
FB/NCC/coverage/shape/angular-growth/time của M3G được tái dùng, không quét
ngưỡng trên holdout. Giữ nguyên baseline và nhãn lịch sử.

## Đối chứng và dữ liệu

- A: M3G DIS cũ, B: tách ID/cohort + native, C: B không native, S: box-only
  đối chứng tool đơn giản, không fallback. Cùng detector YOLOv3 FP16 Core ML,
  cùng pixels, camera pose/calibration và clocks; không gọi lại direct VLM
  trong vòng này, không tuyên bố đã vượt LLM/agent.
- Development: M3F/G đã xem và các control đã ghi, chỉ tái dùng detection
  khi đầy đủ ràng buộc input/model/executable/staging/config/source hashes.
- Holdout M3H mới cố định trước xem RGB/detection: `1598989109031027`
  (50 khung, tốc độ camera trung bình 8,203 m/s) và `1598991443097712`
  (50 khung, 11,548 m/s). Không trùng cửa sổ M3C-G, chọn từ pose metadata.
  Cùng chuyến Boreas nên không coi là bằng chứng khái quát đa miền.
- Review 2D checkpoint trước inference, giữ nhãn 3D vật lý, loại riêng ca
  hình chiếu mơ hồ có lý do; review của AI không phải human certification.
  GT chỉ dành cho scorer, không vào tracker. Tính FP/FN trên cùng target-
  checkpoint; unknown/unmatched/unreviewed và âm toàn cảnh ghi riêng.
- Giữ các control âm static/zoom/pan/shake M3G làm regression đã biết, không
  gọi chúng là clip thật mới. Nếu có control bổ sung phải ghi dữ liệu dựng.

Đã bổ sung 80 khung âm từ ảnh đầu đoạn M3H urban, khóa hash trước inference:
static, digital zoom không khai báo, camera quay và rung theo pose dựng.
`scripts/assist_scene_m3h_controls.py` tái dùng hình học đã có, truth đánh
dấu âm toàn cảnh, không cần đoán/vẽ hộp từ detector. Đây là biến đổi của một
ảnh, không phải 4 lần quay thật. Mọi cảnh báo trên 80 khung này là báo sai
toàn cảnh; không dùng số target-FP bằng 0 khi danh sách target rỗng để quảng
cáo chất lượng. Nguồn Boreas theo [CC BY 4.0 của đơn vị phát hành](https://github.com/utiasASRL/pyboreas/blob/master/DATA_LICENSE.md).

## Điều kiện kiểm và giới hạn

1. Chứng minh ID giữ qua mất cohort/đổi texture có appearance hỗ trợ; không
   báo bằng history cũ, không nối nhầm vật cạnh nhau hoặc qua cut/epoch.
2. Chứng minh cohort mới cần tuổi riêng, cohort già hết hạn, alternate cohort
   chỉ tiếp tục khi còn phép đo mới đủ mạnh; mất tất cả bằng chứng thì im.
3. Khóa mã trước holdout; đo TP/FN/FP và latency từng stage. Thử âm có zoom,
   lia, rung, bbox-only growth, gap và occlusion. Không lấy 0 báo = an toàn.
4. Một thiết kế và tối đa một sửa dựa trên development/cơ chế trước khóa.
   Không sửa theo kết quả holdout; giữ thất bại, không thêm model/API/deps.
5. Main Contractor kiểm độc lập output của Builder; technical QA không tự
   chứng minh chất lượng chuyển động, độ chính xác mét hoặc real-time.

Disk preflight: 50 GiB free, trên ngưỡng 10 GiB. Tái dùng checkout/runtime,
không copy project hoặc tạo build directory mới. Giữ nguồn R&D có mục đích;
scratch có tên được tự dọn. Chưa đo công người/hóa đơn compute, không ghi 0.

## Verify

### Sửa một cơ chế trước holdout

Ứng viên đầu (engine `a4f43d8e…`) trên M3G development có B=0/10 TP,
A DIS gốc=1/10, FP=0/8 ở cả hai. ID đã không còn bị xóa theo cohort, nhưng
phép so appearance 32×32 vẫn có thể reset ID vì hộp detector rung. Một ca
đã xác minh trước sửa: traffic index10, white car, correlation 0,69728 dưới
sàn 0,70, trong khi 46/46 điểm mới từ ảnh trước qua đầy đủ gate flow.

Sửa duy nhất trước khóa: association reciprocal rõ ràng + (appearance đủ
hoặc certificate pixel một cặp ảnh mới). Nhánh pixel gieo điểm độc lập từ
ảnh trước, không lấy seed gốc của cohort cũ; vẫn qua FB/NCC/spread/shape.
Certificate này **chỉ xác nhận ID**, không tạo thêm mẫu, tuổi hoặc phép đo
cho cohort. Một field DIS được dùng lại cho các cohort để không nhân số
lần flow. Không hạ sàn appearance hay sàn tăng trưởng/camera. Test ảnh
rung hộp và lookalike khác texture được thêm trước khi chấm holdout.

Khóa engine `b7915e19…`, runner `a0fdb7a3…`; 20 test cơ chế của engine
và 8 test runner đạt trước mở holdout. Chưa có kết luận cải thiện trên dữ
liệu mới hoặc sẵn sàng sản phẩm.

[Development sau sửa](evidence/tip65/m3h-development-final-score.json):
B=1 TP/9 FN so với A=1 TP/9 FN, FP=0/8 ở cả hai. B có 1 báo trên target
chưa rõ và 8 báo ở khung chưa được review, không tự tính chúng là đúng.
Đây chỉ là kiểm cơ chế trên dữ liệu đã biết; chưa chứng minh recall mới.
Không sửa thêm thuật toán sau kết quả này. Bộ holdout mới đã khóa 27
target-checkpoint: 21 tiến gần, 3 không tiến gần, 3 chưa rõ. Giữ cả vùng
tối, người/xe đạp, vật che nhau/cắt mép; không loại candidate nào sau xem
ảnh. Không coi 3 ca âm là đủ đo báo nhầm, nên kiểm thêm 80 khung âm toàn
cảnh từ ảnh M3H mới và ghi riêng loại bằng chứng.

## Completion / Verify sau khóa mã

**Cơ chế tách vòng đời đã triển khai và được kiểm trên Mac. Chất lượng
phát hiện tiến gần vẫn NOT READY; không tích hợp hoặc quảng bá như bản
đã sửa xong bỏ sót.** Không đổi thuật toán/nhãn sau khi mở holdout.

### Hành vi thực của ID và cohort

[Audit độc lập và số đếm được Contractor tính lại](evidence/tip65/m3h-lifecycle-audit.json)
ghi nhận trên 100 khung quay thật mới:

- 69 identity-observation giữ ID trong khi 80 cohort bị loại/hết hạn.
  Cả 69 quan sát không phát cảnh báo hiện tại bằng bằng chứng đã mất.
  Đây là chứng cứ tách vòng đời trên pixels thật và detection thật, không
  chỉ là mock/unit test.
- 5/69 quan sát vẫn có cohort khác đủ tuổi và cập nhật ở khung hiện tại,
  nhưng không nhất thiết có growth được xác nhận. Không coi đủ tuổi là
  đã đo được hoặc bắt buộc phải cảnh báo.
- Số ID nội bộ được cấp A=603, B=411. Đây chỉ là dấu hiệu giảm fragmentation
  trong bộ đếm nội bộ, **không phải chứng minh đúng ID vật lý hay điểm MOT**.
  Chưa có nhãn 2D identity mọi frame để cấp chứng nhận đó.
- Không giữ ID qua khung không có detection trong vòng này. Mọi cohort
  bị xóa qua gap, không coast warning; tái xuất hiện phải gây dựng phép
  đo mới. Short-gap re-ID chưa được bổ sung, không ngầm tuyên bố đã có.

### Số liệu cảnh báo

[Clip quay thật mới](evidence/tip65/m3h-boreas-score.json): 100 khung, 10
checkpoint, 27 target-checkpoint (21 tiến gần, 3 âm, 3 chưa rõ). Một vật có
thể được kiểm nhiều lần; 21 không phải 21 episode độc lập.

| Nhánh | Bắt đúng / 21 | Bỏ sót / 21 | Báo nhầm / 3 âm | Báo ở frame chưa review |
|---|---:|---:|---:|---:|
| A: dense cumulative M3G | 0 | 21 | 0 | 3 |
| B: ID/cohort độc lập + native | 0 | 21 | 0 | 4 |
| C: B không native | 0 | 21 | 0 | 1 |
| S: box-only, không fallback | 4 | 17 | 0 | 141 |

Không tự tính báo ở frame chưa có nhãn là TP/FP. Nhánh mới chưa cải thiện
outcome cảnh báo trên holdout này, dù đã sửa sự phụ thuộc vòng đời.

[80 khung âm mới](evidence/tip65/m3h-controls-score.json), là biến đổi của
một ảnh M3H: A/B/C không có cảnh báo sai toàn cảnh. S có 18: zoom 15, pan
3. Không ghi FP/TN theo object trên tập này vì không vẽ hộp từng vật;
danh sách target rỗng và nhãn âm áp dụng toàn cảnh. 0 báo/80 khung không
chứng minh an toàn thực địa. [80 khung âm cũ](evidence/tip65/m3h-old-controls-final-score.json)
chỉ là regression: A/B/C=0 báo sai, S=53; không gọi là test độc lập mới.

### Vì sao còn bỏ sót

Audit chỉ đọc checkpoint hiện tại, không phải causal replay toàn bộ:

| Veto quan sát đầu tiên, không đếm trùng | Số mốc dương |
|---|---:|
| Không có detection cùng họ đạt IoU 0,35 | 5 |
| Có detection nhưng cổng camera hiện tại không hợp lệ | 6 |
| Camera/detection hợp lệ nhưng vật nhỏ/cắt mép | 1 |
| Camera/detection hợp lệ nhưng chưa xác minh identity | 1 |
| Giữ được identity nhưng chưa có cohort đủ tuổi/support | 8 |

Trong 8 mốc cuối: 6 còn cohort chưa trưởng thành, 2 không còn cohort.
Giữ ID không được cộng giả thời gian đo để chuyển chúng thành TP. Các
veto hiện tại có thể có nguyên nhân từ lịch sử; bảng không chứng minh
detector/camera là nguyên nhân duy nhất. Không nới camera/support/MAD
gate để đổi kết quả sau test. Bước tách ID cần thiết nhưng không đủ để
chữa mô hình đo chuyển động.

### Hiệu năng, provenance và QA

- M1 Max 32 GiB, model YOLOv3 FP16 Core ML và cấu hình detector giữ nguyên,
  180 exposure mới chạy model thật, dùng chung detection cho bốn nhánh.
  Không tải AI model/cài dependency/gọi inference API cloud. Dữ liệu R&D
  mới giữ lại có chủ đích để tái kiểm; không tạo bản sao toàn project.
- Trên 100 khung thật: p95 tracker A=96,74 ms, B=96,58 ms, C=50,07 ms.
  Không coi chênh 0,16 ms là lợi thế tốc độ. p95 decode/prepare=112,56 ms;
  riêng detection p95=40,58 ms. Các stage không cộng percentile để suy FPS.
  Offline runner staging trước và chạy bốn nhánh tuần tự; đây không phải
  end-to-end camera latency hay chứng minh real-time.
- B giữ tối đa 12 identity, 3 cohort/identity, 64 điểm/cohort; trên clip
  thật quan sát tối đa 12 cohort/637 điểm và tuổi 799,626 ms. Đây là số
  quan sát, không phải toàn bộ peak RAM. Flow field dùng chung cho các
  cohort của cùng object/pair; replacement seeds không vào history cũ.
- [QA kỹ thuật cuối](evidence/tip65/mac-readiness/runs/2026-11-16T04-59-38-061Z-c5ab16a7/summary.json):
  Python 207/207, Swift 121/121, QA policy 8/8, TypeScript đạt, fingerprint
  nguồn trước/sau không đổi, `git diff --check` đạt. Không build/cài/chạy
  iPhone hoặc UI camera live trong vòng này.
- Kiểm độc lập 20 test engine + 8 test runner, có thêm probe buộc mọi
  cohort chết, ép appearance-jitter và association mơ hồ. Các probe không
  đọc holdout. Contractor tự chạy replay/score, đối chiếu hash và đếm lại
  dữ liệu lifecycle, không lấy lời Builder báo DONE làm nghiệm thu.
- Mọi lane của 180 exposure mới có explicit-null metres: 720 lượt kiểm
  hợp đồng, không phải 720 phép đo khoảng cách/mẫu độc lập. Không suy ra
  mét hay TTC từ ảnh lớn dần, không dùng VLM đoán chuyển động.
- Source/receipts/scores giữ hash. Scratch staging trong
  `native/ios/.build-xcode/scene-qa/codex-tmp-assist-m3h-20261116-*` và các
  TemporaryDirectory kiểm thử `codex-tmp-m3h-*-20261116-*` đã tự dọn. Không
  xóa dữ liệu người dùng, không thêm venv/build folder ngoài repo.
- Chưa đo direct VLM/LLM trong vòng này; chỉ đối chiếu baseline tool S.
  Không công bố tiết kiệm tổng công, chi phí tiền tệ hoặc thắng agent
  tổng quát vì chưa đo những đại lượng đó. Review 2D của AI không là
  xác nhận semantic độc lập bởi người.

### Requirement coverage và disposition

Đã triển khai/kiểm 6 nhóm yêu cầu: (1) ID độc lập cohort, (2) cohort có tuổi
và support riêng, (3) không stale/gap warning, (4) không mét, (5) test mới
FP/FN có provenance, (6) chỉ Mac/không đụng iPhone. Nhưng lợi ích về recall
tiến gần chưa đạt. **Overall product status: NOT READY.**

Giữ engine nghiên cứu opt-in, không đưa vào app đang dùng. Không tiếp tục
thêm tracker hoặc chỉnh ngưỡng theo tập này. Ưu tiên kiểm riêng camera
agreement/visibility và phương pháp đo biến đổi ảnh/bề mặt trước khi mở
rộng, với benchmark mới đã khóa. Nếu không có outcome tốt hơn, bỏ lớp
không cần thiết hoặc đổi phương pháp, không lấy số ID đẹp làm proxy cho
cảnh báo đúng.

### Tái tạo

```sh
qa="$PWD/native/ios/.build-xcode/scene-qa"
py="$qa/venv/bin/python"
yolo="$PWD/native/ios/.build-xcode/Build/Products/Release-iphoneos/AssistiveDepthProbe.app/YOLOv3FP16.mlmodelc"
"$py" scripts/assist_scene_m3h_study.py replay --input "$qa/boreas-m3h/input.json" --sceneqa "$qa/sceneqa" --yolo "$yolo" --output "$qa/m3h-boreas-rerun.json"
"$py" scripts/assist_scene_m3h_study.py score --input "$qa/boreas-m3h/input.json" --truth "$qa/boreas-m3h/truth-reviewed.json" --receipt "$qa/m3h-boreas-rerun.json" --output "$qa/m3h-boreas-rerun-score.json"
npm run qa:assist-scene-mac -- --typecheck
```

Output replay/score phải là đường dẫn chưa tồn tại, không ghi đè lịch sử.
Control mới dùng `$qa/m3h-controls/input.json` và `truth.json`. Có thể tái
dùng detection từ receipt hash-bound để không gọi lại model khi chỉ kiểm
thuật toán; timing cache phải ghi là historical, không phải inference mới.
