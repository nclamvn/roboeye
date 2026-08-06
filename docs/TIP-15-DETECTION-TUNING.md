# TIP-15 · Detection post-processing and OWL-ViT query tuning

## 1. Mục tiêu

Dùng benchmark T14 làm phép đo before/after để:

- giảm box trùng của RT-DETR mà không làm mất true positive;
- tăng recall OWL-ViT bằng prompt template và preset theo ngữ cảnh;
- giữ nhãn hiển thị/export ngắn, không để prompt nội bộ rò ra annotation;
- không đánh đổi tốc độ inference đáng kể.

## 2. Contract

| ID | Yêu cầu | Cách đáp ứng |
|---|---|---|
| REQ-T01 | RT-DETR bỏ duplicate cùng lớp | Greedy class-aware NMS, IoU ≥ 0,45 |
| REQ-T02 | Bỏ duplicate nhỏ nằm trong box lớn | Suppress khi intersection/min-area ≥ 0,90 |
| REQ-T03 | Post-processing an toàn | Clamp box 0..1, bỏ NaN/box rỗng, score-order, cap 50 |
| REQ-T04 | OWL prompt tự nhiên nhưng nhãn sạch | `person` → `a photo of a person`; map output về `person` |
| REQ-T05 | Query theo domain | 4 preset: hằng ngày, di chuyển, bàn làm việc, kho vận; có custom |
| REQ-T06 | Tuning threshold có kiểm soát | OWL-ViT 0,10 → 0,08, kèm NMS IoU 0,50/containment 0,92 |
| REQ-T07 | Có bằng chứng before/after | Chạy cùng T14 corpus, width 384, IoU 0,5, WASM q8 |
| REQ-T08 | Có regression protection | Unit test post-process/prompt + detection E2E preset + real benchmark |

## 3. Thiết kế post-processing

`src/detection-postprocess.ts` nhận `DetBox[]` đã normalize, sắp score giảm dần và giữ box đầu tiên. Candidate cùng nhãn bị loại nếu:

1. IoU vượt ngưỡng NMS; hoặc
2. phần giao phủ gần toàn bộ box nhỏ hơn — xử lý trường hợp một box người nhỏ nằm trọn trong box người lớn nhưng IoU tổng thấp.

Matching theo lớp tránh việc box `person` vô tình triệt box `chair` cùng vùng. Tất cả hằng số được export và có unit test.

## 4. OWL-ViT prompt và preset

Người dùng nhập danh từ ngắn, tối đa 8 query. Worker chuẩn hoá chữ thường, bỏ trùng và tạo prompt:

```text
person → a photo of a person
apple  → a photo of an apple
bus    → a photo of a bus
```

Kết quả model được map ngược về nhãn canonical, nên overlay và COCO/YOLO không chứa câu prompt. Preset chỉ thay danh sách query, không reload model:

- Hằng ngày: person, chair, laptop, cup
- Di chuyển: person, car, bus, bicycle, motorcycle
- Bàn làm việc: person, chair, laptop, cup, phone
- Kho vận: person, box, pallet, forklift, door

## 5. Before/after trên T14 corpus

Môi trường: Apple M1 Max, Chromium 151 headless, browser/WASM q8. Mỗi cảnh chạy 1 warm-up + 3 measured runs.

| Engine | Chỉ số | T14 before | T15 after | Thay đổi |
|---|---|---:|---:|---:|
| RT-DETR | FP | 2 | 0 | −100% |
| RT-DETR | Precision | 0,750 | 1,000 | +0,250 |
| RT-DETR | Recall | 0,857 | 0,857 | giữ nguyên |
| RT-DETR | F1 | 0,800 | 0,923 | +0,123 |
| OWL-ViT | Precision | 0,667 | 1,000 | +0,333 |
| OWL-ViT | Recall | 0,286 | 0,714 | +0,428 |
| OWL-ViT | F1 | 0,400 | 0,833 | +0,433 |

| Engine | p50 before | p50 after | p95 before | p95 after |
|---|---:|---:|---:|---:|
| RT-DETR | 2.019 ms | 1.792 ms | 2.060 ms | 1.840 ms |
| OWL-ViT | 3.284 ms | 3.179 ms | 3.903 ms | 3.321 ms |

Latency không được diễn giải là mức tăng tốc chắc chắn vì hai lượt chạy có nhiễu hệ thống/cache. Kết luận hợp lệ là post-processing/prompt tuning không tạo regression latency quan sát được trên lượt đo này.

## 6. Giới hạn

- Kết quả chỉ là regression corpus 3 ảnh/7 objects, không phải mAP hoặc SLA.
- Containment suppression có thể cần giảm trong domain có nhiều vật cùng lớp lồng nhau.
- Preset là điểm khởi đầu; query theo domain thật vẫn cần corpus riêng.
- Threshold 0,08 chỉ được giữ khi benchmark mở rộng tiếp tục bảo toàn precision.
