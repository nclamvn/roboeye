# TIP-40 — DriveSense: nghiên cứu khả thi và blueprint đề xuất

Ngày: 2026-09-13. Vai: Chủ thầu → Thợ khảo sát → Chủ thầu tổng hợp.
Ưu tiên P0. Phụ thuộc: nền detection/worker hiện có; không phụ thuộc RoboHand.
Working directory: `/Users/os/Documents/Codex/2026-08-05/new-chat/roboeye-live`.

## Khế ước lượt này

Người dùng yêu cầu mổ xẻ một phase mới: camera hành trình/điện thoại phát hiện xe,
bounding box, nhãn khoảng cách và màu cảnh báo. Lượt này giao nghiên cứu, scan,
đề xuất kiến trúc và tiêu chuẩn đánh giá; KHÔNG tự coi kiến trúc đã được duyệt,
không sửa runtime hoặc đưa cảnh báo ra đường thực tế.

| REQ | Đầu ra | Acceptance criterion |
|---|---|---|
| R1 | Scan phần có thể tái sử dụng và phần không phù hợp | Mỗi nhận định quan trọng có file nguồn |
| R2 | Đối chiếu giải pháp hiện hành, ưu tiên miễn phí | Có snapshot, evidence, giấy phép theo thành phần; hiệu năng chưa đo để trống |
| R3 | Làm rõ giới hạn đo và cảnh báo | Phân biệt Z, range, khoảng hở; xử lý mất dữ liệu/ngoài phạm vi |
| R4 | Blueprint + task graph + phép nghiệm thu | Có dependency, ground truth, chỉ số sai số/độ trễ/báo sai |

Constraints: không thay đổi RoboHand/AirSketch; không dùng cloud nhận video mặc định;
không tải weights hoặc dataset lớn; không mua thiết bị; không tích hợp điều khiển xe.

Process: rút gọn phỏng vấn thành giả định và câu hỏi chiến lược trong blueprint vì
đây là khảo sát tiền triển khai. Giữ gate phê duyệt kiến trúc trước BUILD tính năng
do thay đổi miền sử dụng và rủi ro an toàn. Không yêu cầu người dùng trả lời giữa
quá trình nghiên cứu. Completion Report riêng là audit trail.
