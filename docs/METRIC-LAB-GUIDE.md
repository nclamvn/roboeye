# DriveSense — kiểm chứng metric trước tích hợp

TIP44 triển khai bước R0/R1 của [kiến trúc đã nghiên cứu](research/browser-metric-depth/BAO-CAO-KIEN-TRUC.md).
Đây là công cụ kiểm chứng thuật toán, không phải bản cảnh báo lái xe hoàn chỉnh.
Không thay thế hay ghi đè chức năng DriveSense/RoboHand hiện có.

## Chạy bản đã chuẩn bị trên máy này

[Mở công cụ local](http://127.0.0.1:4192/tests/metric-depth-lab.html).

- Chọn **Ảnh thử công khai (bus)** → **MoGe-2 Small** → **WebGPU** → **Tải / khởi tạo model** → **Đo một frame**.
- Chạm lên ảnh để xem độ sâu Z tại điểm đó. Số mét là dự đoán chưa kiểm chứng, không phải khoảng cách cản xe.
- Ảnh/video local và camera được xử lý tại trình duyệt. Nút **Dừng nguồn** giải phóng camera, hủy worker và xóa phép đo cũ.
- Với video/camera, chọn **Bắt đầu đo liên tục**. Chỉ gửi frame mới khi tác vụ trước hoàn tất; không phân tích tương lai rồi phát lại. Nhãn quá 200 ms không còn được hiển thị như phép đo hiện tại. Chế độ này chưa được nghiệm thu hiệu năng camera thật.
- DA2 hiện chỉ chạy **Fixture tham chiếu** 224×280, không nhận video/camera tùy ý. Đây là giới hạn có chủ đích của graph export đã kiểm chứng, không phải lỗi nút bấm.
- WebGPU lỗi sẽ báo lỗi, không âm thầm chạy WASM rồi ghi là GPU. Có thể chọn WASM để đo đối chứng.

`localhost` trên điện thoại là chính điện thoại, không phải máy Mac. Camera trên điện thoại cần môi trường HTTPS tin cậy. Chưa mở mạng LAN/tunnel hoặc công bố lab này; chưa có kết quả thiết bị điện thoại thật.

## Tái lập từ checkout

Chạy trong thư mục repo. Node theo `package.json`; Python 3.14 là bản đã dùng cho reference/export. Không cần Python để inference trong browser sau khi chuẩn bị model.

```sh
npm ci
npm run fixtures:detection-benchmark
npm run fixtures:metric
python3 -m venv tests/.metric-venv
tests/.metric-venv/bin/python -m pip install -r tests/metric-requirements.txt
tests/.metric-venv/bin/python tests/metric-reference.py
tests/.metric-venv/bin/python tests/export-da2-metric.py
npm run dev -- --host 127.0.0.1 --port 4192 --strictPort
```

Lần đầu cần mạng để tải dependency/model/ảnh thử công khai; không tải nội dung camera lên mạng. Kho model nằm trong `tests/.metric-cache/`, bị git ignore, ngoài `public/` và không vào bản phát hành. MoGe khoảng 141 MB; DA2 export khoảng 99 MB, chưa tính RAM inference. Chưa đủ bằng chứng cho ngân sách bộ nhớ điện thoại.

MoGe kiểm revision, số byte, SHA-256 và tên/shape tensor. DA2 kiểm safetensors nguồn, metric config, đối chiếu PyTorch với ONNX, rồi browser kiểm hash graph. Export khác môi trường có thể khác hash: phải điều tra và kiểm parity, không bỏ kiểm hash hay sửa hash chỉ để qua cổng.

Trong terminal khác, có Chromium/Chrome mà helper Playwright tìm được:

```sh
METRIC_RUNS=21 node tests/metric-browser.mjs webgpu moge
METRIC_RUNS=21 node tests/metric-browser.mjs webgpu da2
node tests/metric-browser.mjs wasm moge
node tests/metric-browser.mjs wasm da2
node tests/metric-lab-e2e.mjs
npm run test:unit
npm run release:verify
npm run security:audit
```

Browser test mặc định không ép `--enable-unsafe-webgpu`. Kết quả ở cache; bản bằng chứng của lượt triển khai nằm trong `docs/measurements/tip44/`. Báo cáo bảo mật hiện **FAIL**, xem completion report; không nới allowlist để phát hành.

## Đối chứng số mét

Xuất JSON để lấy ID, thời điểm và điểm đo của từng observation; nhập JSON có dạng:

```json
{"distanceKind":"optical-axis-z","samples":[{"id":"ID-từ-báo-cáo","distanceM":10}]}
```

`10` chỉ minh họa cấu trúc, không phải số đo mẫu đã xác minh. Đối chứng phải đo độc lập đúng điểm, frame, hệ tọa độ Z. Không dùng đầu ra model làm đáp án; không dùng tập hiệu chuẩn để báo điểm kiểm thử. Tính lỗi không fit lại scale theo đáp án. Quan sát mất/già/không hợp lệ làm giảm coverage, không bị bỏ khỏi mẫu số. Không có đối chứng thì accuracy là `null`.

## Thứ tự tiếp theo

1. Export DA2 giữ đúng aspect ratio và preprocess cho khung hành trình; đối chiếu native/browser trên nhiều ảnh ngang, không kéo giãn ảnh để vừa graph dọc.
2. Đo tổng pipeline detector + depth + tracking trên frame thật, gồm tải lạnh, độ trễ dữ liệu, RAM và chạy kéo dài; tiếp tục thử trên điện thoại thật. Không suy FPS từ nghịch đảo thời gian inference đơn lẻ.
3. Ghép depth với vùng xe, kiểm phần che khuất/biên xe/nền đường; tách Z, khoảng cách theo tia nhìn và khoảng hở cản xe. Thiết kế hiệu chuẩn nhanh, kiểm tra camera/lens/crop và báo độ bất định.
4. Đánh giá nhiều clip có nhãn xe và khoảng cách độc lập, giữ tập kiểm thử tách biệt; chỉ tích hợp cảnh báo sau khi đạt tiêu chí về false positive, sai số, coverage và tuổi dữ liệu đã chốt.

Đây vẫn là ứng dụng hỗ trợ phân tích chưa được chứng nhận an toàn; không dùng kết quả để quyết định phanh/lái.
