# TIP-64B4 — Quyết định model cho khoảng trống điện thoại / quạt

Ngày đối soát: 2026-10-11. Đây là nghiên cứu lựa chọn, **không phải kết quả benchmark hoặc model đã được tích hợp**. B4 chỉ thay trình bày và sửa khung trùng phone/remote đã được duyệt. Không tải thêm weights, cài dependency, upload ảnh hoặc gọi API trả phí.

## Kết luận hiện tại

Model đang đóng gói là Apple YOLOv3 FP16, input 416×416, 80 lớp. Metadata của artifact thực xác nhận có `cell phone` và `remote`, **không có `fan`**. Vì vậy thiếu quạt là thiếu khả năng của sản phẩm, không thể sửa bằng palette hay hạ confidence. Sai nhãn điện thoại là vấn đề khác: chưa có ảnh/clip đối chứng và phân phối nhãn cạnh tranh để xác định nguyên nhân. [Scan code và artifact](RECOGNITION-SCAN-TIP-64B4.md).

Một detector mới chỉ được huấn luyện trên COCO80 cũng không tự thêm quạt. Ví dụ danh sách nhãn công khai của RF-DETR vẫn là COCO80; cần model có vocabulary rộng hơn hoặc huấn luyện thêm lớp. [RF-DETR class list](https://github.com/roboflow/rf-detr/blob/develop/src/rfdetr/assets/coco_classes.py).

## Hai hướng đáng thử, một hướng không được mặc nhiên đưa vào sản phẩm

| Hướng | Giá trị thực tế | Điều kiện / giới hạn |
|---|---|---|
| **YOLOE với vocabulary cố định lúc export** | Có thể đánh giá các prompt điện thoại, điều khiển, quạt cùng vật trong nhà; instance mask là hướng kiểm soát depth trộn nền. | Docs hỗ trợ Core ML; prompt được đóng vào model lúc export, không phải đổi nhãn runtime miễn phí. Cần adapter tensor/mask/NMS, mapping tọa độ và parity thật. Repo gốc AGPL-3.0; phương án sản phẩm proprietary phải kiểm tra nghĩa vụ / quyền thương mại trước. Chưa có bằng chứng recall hoặc tốc độ trên iPhone của dự án. |
| **Detector nhỏ + fine-tune trên dữ liệu có quyền sử dụng** | Vocabulary và tiêu chí phone↔remote/fan thuộc quyền kiểm soát của sản phẩm; hợp lý cho nhóm vật xác định. | YOLOX code Apache-2.0; RF-DETR có những model Apache-2.0, nhưng các biến thể Plus có giấy phép khác. Phải kiểm tra chính xác code, weights và dữ liệu, không gọi toàn bộ họ model là “free thương mại”. Cần tập development/holdout độc lập, export Core ML và chứng minh hiệu năng native. |
| **MobileCLIP làm crop classifier** | Chỉ là phương án nghiên cứu disambiguation khi đã có crop. Không phải detector tạo bbox của quạt. | Code MIT không đồng nghĩa weights dùng thương mại. `LICENSE_MODELS` đang giới hạn research phi thương mại, loại trừ product development/commercial exploitation. Không đưa weights này vào sản phẩm đang phát triển nếu chưa có quyền phù hợp. |

Nguồn đối chiếu: [YOLOE official docs](https://docs.ultralytics.com/models/yoloe), [repo tác giả YOLOE](https://github.com/THU-MIG/yoloe), [Core ML export](https://docs.ultralytics.com/integrations/coreml), [Ultralytics license](https://www.ultralytics.com/license); [RF-DETR repo và giấy phép từng model](https://github.com/roboflow/rf-detr), [YOLOX repo](https://github.com/Megvii-BaseDetection/YOLOX), [YOLOX license](https://github.com/Megvii-BaseDetection/YOLOX/blob/main/LICENSE); [MobileCLIP repo](https://github.com/apple-aiml-research/ml-mobileclip), [code license](https://github.com/apple-aiml-research/ml-mobileclip/blob/main/LICENSE), [weights license](https://raw.githubusercontent.com/apple-aiml-research/ml-mobileclip/main/LICENSE_MODELS).

Đây là gate quyền sử dụng kỹ thuật, không thay tư vấn pháp lý. Không suy latency/AP của vendor trên GPU khác thành FPS/recall trên iPhone. Mọi lựa chọn model mới vẫn cần duyệt trước tích hợp.

## Bước triển khai đề nghị: benchmark nhỏ trước thay model

1. **Sửa dụng cụ đánh giá trước.** QA ảnh Mac hiện bỏ EXIF orientation; cần tôn trọng EXIF và ghi raw dimensions/rotation. Live runtime đã xử lý orientation riêng, không kết luận cả camera bị lỗi từ defect của test ảnh. Ghi top-k, confidence observation và classification cùng product; giữ hash, threshold và transform. Chưa thay trong B4.
2. **Dữ liệu sát lỗi, không “demo ảnh dễ”.** Điện thoại thật mặt trước/sau, màn hình bật/tắt, ốp, trong tay, dọc/ngang, mép/tâm; điều khiển thật và các vật hình chữ nhật âm tính; quạt cây/quạt bàn. Có đủ sáng, thiếu sáng, che khuất và chuyển động. Giữ toàn bộ một vật/clip ở một split; không lấy frame liền kề của cùng clip sang holdout. Chỉ dùng dữ liệu có đồng ý/quyền sử dụng, ưu tiên lưu local.
3. **Baseline và thay một biến.** So sánh shipping `scaleFill` với fit/letterbox đúng mapping, cùng weights/threshold. Hình bị kéo dãn là giả thuyết, chưa được chứng minh là nguyên nhân. Kiểm roundtrip bbox ở bốn góc/xoay trước khi lấy depth; không đổi estimator để ép số xuất hiện.
4. **Chấm cả phần sai.** Report precision/recall tại bbox matched, phone→remote và remote→phone, quạt out-of-vocabulary của baseline, false positives, đổi ID/khung trùng và tỷ lệ từ chối. Kết quả trên UI fixture không được tính vào detector recall.
5. **Chọn tối đa một candidate để port native.** Quyền thương mại → schema/decoder/vocabulary → transform/mask registration → kiểm thử background/TTL → đo trên chính iPhone. Chưa mở một lúc nhiều họ model hoặc đưa VLM vào mỗi camera frame.
6. **Promotion bằng bằng chứng thiết bị.** P50/P95 inference và capture→ready riêng, drop/blackout, memory, 30 phút nhiệt. Đối chiếu khoảng cách tới cùng bề mặt bằng thước độc lập, giữ TTL 300 ms. Detector đúng không đồng nghĩa khoảng trống đi bộ an toàn; không quảng bá dẫn đường độc lập.

## Quyết định B4 và điểm dừng

- READY cho gate: nền badge theo lớp, tương phản, chống ghost phone/remote, QA regression và cài cập nhật sau QA theo đồng ý của người dùng.
- **NOT READY** để tuyên bố nhận diện quạt, khắc phục semantic confusion của điện thoại, “mọi vật” hoặc navigation an toàn. Chưa có benchmark thiết bị / candidate / dữ liệu holdout tương ứng.
- Việc gửi một ảnh điện thoại bị nhận sai và một ảnh điều khiển thật sẽ giúp khởi động benchmark local. Ảnh không tự được upload hoặc dùng để quảng cáo độ chính xác. Thay model/huấn luyện/giấy phép là quyết định tiếp theo, không được thực hiện ngầm trong bản cài B4.
