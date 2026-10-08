# Partner rehearsal — DriveSense TIP-62

## Phạm vi trình bày

Phần mềm chạy local trên browser: nhận diện/bám xe, depth theo frame, số mét
ước lượng khi đủ điều kiện, HUD/rủi ro shadow, làn đường thử nghiệm, dữ liệu phiên
local và khôi phục camera. **Không phải hệ thống bảo đảm an toàn hay phanh/lái**.
Số mét dọc trục camera không đồng nghĩa khoảng hở cản xe hoặc khoảng cách ngang.

Không phải mọi xe đều có số: cắt biên, quá nhỏ, depth lẫn nền, trái thứ tự gần–xa,
không còn cùng ID hoặc quá 1200 ms đều phải “chưa đo”. Không dùng smoothing giữ
mét quá hạn cho đẹp demo. Detection, model warm-up, số mét và accuracy là bốn gate
khác nhau. Không đổi threshold trước mặt đối tác để tạo số đo.

## Chuẩn bị 5 phút

1. Dùng link HTTPS với build trong `VERIFY-REPORT-TIP-62.md`. Laptop mở video
   local cũ; phone mở Camera sau trên trang đó, không mở localhost của laptop.
2. Lần đầu tải model lớn: giữ trang foreground, máy tĩnh, mạng ổn định. Chờ
   Phân tích ghi backend detector/depth và không còn lỗi. Không có API inference
   cloud, không cần laptop làm server; model vẫn cần host/mạng khi chưa cache.
3. Bật **Khoảng cách**; Làn là thử nghiệm riêng, không suy diễn làn tự tin khi icon
   unknown. Camera 1×, không pinch zoom/crop. Không nhập profile camera bịa.
4. Xác nhận có box bám; nếu có mét, kiểm tra nghĩa ≈m chưa kiểm chứng; nếu không,
   xem lý do và xuất báo cáo thay vì gọi số chưa có là lỗi người dùng.
5. Trong Phân tích, xác nhận checkpoint tự lưu. Xuất JSON hiện tại và phiên đã
   lưu trước khi rời buổi; JSON không lưu pixel hay GPS. Browser có thể eviction.

## Ma trận test bắt buộc (không thay bằng browser giả lập)

| Kênh | Thao tác | PASS yêu cầu |
|---|---|---|
| Laptop / video ghi sẵn | Test1 Cân bằng; Test2 Nhanh; tua, phát, tắt/bật Khoảng cách | Hoàn thành timeline, box, không lỗi JS/depth, báo cáo đúng build, unknown có lý do |
| Laptop / camera OS thực | Cho quyền, frame tiến, Stop/mở lại; đổi tab rồi trở lại | Frame mới, không số cũ; tự tiếp tục hoặc nút retry rõ; Stop tắt nguồn |
| iPhone 16 Pro Max / Chrome | Camera sau, dọc→ngang; chuyển tab 5–10s; trở lại; Stop/mở lại; JSON | Frame mới, backend đúng shape, không stuck; checkpoint tồn tại; xem coverage/lý do từng xe |
| Xiaomi 14T / Chrome | Giống trên; chạy Brave thành dòng riêng | Không coi Chrome PASS đồng nghĩa Brave PASS; lưu lỗi quyền/GPU/WASM cụ thể |

Kiểm tra phone tại chỗ, người khác quan sát màn hình; không yêu cầu lái cao tốc
để kiểm tra permission/lifecycle. Nếu cần kiểm chứng độ chính xác, dùng clip hoặc
bãi kiểm soát có khoảng cách đo độc lập. Người lái không thao tác ứng dụng.

## GO / NO-GO

**GO demo video** sau software QA và real-model clip gate. Nói rõ phân tích trước
vs **Test realtime** (clip wall-clock). Không giới thiệu offline là camera realtime.

**GO live phone** chỉ sau rehearsal thiết bị đó có bản JSON mới, frame tiến,
không crash, số đo có coverage/tính liên tục đủ cho kịch bản đã thống nhất.
Desktop model tests không thay thế gate này. Nếu chỉ box và “chưa đo”, cho phép
giới thiệu detection + observability, **NO-GO tuyên bố đo realtime đạt**.

**NO-GO dùng để quyết định lái xe/thương mại an toàn**: thiếu independent metric
truth, coverage lead ≥95%, P95 age ≤300 ms, ≥3 metric anchors/s, blackout ≤1s và
soak nhiệt 30 phút trên thiết bị mục tiêu. Đây là mục tiêu chưa nghiệm thu, không
phải các số đã đạt. Không mua thêm phần cứng trong đợt này.

## Khôi phục / rollback

Camera bị ngắt: trở lại tab → nếu có “Tiếp tục camera” bấm một lần; nếu OS ended,
bấm Camera mở phiên mới. BFCache quay lại chỉ khởi động UI, không tự xin camera.
Wake lock best-effort, bị từ chối không dừng detection. Lỗi AI có retry riêng.

Không mất dấu sự cố: checkpoint local 2s, 10 phiên / 7 ngày / 10 MiB; xuất trước
khi xóa cache/browser. Báo cáo ghi lifecycle và source SHA, không chỉ Git HEAD.
Nếu release gặp regression, chủ dự án có thể khôi phục deployment trước ghi
trong receipt; không xóa session/evidence và không reset Git dirty tree.
