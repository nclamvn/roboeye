# Completion report · TIP-15

**STATUS:** DONE

## Hạng mục đã giao

- RT-DETR class-aware NMS + containment suppression;
- post-processing dùng chung có clamp, invalid filtering và max-detection cap;
- OWL-ViT prompt template, canonical label mapping và threshold tuning;
- 4 query preset trong UI, custom edit không reload model;
- 4 unit tests mới và 3 detection E2E assertions cho preset;
- benchmark before/after bằng T14 runner;
- tài liệu spec, QA, verify và cập nhật README/TIPS.

## Definition of Done

8/8 REQ-T hoàn thành. Trên corpus T14, RT-DETR loại cả 2 false positive duplicate mà giữ 6 TP; OWL-ViT tăng từ 2 lên 5 TP, không còn FP sau post-processing. Full QA, real-model benchmark, real-depth smoke và release verification đều PASS trước publish.

## Deviation

NMS cũng áp dụng cho OWL-ViT ở ngưỡng riêng 0,50. Lý do: prompt threshold 0,08 tăng recall nhưng có thể sinh box cùng lớp chồng nhau; post-processing giữ precision và dùng cùng primitive đã kiểm thử.
