# Completion report · TIP-14

**STATUS:** DONE

**SCOPE:** benchmark chất lượng và tốc độ detection trong browser/WASM trên một regression corpus có checksum và ground truth.

## Hạng mục đã giao

- metric engine thuần cho IoU, matching one-to-one, micro precision/recall/F1 và latency percentile;
- 4 unit tests gồm overlap, duplicate/wrong-label, aggregate và percentile validation;
- manifest 3 cảnh/7 ground-truth objects có URL, byte size, SHA-256, kích thước, provenance và query;
- downloader/cache/stager xác minh integrity;
- benchmark-only API nối trực tiếp production detection worker, không dùng camera và không có ở URL bình thường;
- runner tải cả RT-DETR và OWL-ViT, warm-up/measure, xuất JSON có môi trường;
- cấu hình model/revision/threshold dùng chung để ngăn benchmark drift khỏi app;
- CI job tuần/thủ công và artifact retention 30 ngày;
- spec, QA và verify report.

## Definition of Done

8/8 REQ-B hoàn thành. Build, typecheck, unit tests, checksum verification và benchmark browser thật đều PASS. Baseline đầu tiên được ghi tại `docs/QA-TIP-14.md`.

## Deviation có chủ ý

Không đặt quality/latency hard gate trong CI ở corpus v1. Một phép đo từ runner khác phần cứng không đủ làm SLA; hiện job là observational benchmark và sẽ cung cấp artifact để tích lũy baseline. Infrastructure/integrity/model errors vẫn làm job fail.

## Giới hạn

- 3 ảnh không đủ tuyên bố mAP hay độ chính xác ngoài đời;
- annotation thủ công chỉ bao phủ lớp mục tiêu từng cảnh;
- `modelReadyMs` chịu ảnh hưởng cache;
- headless browser/WASM không đại diện WebGPU trên máy người dùng.
