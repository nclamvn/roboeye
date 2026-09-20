# Browser metric-depth research — 2026-09-13

Đầu ra chính: [Báo cáo kiến trúc](/Users/os/Documents/Codex/2026-08-05/new-chat/roboeye-live/docs/research/browser-metric-depth/BAO-CAO-KIEN-TRUC.md).

## Phạm vi và tính trung thực

Nghiên cứu theo Deep Research + Refinery, trước khi viết thêm code DriveSense. Ràng buộc đã xác nhận: xử lý trong trình duyệt trên điện thoại và laptop, không thay bằng backend/native/replay. Không sửa source sản phẩm, không build/deploy, không tải model weights, không tải lên hay sao chép video riêng tư.

Registry có **38 claims, 15 thực thể/phương pháp/nền tảng**, chọn có chủ đích; **26 raw snapshots** có URL/ngày thu trong `captures.json` và SHA-256 trong `snapshots.sha256`. Đây không phải số lượng công trình của cả lĩnh vực. Registry trích các điều kiện quan trọng để chọn phương án, không thay thế toàn bộ báo cáo.

- Tier A biểu thị nguồn chính chủ cho điều nguồn đó công bố; không biến benchmark của tác giả thành thử nghiệm độc lập.
- Các nguồn thuộc cùng nhóm tác giả dùng cùng nhãn `capture.source`, kể cả README và model card nằm ở hai tên miền khác nhau.
- `measured_browser_latency` và `measured_vehicle_range_error` đều honest-null. Không có số đo mới cho các ứng viên trên RoboEye. Gate `no_inferred_fields` cấm suy diễn hai trường này.
- Bảng ONNX Runtime và thông báo WebKit nói ở hai tầng khác nhau. Cả hai raw sources được giữ; báo cáo không tự tuyên bố model chạy được/không được trên Safari chỉ từ một trang.
- Các công thức minh họa, kiến trúc kết hợp và cổng nghiệm thu trong báo cáo là đề xuất/phân tích, không gán tier A như kết quả thực nghiệm đã đạt.
- Kết quả TIP43 chỉ được dẫn là baseline từ báo cáo nội bộ trước đó, không trộn vào benchmark ứng viên mới.

## Kiểm tra đã chạy

`registry-audit.txt`: build tất định và auditor PASS. `bites-audit.txt`: positive control PASS; **6 cổng áp dụng được tiêm lỗi và chặn đúng**, 8 cổng chuyên biệt N/A. PASS ở đây kiểm tra provenance và kỷ luật registry, **không kiểm định khoa học, quyền thương mại hoặc độ chính xác lái xe**.

Lần build đầu chặn một evidence span được diễn đạt lại ở claim Depth Pro; đã thay bằng nguyên văn thực trong snapshot. Bộ bites ban đầu lỗi vì tìm `*.html` trong khi mọi snapshot mang đuôi `.txt`; đổi tên bản HTML WebKit thành `.html`, giữ nguyên byte nguồn và cập nhật tham chiếu. Không sửa engine để làm bài kiểm tra qua.

Domain được tạo trong repository theo scaffold của Refinery, thay vì chạy scaffold mặc định vào thư mục plugin. Engine chuẩn vẫn nguyên vẹn. Raw snapshots có thể là Markdown, model card, source code hoặc HTML; đuôi `.txt` không hàm ý đã chuyển đổi/làm sạch nội dung.

Một lần thử tải macro `docs/en/macros/yolo-depth-perf.md` trả HTTP 404; không tạo claim thông số từ macro thiếu này. URL bài comma ngắn không mở được; đã dùng URL bài chính chủ đầy đủ trong captures và báo cáo. PDF WACV trả 403 qua lệnh open; abstract và bibliographic record được đối chiếu qua trang CVF được lập chỉ mục. Không giả có raw PDF trong bộ 26 snapshots.

## Chạy lại

Từ repository `roboeye-live`, với Python 3 và PyYAML đã có:

```sh
python3 /Users/os/.codex/plugins/cache/claude-cowork/anthropic-skills/1.0.0/skills/refinery/refinery.py docs/research/browser-metric-depth
python3 /Users/os/.codex/plugins/cache/claude-cowork/anthropic-skills/1.0.0/skills/refinery/bites.py docs/research/browser-metric-depth
shasum -a 256 -c docs/research/browser-metric-depth/snapshots.sha256
```

`snapshots.sha256` dùng đường dẫn tương đối từ repo root. Bản raw được đóng băng tại ngày thu; URL `main` có thể đổi, vì vậy cần hash khi đối chiếu về sau. Không tuyên bố model revision đã pin vì đợt này chưa tải weights.

## Bàn giao nghiên cứu

Mở spike A/B MoGe-2 ViT-S Normal và DA2 Metric VKITTI Small theo R0–R2 trong báo cáo. Chưa chốt model thắng, chưa xác nhận realtime mobile, chưa có kết quả mét trên camera người dùng. Không có commit/push/deploy trong đợt này.
