# Nghiệm thu máy thật · RoboEye v2 (P1-A + P1-B + P1-B-2)

Chủ thầu soạn cho anh Lâm chạy trên webcam thật, khoảng 30-45 phút. Mỗi bước có kỳ vọng và ô ghi. Đánh dấu PASS hoặc FAIL, ghi số và quan sát. Cái gì lệch thì ghi lại, em sửa.

Máy cần: Chrome hoặc Edge bản mới, cắm sạc, tắt Low Power Mode. Đặt chỗ ngồi có chiều sâu phía sau (bàn ghế, lối đi) và vài vật dễ nhận (cốc, laptop, ghế).

## 0. Khởi động

```bash
cd ~/Downloads/roboeye
npm run dev
```

Mở localhost:5173, cho phép camera.

- [ ] Hai badge góc trái đều **WEBGPU** (INFER và RENDER). Ghi nếu khác: ____________

## 1. P1-A · Detection và fusion 3D (engine RT-DETR)

Tick "Nhận diện vật thể" trong sidebar. Lần đầu tải RT-DETR khoảng 40MB.

- [ ] Box 2D vẽ quanh vật thật (người, cốc, laptop, ghế) kèm nhãn và điểm tin cậy, bám theo khi anh di chuyển.
- [ ] Đồng hồ "số vật" góc dưới trái đổi theo cảnh.
- [ ] Nhấn phím **3** sang Point Cloud: mỗi vật có một wireframe 3D box bám đúng vị trí trong khối điểm. Kéo chuột orbit thấy box nằm đúng chỗ vật trong không gian.

Ghi fps inference khi bật detection (đọc sidebar): ________ fps. Quan sát: ____________

## 2. P1-B · Open-vocab, review, export

**Open-vocab OWL-ViT.** Đổi Engine sang "OWL-ViT · gõ chữ ra lớp". Lần đầu tải khoảng 127MB, chạy WebGPU nên chờ một chút.

- [ ] Gõ vào ô "Lớp cần tìm" một lớp KHÔNG có trong COCO, ví dụ "bàn phím, chuột máy tính, chai nước, kính mắt". Sau vài giây box hiện quanh đúng vật anh gõ.
- [ ] Thử một lớp lạ hơn thuộc domain của anh (ví dụ "mũ bảo hộ" nếu có). Ghi kết quả nhận được hay không: ____________
- [ ] Thời gian mỗi lần suy luận OWL-ViT (cảm nhận): ________ giây. Đây là số quan trọng để biết OWL-ViT có dùng realtime được không hay chỉ để gán tĩnh.

**Review và sửa.** Nhấn **F** để chụp khung. Panel phải liệt kê vật.

- [ ] Click một dòng: box đó sáng lên (đậm hơn) cả trên ảnh 2D lẫn 3D.
- [ ] Double-click tên một vật, sửa thành tên khác, Enter: nhãn đổi.
- [ ] Bấm × một dòng: vật biến mất khỏi danh sách và overlay.

**Export.** Vẫn ở khung đông cứng.

- [ ] Bấm **COCO**: tải file `roboeye-coco.json`. Mở ra thấy `images`, `categories`, `annotations` có bbox pixel.
- [ ] Bấm **YOLO**: tải `roboeye-labels.txt` (mỗi dòng class cx cy w h) và `classes.txt`.
- [ ] Bấm **3D JSON**: tải `roboeye-3d.json`, thấy cờ `scale`.

## 3. P1-B-2 · Metric mét thật và KITTI

Tick "Metric mode · Depth Pro". **Lần đầu tải Depth Pro khoảng 600MB, sẽ lâu**, xem dòng status báo tiến trình. Chỉ tải một lần rồi cache.

- [ ] Đặt một vật ở khoảng cách anh ĐO ĐƯỢC bằng thước, ví dụ đúng 1.0 mét trước camera. Nhấn **F**.
- [ ] Dòng status metric hiện "metric ✓ N vật · gần nhất X.XX m". So X với thước.
  - Khoảng cách thật (thước): ________ m. RoboEye đọc: ________ m. Lệch: ________
- [ ] Lặp lại ở khoảng 2.0 mét. Thật: ________ m. Đọc: ________ m.
- [ ] Nút **KITTI (metric)** hiện ra. Bấm: tải `roboeye-kitti.txt`. Mở ra, mỗi dòng 15 trường, cột dimensions và location là mét.
- [ ] Bấm **3D JSON** lúc metric bật: file giờ là `roboeye-3d-metric.json` với `scale: "metric"` và `dims_m` đơn vị mét.

Nhận xét độ chính xác metric: ____________ (Depth Pro tự ước lượng, sai vài chục cm ở gần là chấp nhận được cho gán nhãn; nếu lệch nhiều lần thì báo em, có thể do focal).

## 4. Đóng bảng fps registry (fact mở rộng)

Ở chế độ depth thường (tắt detection cho nhẹ), chỉnh slider Inference size rồi đọc fps:

| Inference size | fps inference | fps render (Point Cloud) |
|---|---|---|
| 252 | ________ | ________ |
| 504 | ________ | ________ |

Điền vào đây rồi gửi em, em cập nhật `docs/REGISTRY-NOTES.md`.

## 5. Kết luận nghiệm thu

- [ ] READY: cả ba cụm chạy đúng trên webcam thật, em phát TIP tiếp (P1-C video + tracking).
- [ ] READY-với-sửa: chạy được nhưng có mục lệch (liệt kê), em sửa trước khi đi tiếp: ____________
- [ ] NOT READY: có mục hỏng chặn (liệt kê): ____________

Chụp lại vài màn hình đẹp (detection open-vocab, metric readout) thì càng tốt để làm bằng chứng và slide.
