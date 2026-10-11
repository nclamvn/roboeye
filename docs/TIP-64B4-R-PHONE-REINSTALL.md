# TIP-64B4-R — Cài lại bản iPhone đã QA

2026-10-11 · Yêu cầu trực tiếp: “cài lại trên iphone”. Contractor ops theo vibecode; không sửa ứng dụng nên không cần Builder/code/thiết kế mới. Rút gọn checkpoint vì đây là cập nhật lại cùng artifact, không thay tính năng.

## Acceptance

- R01: Nguồn khớp gate B4 đã PASS; bundle Release đúng0.2.2/build5, chữ ký Team/bundle hiện có và model/license kiểm chứng được.
- R02: Cài cập nhật trên iPhone kết nối bằng cùng bundle ID; không uninstall, không xóa dữ liệu/chứng chỉ, không tự bật camera/ghi.
- R03: Đọc lại phiên bản/build trên thiết bị sau cài. Thử mở mặc định, báo đúng kết quả; nếu khóa thì không bypass và yêu cầu người dùng mở khóa.

## Boundary / verify

Không build mới khi nguồn và artifact còn nguyên; không chạy lại/ghi đè lịch sử B1–B4. Không tải model, thêm dependency, commit/push/deploy. Ghi completion/receipt riêng; camera live, semantic recall, sai số mét và nhiệt không được suy ra từ reinstall. Reuse checkout/cache, không tạo scratch copy. Giữ các thay đổi sẵn có.
