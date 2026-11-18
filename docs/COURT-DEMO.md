# RoboEye Court · Bản demo xem lại pha bóng

[Mở demo RoboEye Court](https://roboeye-court-lab-nclam.canhlam-ng.chatgpt.site/)

Chọn mốc **9,28 s** dưới video gốc để xem hộp bóng ở khung còn quan sát được,
ảnh gốc, vùng phóng và các khung lân cận. **Xem clip pha** phát đoạn 8,12–10,60 s;
**Tải clip** lưu MP4 có âm thanh từ cùng video. Mốc **4,04 s** là một gợi ý
đổi hướng, không phải điểm chạm đã xác nhận.

Đây là demo trên video ghi sẵn, không xử lý trực tiếp luồng camera và không
phân xử Trong/Ngoài. Ở mốc 9,28 s, bóng mất dấu gần mép hình; dữ liệu không
cho biết điểm chạm sân. Ứng dụng giữ ảnh và clip để đối chiếu, không vẽ hộp
qua đoạn mất dấu. Pha khoảng 2,48 s vẫn chưa được tự động đề xuất.

## Code và xác minh

- `tools/court/`: giao diện, quy tắc gợi ý pha và chụp khung. Không cần API
  nhận diện khi mở demo. Kết quả bám bóng đã được tính trước.
- `scripts/court-export-events.mjs`: xuất ảnh và clip từ video cùng hai phiên
  phân tích đã khớp SHA. Dùng `--video`, `--classical`, `--specialist` và
  `--output` trỏ vào một thư mục riêng trong `.court-cache/m8/`. Có thể chọn
  `--python` với OpenCV và `imageio-ffmpeg` đã cài. Đầu ra là bằng chứng xem
  lại, không phải nhãn chạm sân.
- `scripts/export-court-public.mjs`: tạo bản static trên danh sách cho phép.
  Không đóng gói cây mã nguồn, cache, trọng số, video cá nhân khác hay công cụ
  phân tích thử nghiệm. Video gốc chỉ có mặt khi chọn chế độ xuất được phép.
- `tests/court-m8-ui-e2e.mjs`: kiểm gợi ý hai mốc trên đúng nguồn, hộp chỉ bám
  khung quan sát, tua có giới hạn, tải MP4 đã kiểm SHA và bố cục 375 px.

Phân tích một video khác trên máy:

```sh
node scripts/serve-court.mjs --video /path/to/video.mp4 --port 4198 --detector classical
```

Mở `http://127.0.0.1:4198/court.html`. Server chỉ nghe loopback, video không
upload. Luồng gợi ý và tải clip đầy đủ đã được kiểm trên bundle demo đã đóng
gói, chưa nghiệm thu cho video bất kỳ hoặc camera trực tiếp.

## Quyết định phát hành

TIP: chỉ cập nhật demo xem bằng chứng tại Site hiện có; giữ nguyên quyền truy
cập public và nguồn gốc video đã được phép. Nhánh Court không mang theo sửa
đổi đang làm của DriveSense/Assist hay dữ liệu kiểm thử cục bộ. Gate phát hành:
gói tái tạo có kiểm kê SHA, browser thật mở/tải đúng clip, không hiện phán quyết
Trong/Ngoài khi chưa đủ bằng chứng, HTTPS công khai kiểm lại sau cập nhật.

Bản phát hành được xuất từ đầu vào đã pin SHA (video gốc đã được cho phép,
hai phiên phân tích, bộ TenniST có ghi công và 12 tệp bằng chứng đã kiểm).
Nếu thiếu đầu vào local, lệnh từ chối xuất; GitHub không chứa các video,
ảnh bằng chứng, cache model hoặc weights.

```sh
node scripts/export-court-public.mjs --output .court-cache/m9/customer-release --include-user-original --include-event-evidence
```

Gói kiểm thử có 40 tệp, gồm manifest kiểm kê. Không có endpoint nhận diện,
không cần đăng nhập hay quyền camera. Kết quả chỉ xác minh luồng xem lại và
độ khớp tệp trên nguồn đã biết, không đo khả năng phân xử trận đấu mới.

Verify trước phát hành: 83 kiểm thử Node đạt; kiểm thử trình duyệt đạt 7 nhóm
trên đúng gói static, gồm tải đúng MP4, bố cục 375 px, hồ sơ ẩn danh và từ chối
clip khi manifest bị sửa. Khoảng mất dấu không được nội suy. Sẵn sàng gửi khách
dưới dạng demo xem lại, chưa sẵn sàng dùng như trọng tài hay camera live.
