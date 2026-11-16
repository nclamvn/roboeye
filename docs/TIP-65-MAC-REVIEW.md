# TIP-65: xem lại A/B trên Mac

## TIP

Công cụ chỉ đọc clip và receipt thực đã có, không chạy lại model, không mở
camera và không gửi hình lên mạng. Mục tiêu là xem cùng một khung RGB với hộp
A (M3E gốc) và B (M3E thêm nhận diện ROI) để nhận ra sai khác, không mặc định
B tốt hơn. Màu hộp phân biệt lớp; lời tiến gần chỉ hiện khi receipt có sự kiện
đúng thời gian, đúng ID và epoch. Không hiển thị mét hay TTC.

UI dùng hai khung ảnh lớn, điều khiển gắn dưới ảnh, chẩn đoán gập mặc định.
Không tự phát; nút phát giới hạn tối đa 5 khung/giây và chờ giải mã xong trước
khung tiếp. Đây là xem chậm có kiểm soát, không phải bằng chứng realtime.
Khi đổi khung nhanh, request cũ bị huỷ và không được ghi đè kết quả mới.

## Chạy

Từ checkout RoboEye:

```sh
qa="$PWD/native/ios/.build-xcode/scene-qa"
PYTHONDONTWRITEBYTECODE=1 "$qa/venv/bin/python" scripts/serve-assist-scene-review.py \
  --input "$qa/boreas-m3f/input.json" \
  --receipt "$qa/boreas-m3f-receipt.json" --port 4198
```

Mở http://127.0.0.1:4198/ trên chính Mac. Dừng bằng Ctrl+C. Server không lắng
nghe qua Wi-Fi, không phải link dành cho iPhone. Khi cần xem bộ đối chứng,
thay input/receipt bằng cặp đã được hash ràng buộc tương ứng.

## Verify và giới hạn

- Đối chiếu hash input, nguồn ảnh, thứ tự clip, token/thời gian chính xác và
  hình học trước khi phục vụ. Source bị đổi khi chưa có trong cache sẽ bị từ
  chối, không đọc ảnh tuỳ ý từ URL. Cache RAM tối đa hai JPEG thu nhỏ 960 px.
- Chỉ bind loopback, từ chối Host/Origin ngoài danh sách, không list thư mục,
  không endpoint ghi, không đưa đường dẫn file gốc ra API. Server xử lý tuần tự,
  không tạo thread cho từng request; hàng chờ TCP tối đa hai request. Request
  đổi khung cũ bị huỷ, có dấu đang tải và không lấy thời gian mới gắn ảnh cũ.
- Unit/HTTP test là bằng chứng chức năng và ranh giới của viewer, không phải
  đánh giá recall, độ chính xác số đo, iPhone hay trải nghiệm người khiếm thị.
- Chỉ các hộp có trong receipt được vẽ, không có ground truth trong UI. Nhãn
  chuẩn và báo nhầm/bỏ sót phải đọc từ báo cáo chấm riêng.

Tổng test và ảnh chụp UI thực phải ghi từ lần chạy của phiên, không thay bằng
khẳng định trong tài liệu này.

### Lượt kiểm thực ngày 16/11/2026

5/5 unit/HTTP test đạt, gồm PNG và từ chối đường dẫn/receipt/số đo không hợp lệ.
Main chạy viewer trên 100 ảnh PNG Boreas và receipt M3F thật, thử bằng
Chrome/Playwright: render hai khung, tua/step, đổi clip, phát/dừng, mở chẩn đoán,
cửa sổ 1440 × 1000 và 390 × 844 không tràn ngang; không quan sát lỗi JS hay
request ngoài loopback. Đã xem cả hai ảnh chụp, không dùng ảnh mock.
[Receipt UI](evidence/tip65/m3f-review-browser-check.json).

Đây là công cụ điều tra. Hộp detector nhận nhầm nắp ca-pô vẫn được giữ trong
receipt và hình vẽ, không che để làm đẹp demo; viewer không chứng nhận các
nhãn là đúng, không mở camera trực tiếp và không phải UI dẫn đường.
