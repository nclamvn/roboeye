# TIP-65 · RoboEye Assist: Hiểu cảnh và không gian

## Milestones

1. **M1 — Nghe cảnh:** iPhone / camera sau, nút mô tả, đếm người bên phải,
   thay đổi đã quan sát và dừng lời nói. Tận dụng YOLOv3, tracker và số đo đủ
   tin cậy hiện có. Bản đầu là mốc đối chứng không sinh văn bản bằng VLM.
2. **M2 — Đối chiếu VLM:** mô tả tự do bằng tiếng Việt từ ảnh/khung chọn lọc,
   so cùng cảnh với M1 và VLM có ngữ cảnh. Ưu tiên SmolVLM2 500M và
   Qwen3.5-0.8B; chỉ chuyển model qua gate quyền, chất lượng và thiết bị.
   Kiểm thử trên Mac, không cần iPhone: [M2A · SmolVLM2](TIP-65-M2-MAC.md),
   [M2B · Qwen3.5 và YOLO](TIP-65-M2B-QWEN-MAC.md).
3. **M3 — Thay đổi và hướng:** kiểm chứng bù quay đầu bằng pose, quan hệ
   người-vật, ngắt/tạm dừng, giọng tiếng Việt và tải kéo dài trên máy thật.
   [M3 trên Mac: bằng chứng cho mét và bù dịch camera](TIP-65-M3-MAC.md).
   [M3B trên Mac: clip xe buýt, lia nhanh, camera tiến và che khuất](TIP-65-M3B-MAC.md).
   [M3C trên Mac: đối chiếu pose camera và fixture tổng hợp](TIP-65-M3C-MAC.md).
   [M3–M3C trên dữ liệu giao thông thật có pose và nhãn 3D](TIP-65-M3C-REAL-MAC.md).
   [M3D trên Mac: pose tích lũy và dấu hiệu tiến gần](TIP-65-M3D-MAC.md).
   [M3E: ảnh gốc cho vùng nhỏ và nối dấu ngắn](TIP-65-M3E-MAC.md).
   [M3F: nhận diện lại ROI và hardening trước khi có iPhone](TIP-65-M3F-MAC.md).
   [Cổng kiểm tra Mac một lệnh](TIP-65-MAC-READINESS.md).
4. **M4 — Kính:** nguồn camera qua adapter riêng; kiểm SDK, quyền phát hành,
   độ trễ, pin và mất kết nối. Kính RGB không mượn số mét LiDAR của điện thoại.
5. **M5 — Pilot:** đồng thiết kế cùng người khiếm thị và chuyên gia định hướng,
   đo tỷ lệ hiểu, báo sai/bỏ sót và tải âm thanh. Không hướng dẫn qua đường,
   không thay gậy trắng hay khẳng định lối đi an toàn.

## Hợp đồng M1

Nguồn duy nhất là kết quả phiên nhận diện sẵn có. Không giữ pixel, không dùng
mic, không ghi lịch sử xuống đĩa, không gọi mạng, không tự nói khi đang quét.
Nút to theo bố cục điều khiển native: nền tối hiện có, chữ hệ thống co theo
Dynamic Type, hành động “Nghe cảnh” xanh sáng với chữ tối, màn hỏi dạng
sheet gọn có 3 lựa chọn, một kết quả có thể đọc lại bằng VoiceOver và nút dừng.
Giữ camera hữu dụng, không thêm thẻ trang trí hay một màn hình demo tách rời.

- A1: mô tả tối đa 3 nhóm trong khung hình, đếm bên phải bằng tọa độ đã căn
  với góc nhìn hiển thị. Dùng “ít nhất” cho số người nhận diện được, không
  coi không phát hiện là không có người. Không đoán danh tính/tuổi/hành động.
- A2: chỉ dùng track nhìn thấy, không coast, tuổi dưới ngưỡng. Số mét chỉ
  từ cổng đo hiện hữu, tối đa 300 ms, không kéo dài TTL. Đơn vị là tới bề
  mặt từ camera, không phải khoảng trống đi bộ.
- A3: lịch sử RAM ngắn có giới hạn. Chỉ nói “mới thấy” với track xác nhận
  qua nhiều frame, không suy ra vật tự di chuyển hoặc xuất hiện trong thế giới.
- A4: khi dừng, nền, đổi orientation hoặc đổi mode thì bỏ lịch sử, hủy lời
  nói và xóa kết quả. Giọng ưu tiên vi-VN nếu có trên máy; nếu thiếu thì
  vẫn có câu trả lời đọc được bằng công cụ hỗ trợ tiếp cận, không giả tiếng Việt.
- A5: regression test Swift và UI simulator; model/giọng/camera/pin thật
  là gate riêng. Mẫu simulator có đánh dấu mô phỏng. Không đụng DriveSense,
  SDK kính, server, chi phí API, commit/push hoặc cài thiết bị trong M1.

Đối chứng M2: cùng cảnh và câu hỏi, A = VLM trực tiếp từ ảnh, B = cùng VLM
có thêm quan sát từ detector/tracker, C = M1 chỉ từ quan sát đã xác nhận.
Chấm từng claim, trả lời không đủ dữ liệu, mô tả lặp, độ trễ đầu-cuối,
nhiệt và nỗ lực của người dùng. Chưa có phép đo hay tuyên bố thắng đối chứng.
Thiếu model hoặc người đánh giá không được điền bằng kết quả mô phỏng.

## Completion / Verify M1 · 13/11/2026

**Trạng thái: đã triển khai và build; chưa nghiệm thu trên thiết bị.**
App local 0.3.0 / build 6 giữ nguyên bundle ID và model YOLOv3. Ba câu hỏi
tạo bản tóm tắt từ quan sát đã có, không có mô hình sinh văn bản trong M1.
Lõi dùng tối đa 12 track hiện tại và 48 mục lịch sử trong 3 giây; không giữ
pixel hay dùng mic. Các luồng web/DriveSense không đổi.

| Gate | Kết quả |
|---|---|
| A1 · đếm thận trọng, hướng hiển thị, tối đa ba nhóm | PASS với track fixture; chưa đo độ đúng trên camera iPhone |
| A2 · từ chối dữ liệu cũ, kiểm tra 300 ms tại thời điểm hỏi, không mượn mét | PASS với track fixture; chưa đối chiếu sai số vật lý |
| A3 · thay đổi theo nhiều quan sát, không suy ra chuyển động từ bbox | PASS với track fixture; chưa thử cảnh quay đầu thực tế |
| A4 · UI, VoiceOver, TTS, hủy lời khi phiên hết hiệu lực | Đã tích hợp, build PASS; XCTest giao diện đã biên dịch, chưa chạy; chưa nghe trên máy thật |
| A5 · kiểm máy và cô lập phạm vi | Swift 117/117, gồm 11 ca mới; Release iPhone unsigned và Debug simulator build-for-testing PASS |

- Bằng chứng riêng: model Apple YOLOv3 FP16 đúng SHA-256, model đóng trong
  bundle cùng LICENSE. Model Core ML thật nhận ra lớp dự kiến trong 2/2 ảnh
  công khai đã ghim khi chạy trên Mac. Đây là smoke, không chấm số lượng,
  độ phủ, độ trễ hay chất lượng tiếng Việt. Một ảnh có nhiều box người;
  không có nhãn số người để suy ra đếm đúng.
- Xcode 27.2 có iOS simulator SDK nhưng không có runtime đã cài. iPhone 16 Pro Max
  được liệt kê là unavailable. Không cài runtime nhiều GB hay cài app lên phone
  trong đợt này. Cache build tái dùng ở native/ios/.build và .build-xcode.
- Phân vai: Builder làm lõi/Swift test; phần tích hợp và kiểm tra cổng được
  thực hiện riêng. Không có đánh giá người dùng độc lập hoặc benchmark VLM.
- Chưa mua/tải VLM, gọi API, push hoặc deploy. Đối chứng M2 là công việc tiếp theo,
  không tuyên bố M1 hơn Magnifier hay một VLM trực tiếp.

## Test trên iPhone khi thiết bị khả dụng

Mở project Xcode hiện tại, giữ Team/bundle ID, chọn iPhone thật và Run.
Xác nhận đầu màn hình hiển thị 0.3.0. Đứng yên ở phòng có người đồng ý
tham gia, mở camera sau ở chế độ Tự động và vào Nghe cảnh:

1. Đặt một người trái, một người phải; hỏi tổng cảnh và bên phải. Cho người
   bên phải bước ra khỏi khung rồi thử lại. Ghi cả sai số lẫn lần app từ chối.
2. Đưa một vật đã biết vào sau khi cảnh ổn định; hỏi ngay thay đổi. Quay
   điện thoại ngang, vào nền và mở lại; không được giữ câu cũ hoặc tự bật camera.
3. Nghe qua loa và tai nghe; thử VoiceOver, đổi câu hỏi giữa lúc đọc, Dừng đọc.
   Không có giọng vi-VN thì xác nhận transcript vẫn dùng được và báo thiếu giọng.
4. Nếu lời nói không tự dừng, nghe khó hiểu, hoặc có số/nhãn không đúng,
   ghi tình huống và phiên bản. Không thử khi đi một mình, qua đường hay ở cầu thang.
