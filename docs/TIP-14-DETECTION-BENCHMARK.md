# TIP-14 · Detection quality and speed benchmark

> Baseline before được đóng ngày 06/08/2026. TIP-15 sau đó thay threshold/query/post-processing production; xem `docs/TIP-15-DETECTION-TUNING.md` cho kết quả after.

## 1. Mục tiêu

Tạo một benchmark tái lập được cho hai detection engine đang chạy trong RoboEye:

- chất lượng: class-aware precision, recall và F1 tại IoU 0,5;
- tốc độ: thời gian model sẵn sàng và inference latency min/mean/p50/p95/max;
- môi trường thật: production detection worker, model/revision/threshold thật, browser + WASM q8;
- artifact máy đọc được: `tests/.benchmark-results/detection-benchmark-latest.json`.

Benchmark này là **regression corpus nhỏ**, không phải COCO mAP và không đại diện toàn bộ tình huống ngoài đời.

## 2. Contract

| ID | Yêu cầu | Cách đáp ứng |
|---|---|---|
| REQ-B01 | Input cố định, có provenance | Manifest ghi URL, byte size, SHA-256, kích thước và nguồn từng ảnh |
| REQ-B02 | Không dùng fixture bị thay âm thầm | Downloader tải atomic rồi kiểm size + SHA-256 trước khi cache/stage |
| REQ-B03 | Đo đúng production runtime | Hook benchmark cấp frame vào `detect-worker.ts`; chỉ bật bằng query flag |
| REQ-B04 | Chất lượng dựa trên ground truth | Matching theo lớp, score giảm dần, one-to-one, IoU ≥ 0,5 |
| REQ-B05 | Có phân phối latency | 1 warm-up + 3 lượt đo/cảnh; nearest-rank p50/p95 |
| REQ-B06 | Truy vết được môi trường | JSON ghi commit, Node, OS, CPU, browser, backend và cấu hình model |
| REQ-B07 | Chống drift | Worker và runner dùng chung `DETECTION_CONFIG`; unit test metric; CI chạy tuần/thủ công |
| REQ-B08 | Không phóng đại kết quả | Báo rõ corpus chỉ phục vụ regression, chưa phải mAP đại diện |

## 3. Corpus v1

Manifest: `tests/fixtures/detection-benchmark.manifest.json`.

| Cảnh | Nguồn | Lớp được đánh giá | Ground truth |
|---|---|---|---:|
| dog | PyTorch Hub example asset | dog | 1 |
| astronaut | Transformers.js documentation fixture | person | 1 |
| bus | Ultralytics example asset | bus, person | 5 |

Ảnh được tải vào thư mục cache đã ignore và không được đóng gói trong release. Annotation v1 được ghi theo pixel trên ảnh gốc. Với OWL-ViT, query thuộc từng cảnh; ví dụ chó dùng `a photo of a dog`. Với RT-DETR, chỉ prediction thuộc các lớp đã annotate của cảnh mới được chấm; lớp hiện diện nhưng chưa annotate không bị tính nhầm là false positive.

## 4. Phương pháp đo

1. Build production bundle và stage fixture đã kiểm checksum.
2. Mở Chromium mới với `?webgl=1&wasm=1&detection-benchmark=1`; không xin camera.
3. Tải từng engine bằng model/revision ghim trong `src/detection-config.ts`.
4. Resize mỗi ảnh về đúng input width 384, giữ tỉ lệ và quy tắc chiều cao chẵn như capture runtime.
5. Đổi query theo cảnh đối với OWL-ViT; chạy 1 warm-up rồi 3 measured runs.
6. Chấm prediction của measured run đầu, gom latency của cả 3 measured runs.
7. Micro-average TP/FP/FN trên toàn corpus và ghi JSON.

Confidence là điều kiện lọc prediction, **không phải accuracy**. RT-DETR dùng threshold 0,45; OWL-ViT dùng 0,10. Các giá trị nằm trong cấu hình production dùng chung, runner sẽ dừng nếu manifest bị lệch.

## 5. Chạy benchmark

```bash
npm run benchmark:detection
```

Chỉ kiểm fixture cache, không tải lại:

```bash
npm run fixtures:detection-benchmark:verify
```

Output JSON là artifact theo máy nên không commit. Workflow CI chạy job này vào lịch tuần hoặc `workflow_dispatch`, rồi upload artifact 30 ngày. Pull request thông thường không tải hai model để tránh biến quality lane thành network gate chậm và dễ nhiễu.

## 6. Cách đọc kết quả

- Precision thấp: nhiều box dư/duplicate trong các lớp được đánh giá.
- Recall thấp: bỏ sót ground truth.
- F1: cân bằng precision và recall trên corpus v1.
- `modelReady.readyMs`: gồm khởi tạo và ảnh hưởng browser cache; luôn đọc cùng `cacheState`.
- `latencyMs.p50/p95`: inference trong worker, không gồm tải/giải mã ảnh.

Không so latency giữa hai máy, hai browser hay WebGPU/WASM như cùng một baseline. Muốn tạo regression gate định lượng phải giữ cùng lớp phần cứng, browser, backend, corpus và số lượt đo; sau đó dùng nhiều lần chạy để chốt tolerance.

## 7. Quyết định sản phẩm sau baseline

- Giữ RT-DETR làm engine realtime mặc định vì ưu tiên recall/tốc độ cho lớp COCO.
- Giữ OWL-ViT làm chế độ truy vấn open-vocabulary có chủ đích; query phải cụ thể theo cảnh/domain.
- Tối ưu tiếp theo nên tách theo số liệu: duplicate suppression cho RT-DETR; prompt/query preset và profiling graph cho OWL-ViT.
