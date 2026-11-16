# TIP-65 · Cổng kiểm tra Mac trước khi có iPhone

## TIP / phạm vi

Mục tiêu: một lệnh tái kiểm tra các ràng buộc phần mềm có thể kiểm trên Mac,
không nhầm build xanh với nhận diện tốt, đo chính xác hoặc dùng an toàn trên
iPhone. Tận dụng môi trường Python, Swift và Xcode đang có; không cài gói,
tải model, gọi API, đổi signing, mở simulator hoặc cài app vào thiết bị.

Đường mặc định chạy các kiểm thử chính sách QA, hồi quy Assist Scene Python và
Swift core. Có thể chọn thêm TypeScript typecheck và build iOS Release **không
ký**. Mỗi tiến trình có timeout và giới hạn output; lỗi, huỷ, quá hạn, không
khám phá được test hoặc nguồn thay đổi trong khi chạy đều không được coi là
pass. Python/Swift chỉ được pass khi đọc thấy tổng test lớn hơn không và không
có failure. Hash nguồn trước/sau đi cùng receipt để biết kết quả thuộc revision
nào. Trước khi chạy phải còn ít nhất 10 GiB đĩa trống.

## Dùng

Từ repo gốc:

```sh
node scripts/qa-assist-scene-mac.mjs
node scripts/qa-assist-scene-mac.mjs --typecheck --native-build
```

Nếu không có venv hiện hữu tại
`native/ios/.build-xcode/scene-qa/venv/bin/python`, hoặc thiếu Xcode/OpenCV,
runner dừng và ghi lỗi, không tự cài thay thế. Chạy sau khi các Builder đã
ngừng chỉnh nguồn; không chạy cùng một lượt `swift test`/`xcodebuild` khác trên
cùng cache. Dùng lại `native/ios/.build` và `native/ios/.build-xcode`, không tạo
thư mục build mới cho mỗi TIP. Receipt mới ở
`docs/evidence/tip65/mac-readiness/runs/<run-id>/summary.json`, không ghi đè
bằng chứng cũ.

`technicalPass: true` chỉ có nghĩa các bước đã chọn vượt qua. Các trường
`physicalDeviceAcceptance`, độ chính xác đo, tốc độ iPhone, nhiệt 30 phút và
VoiceOver thật luôn là `NOT_TESTED` trong cổng Mac này; `releaseApproved` luôn
`false`. Bằng chứng M3D/M3E lịch sử và M3F nếu có được liên kết kèm hash, không chạy lại hay
chứng nhận lại. Nhánh tiếp cận quang học vẫn là `NOT_READY`, kể cả các unit
test xanh, vì các thử nghiệm đó chưa chứng minh được recall có ích. Nếu có
bản đánh giá mới, cần đánh giá riêng thay vì đổi tên cổng Mac thành nghiệm thu.

## Verify riêng công cụ QA

Ngày 16/11/2026: 8/8 kiểm thử chính sách đạt. Có tiến trình con thật để kiểm
exit lỗi, lệnh không tồn tại, timeout và huỷ. Kiểm trường hợp thiếu venv ghi
receipt thất bại, không tự cài, không đụng thiết bị, không phát hành. Chỉ là
kiểm công cụ QA, không cộng với tổng test tính năng để quảng cáo chất lượng.

```sh
node --test tests/test-qa-assist-scene-mac.mjs
```

Tổng QA sản phẩm và build đầy đủ phải đọc từ receipt thực chạy sau khi hoàn
thiện các thay đổi; tài liệu này không bịa một lượt build hoặc nghiệm thu máy.
Thư mục tạm nhỏ của test được xoá trong `finally`; không sao chép dự án.

## Còn phải kiểm khi có iPhone

- Camera thật: xin/từ chối quyền, đổi hướng, gián đoạn, khoá/mở máy, đưa app
  vào nền và quay lại. Không giữ hộp, số đo hoặc lời đọc cũ sau reset.
- Nhận diện và liên kết đúng vật qua các cảnh thực có nhãn, nhất là vật nhỏ,
  cùng lớp đứng sát nhau, người đi qua và che khuất. Đo báo nhầm lẫn bỏ sót.
- Đo mét bằng nguồn đo thực được hỗ trợ, đối chiếu mốc đã đo. Bề mặt kính,
  tối, mỏng, bóng và ngoài tầm phải giữ chưa xác định; không đoán từ nhãn.
- Đo độ mới và độ trễ đầu-cuối camera → hộp/số đo → tai nghe trên máy thật.
  Tách đo sensor, detector, tracking, giao diện và âm thanh.
- Chạy liên tục 30 phút: nhiệt, bộ nhớ, pin, tốc độ suy giảm, background và
  phục hồi. Kết quả Mac không thay phép thử thermal trên điện thoại.
- VoiceOver, cỡ chữ lớn, thứ tự focus, ngắt lời đọc, tai nghe ngắt kết nối và
  không phát hai giọng cùng lúc. Không nghiệm thu dẫn đường an toàn chỉ từ demo.

Đây là hỗ trợ mô tả/đo thí nghiệm; chưa thay gậy, người hướng dẫn hoặc đôi mắt.
