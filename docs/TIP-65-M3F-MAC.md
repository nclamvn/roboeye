# TIP-65 M3F: nhận diện lại vùng ảnh gốc và chuẩn bị app khi chưa có iPhone

Ngày bắt đầu: 16/11/2026. Phạm vi: RoboEye Assist, không nâng cấp các nhánh cũ không liên quan.

## Hợp đồng và kế hoạch trước khi chạy

1. **Nhận diện:** thử nhận diện lại từ tối đa hai vùng ảnh nguồn mỗi khung, do detection hiện tại hoặc khung trước đề xuất. Không dùng nhãn chuẩn để chọn crop. Tách A: M3E và B: cùng tracker/luật cảnh báo nhưng thêm ROI. Không đổi model/ngưỡng theo ảnh holdout. Hộp thiếu/mơ hồ/cắt mép không được nối bằng suy đoán. Các ca phát hiện thêm và gán sai đều được giữ.
2. **Đầu ra:** nhận diện lớp là một đầu ra, tiến gần tương đối là một đầu ra khác. Đo riêng độ phủ hộp, báo nhầm, bỏ sót, liên kết ID khi có chuẩn đối chiếu. Không suy số mét/TTC từ RGB, không dùng VLM phát ngôn cảnh báo, không bật thực nghiệm Python trong app khi chưa có bằng chứng. Đối chứng LLM trực tiếp đã không qua M2B; vòng này không gọi lại model hoặc API không liên quan.
3. **Bằng chứng:** dùng lại M3E chỉ làm development, không đổi nhãn cũ. Holdout thật mới Boreas objects-v1 anchors `1598987513026635` và `1598990950088125` theo cadence/tốc độ camera, không trùng cửa sổ cũ. Kiểm 2D trực quan trước replay, không có human review; hình học LiDAR/pose chỉ ở bộ chấm. Đối chứng zoom/lia/rung từ M3E đã là dữ liệu đã xem, báo riêng; không coi là cảnh quay tay mới.
4. **App:** rà lỗi thực tế về kết quả trễ, dừng/mở lại, hướng máy, VoiceOver/giọng đọc và đồng hồ. Thay đổi cần test Swift; build iOS unsigned trên Mac. Không có thiết bị thì camera/sceneDepth, nhiệt, FPS/latency thực, độ chính xác LiDAR, việc cài và trải nghiệm âm thanh thực là **NOT TESTED**. Không tự tải runtime Simulator, model mới, thay signing hay deploy.
5. **QA lặp lại:** đóng gói lệnh kiểm local, fail nếu thiếu điều kiện hoặc test lỗi; fingerprint source, thời gian, log và những ca chưa đo. Phân biệt kỹ thuật pass với sản phẩm đủ tin cậy. Giữ cache nguồn/receipt phục vụ tái chạy, không copy dự án vào tmp.

### Ngân sách và điểm dừng

Một candidate ROI và một lần refinement nếu debug có nguyên nhân mới, tối đa hai crop/khung. Bộ chấm thật 100 khung mới và bộ đối chứng sẵn 80 khung; không rerun inference nếu chỉ sửa scorer. Không giữ phương án tăng chi phí mà không thêm giá trị trong số đo. Dừng nâng cấp cảnh báo nếu vẫn không cải thiện; xử lý phần app/test độc lập. Không hứa iPhone gần hoàn hảo khi chưa đo.

## Verify

### Nhận diện lại ROI: hoàn thành phép thử, không đưa vào app

Mã candidate khóa trước holdout: `assist_scene_roi_redetect.py` SHA-256
`9bd4ff4a824b7f26f9265f055790c65483007451ae529be8650d6772e08dd17b`;
runner `5d97ce10027b4303ae665597b5148705facc2ffe8fa7d427a46ba79a0c8c4133`.
Model Apple YOLOv3 FP16 giữ nguyên, Vision confidence 0,38 / NMS IoU 0,45.

| Phạm vi đo | A: M3E | B: M3E + ROI |
|---|---:|---:|
| Clip thật mới: phát hiện tiến gần / 10 lượt có nhãn | 0/10 | 0/10 |
| Clip thật mới: bỏ sót / 10 lượt có nhãn | 10/10 | 10/10 |
| Clip thật mới: báo nhầm / 15 lượt âm đã kiểm | 0/15 | 0/15 |
| Clip thật mới: có hộp chồng khớp / 30 lượt mục tiêu | 26/30 | 26/30 |
| Đối chứng dựng M3E: phát hiện / 13 lượt tiến gần | 0/13 | 0/13 |
| Đối chứng dựng M3E: báo nhầm / 144 lượt âm có nhãn | 0/144 | 0/144 |

Đơn vị là mục tiêu tại một khung, không phải sự kiện hay mục tiêu độc lập.
100 khung thật, 10 checkpoint, giữ 30/44 đề xuất sau đối chiếu trực quan,
5/30 có trạng thái tiến gần không xác định và không ép thành âm. Nhãn không
exhaustive; số hộp không ghép vào các hộp đã kiểm không được gọi là false
positive. 80 khung đối chứng dựng được dùng lại từ M3E: thử hồi quy, không
phải holdout hoặc clip cầm tay mới. Cả hai nhánh im lặng ở toàn bộ 64 khung
đứng yên/zoom/lia/rung đối chứng. 360 đầu ra nhánh–khung đều giữ mét `null`.

B thử 200 crop trên 100 khung thật, chấp nhận thay 93 hộp hiện tại nhưng
không khôi phục hộp mất nào ở hai clip mới. Trên nhóm tiến gần có nhãn,
9/10 đã có hộp chồng khớp ở A và B. Điều này **không** chứng minh detector
đã đủ tốt ở mọi cảnh; nó bác bỏ giả thuyết “chỉ thêm crop là giải được
recall cảnh báo” trong phép thử này. M3F dùng crop không có seed nên cũng
không tìm được mục tiêu bị full detector bỏ sót ngay từ đầu.

Trên Mac arm64, p95 phần tracker A 70,61 ms / B 89,47 ms; p95 thời gian
thực gọi ROI từ tiến trình Python là 584,90 ms (bao gồm nạp model/khởi tạo
tiến trình mỗi lượt). p95 ROI preparation + ROI call + merge + tracker B
đo trên từng khung là 663,70 ms. Không gọi đây là latency điện thoại hoặc
photon-to-audio. Full detector đã chạy batch dùng chung, không đo hai cách
như hai pipeline realtime cùng tải. Không thêm phí API, công người chưa đo.
Không tiếp tục tối ưu lớp ROI đắt khi chưa thấy tăng giá trị; giữ để điều tra,
không bật mặc định hay port nó sang iPhone.

Bằng chứng: [score clip thật](evidence/tip65/m3f-boreas-score.json),
[score đối chứng](evidence/tip65/m3f-controls-score.json),
[quyết định nhãn 2D](evidence/tip65/m3f-boreas-reviewed-2d.json).
Nguồn Boreas public objects-v1, [giấy phép CC BY 4.0 của đơn vị phát hành](https://github.com/utiasASRL/pyboreas/blob/master/DATA_LICENSE.md).
Lát cắt mới 323.923.796 byte, không tải toàn bộ dataset; ảnh/receipt nguồn
nằm trong cache cục bộ được Git ignore. Chỉnh ROI/resize phục vụ thử nghiệm,
không ngụ ý tác giả dataset chứng thực hệ thống.

### Native: thay đổi đã tích hợp

- **Bắt lại sớm có giới hạn:** khi Vision mất một hoặc toàn bộ track,
  `ObjectDetectionSchedule` yêu cầu detector sớm hơn, có sàn 100 ms
  (200 ms khi thermal limited), tôn trọng tải xử lý đo được và trần nhịp
  bình thường. Không chạy detector trên mọi callback, không bỏ retry/backoff,
  không khôi phục số đo cũ. Cảnh rỗng sau một detector thành công không tạo
  vòng chạy model liên tục.
- **Âm thanh:** ngừng lời đọc khi app mất hoạt động, VoiceOver đổi trạng thái,
  cuộc gọi/ngắt âm thanh hoặc thiết bị phát cũ mất kết nối. Không tự đọc lại
  snapshot cũ khi quay về. Người dùng hỏi lại để lấy mô tả mới.
- **Không thay nguồn số mét:** chỉ depth cùng frame qua gate hiện hữu; không
  thêm RGB/VLM fallback hoặc lời hướng dẫn lối đi an toàn.

Đã kiểm Swift 121/121, gồm 4 ca lịch phục hồi mới; Release iOS unsigned
build, static analyze và Debug iOS build-for-testing đều exit 0. XCTest giao
diện thêm ca dừng/đóng/mở lại đã biên dịch, **chưa chạy** vì không có iPhone
hoặc simulator khả dụng; không tự cài runtime. Model thật chạy smoke trên
Mac nhận lớp dự kiến trong 2/2 ảnh ghim (chim, người), hash/attribution
bundle đúng; không coi đó là recall thực địa. [Receipt model smoke](evidence/tip64b4/model-summary.json).

### Cổng QA và quyết định trước iPhone

Lệnh `npm run qa:assist-scene-mac -- --typecheck --native-build` kiểm công cụ
QA (bao gồm lệnh lỗi, timeout và hủy), Python scene, Swift core, TypeScript
và build iOS unsigned. Cổng có hash nguồn trước/sau; lượt đầu bị loại vì
nguồn còn đổi, giữ nguyên receipt lỗi thay vì ghi đè thành pass. Lượt kế
tiếp pass với 133/133 Python, 121/121 Swift và build/typecheck đạt; kiểm
web unit riêng 328/328. Phần UI review Mac có verify riêng sau khi hoàn tất,
không cộng trùng các lượt chạy lặp.

Lượt cuối sau khóa nguồn: [receipt QA](evidence/tip65/mac-readiness/runs/2026-11-16T04-03-15-327Z-ee190081/summary.json)
pass với **138/138 Python, 121/121 Swift, 8/8 ca công cụ QA**,
typecheck và Release unsigned build. Hash 83 file trước/sau giống nhau.
Release bundle thực đọc được phiên bản **0.3.0 (7)**; Debug iOS
build-for-testing và static analyze chạy lại sau cập nhật build number đều
exit 0. Test giao diện chỉ đã compile, không gọi đó là đã chạy simulator.

Màn hình [xem lại A/B trên Mac](http://127.0.0.1:4198/) dùng receipt thật,
không phải camera live, không được dùng để trình diễn như thể cảnh báo đã
đạt. [Verify UI](TIP-65-MAC-REVIEW.md) và [receipt browser](evidence/tip65/m3f-review-browser-check.json):
đã xem ảnh, phát/dừng/tua/đổi clip, 390 px không tràn ngang, không quan sát
lỗi JS hoặc request ngoài máy. Frontend-design được dùng để giữ ảnh là
nội dung chính, điều khiển cùng khung, màu dành cho phân biệt lớp và chẩn
đoán gập; không thay nhãn/hộp để làm đẹp số đo.

**Disposition:** kỹ thuật native hardening có thể build; tiếp cận ROI và
cảnh báo tiến gần vẫn **NOT READY**. Không có cơ sở hứa gần hoàn hảo trên
iPhone. Độ chính xác depth, nhận diện/bám lại, giọng đọc/VoiceOver/tai nghe,
EIS/rolling shutter và độ trễ/nhiệt 30 phút vẫn phải nghiệm thu trên thiết
bị thật. Còn thiếu recall là lỗi chức năng, không được dùng sự im lặng
hoặc số test xanh để gọi là đã an toàn.

### Tái chạy M3F

```sh
qa="$PWD/native/ios/.build-xcode/scene-qa"
export PYTHONDONTWRITEBYTECODE=1
py="$qa/venv/bin/python"
yolo="$PWD/native/ios/.build-xcode/Build/Products/Release-iphoneos/AssistiveDepthProbe.app/YOLOv3FP16.mlmodelc"
"$py" scripts/assist_scene_m3f_study.py replay --input "$qa/boreas-m3f/input.json" --sceneqa "$qa/sceneqa" --yolo "$yolo" --output "$qa/boreas-m3f-rerun.json"
"$py" scripts/assist_scene_m3f_study.py score --input "$qa/boreas-m3f/input.json" --truth "$qa/boreas-m3f/truth-reviewed.json" --receipt "$qa/boreas-m3f-rerun.json" --output "$qa/boreas-m3f-rerun-score.json"
```

Runner chỉ chấp nhận tên đầu ra mới; không ghi đè receipt tốt hoặc dùng nhãn
để sửa ngưỡng. JPEG staging/crop nằm trong thư mục tạm bên trong cache,
được xóa tự động sau mỗi replay; dữ liệu gốc giữ để tái kiểm.
