# DriveSense — hướng dẫn baseline D1/D2

## Chạy và thử

Chạy `npm run dev -- --host 127.0.0.1 --port 4190 --strictPort`, mở
`http://127.0.0.1:4190/drive.html`. Với bản build: `npm run build`, rồi
`npm run preview -- --host 127.0.0.1 --port 4191 --strictPort` và `/drive.html`.

1. **Xem mẫu toán học** kiểm tra giao diện và phép chiếu. Hai hình chữ nhật trong
   mẫu là dữ liệu dựng, tuyệt đối không dùng để đánh giá model nhận diện.
2. **Mở video trên máy**, bật **Nhận diện xe**, rồi **Phát / tạm dừng**.
   Video không tải lên máy chủ. Model tải từ Hugging Face lần đầu, cần mạng.
   Thử WASM nếu GPU không tương thích. Camera sau chỉ mở khi bấm và cấp quyền.
3. Chưa có profile: chỉ khoanh xe, không gán mét. Nhập calibration đúng lens,
   độ phân giải, crop và gá camera. Xác nhận rồi áp dụng. Tua/đổi nguồn sẽ xóa
   tracking, dữ liệu đối chứng và số liệu phiên; đổi nguồn còn xóa calibration.
4. Xuất báo cáo JSON trước khi đổi nguồn/tua. Nhập đối chứng đúng timestamp và
   ID của phiên hiện tại để tính MAE, bias, P95, coverage. Nếu không có đối chứng,
   các chỉ số chính xác là null, không phải 0% lỗi.

## Phép đo có ý nghĩa gì?

Đầu vào: RT-DETRv2 R18, chỉ ô tô/xe tải/xe buýt. Giữ ID bằng ghép Hungarian
hai ngưỡng điểm, lấy cảm hứng từ ByteTrack, không phải toàn bộ upstream ByteTrack.

Lấy giữa cạnh dưới bbox làm **xấp xỉ điểm tiếp xúc mặt đường**, khử méo
Brown–Conrady, tạo tia từ intrinsics, quay theo pitch/roll, giao tia với mặt phẳng
đất. Với camera ngang, không méo: `Z = heightM * fy / (v - cy)`.
`Z` là khoảng cách dọc hướng nhìn trên mặt đất từ camera, không phải khoảng
hở cản xe, khoảng cách Euclid hay khoảng cách lidar.

Kalman giảm rung theo thời gian; innovation gate từ chối ngoại lai. Mép ảnh bị
cắt, box quá nhỏ, gần chân trời, calibration không khớp, phép đo mất/quá cũ hoặc
độ nhạy quá lớn sẽ cho **chưa đủ dữ liệu**. Dải sai số là sensitivity heuristic,
chưa được hiệu chuẩn thành khoảng tin cậy thống kê.

Hạn chế quan trọng: chưa biết chân xe thật, chưa bù pitch động khi phanh/xóc,
chưa mô hình đường dốc/cong, chưa lane association, chưa TTC/FCW. Không tự phát
hiện được mọi trường hợp giả định đường phẳng sai. Màu <20/<10 m chỉ minh họa
độ gần, không có nghĩa xanh là an toàn hoặc đỏ cần phanh.

## Schema calibration

Các số dưới đây **chỉ cho mẫu synthetic 1280×720**, không nhập cho camera thật.

```json
{
  "version": 1, "name": "SYNTHETIC ONLY",
  "width": 1280, "height": 720,
  "fx": 900, "fy": 900, "cx": 640, "cy": 360,
  "distortion": [0, 0, 0, 0, 0],
  "heightM": 1.4, "pitchDeg": 0, "rollDeg": 0,
  "pixelSigma": 3, "heightSigmaM": 0.02,
  "pitchSigmaDeg": 0.1, "focalSigmaFraction": 0.01,
  "minM": 5, "maxM": 50
}
```

fx/fy/cx/cy theo pixel ảnh gốc, không theo canvas hiển thị. Pitch dương chúc
xuống. Hệ số méo theo OpenCV `[k1,k2,p1,p2,k3]`, không hỗ trợ model fisheye.
Camera thật cần calibration nội tại độc lập; nhập zero không làm lens hết méo.
Giữ nguyên EIS/crop/lens/focus theo cấu hình đã đo.

Tinh chỉnh gá: array `{ "u": pixelX, "v": pixelY, "zM": groundForwardM,
"split": "fit" }` và các hàng `split: "check"`. Tối thiểu 6 fit trải ≥8 m,
2 check độc lập. Huber + Gauss–Newton chỉ chỉnh height/pitch, không fx/fy/lens.
Holdout lỗi >max(2m,20%) bị từ chối; đạt ngưỡng này không chứng nhận sản phẩm.

Đối chứng: array `{ "timeMs": 1000, "trackId": 1, "distanceM": 20 }`.
Đo độc lập ngoài phần mềm, cùng định nghĩa Z, khớp ID đúng xe. Ghép thời gian
trong 80 ms, mỗi quan sát chỉ dùng một lần; unknown làm giảm coverage. Report
giữ 20.000 quan sát và 5.000 thời gian xử lý mới nhất. Latency từ đọc video frame
đến nhận kết quả, **không** phải sensor-to-display và không gồm trễ video có sẵn.

## Điều kiện trước giai đoạn tiếp

Thu video và ground truth tại bãi có kiểm soát, nhiều cự ly/loại xe/ánh sáng;
tách fit/validation/test theo chuyến và camera. D3 sẽ so sánh model depth metric,
detector và fusion trên cùng dữ liệu, giấy phép checkpoint và thiết bị mục tiêu.
Chỉ sau gate chất lượng, coverage, tracking và latency mới triển khai D4 cảnh
báo theo chuyển động. Không sử dụng baseline này để quyết định phanh/lái.

Nguồn nền tảng: [OpenCV calibration](https://docs.opencv.org/4.13.0/d9/d0c/group__calib3d.html),
[RT-DETR](https://github.com/lyuwenyu/RT-DETR),
[ByteTrack](https://github.com/FoundationVision/ByteTrack).
