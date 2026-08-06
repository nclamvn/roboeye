# QA · TIP-14

Ngày chạy: 06/08/2026

Máy: Apple M1 Max, arm64, macOS Darwin 25.6.0

Runtime: Node v24.14.1, Chromium 151.0.7922.34 headless, WASM q8

Corpus: `roboeye-t14-regression-v1`, 3 ảnh, 7 ground-truth objects

Protocol: input width 384, IoU 0,5, 1 warm-up + 3 measured runs/cảnh

## Baseline browser/WASM

| Engine | TP | FP | FN | Precision | Recall | F1 | Ready | p50 | p95 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| RT-DETR | 6 | 2 | 1 | 0,750 | 0,857 | 0,800 | 4.597 ms | 2.019 ms | 2.060 ms |
| OWL-ViT | 2 | 1 | 5 | 0,667 | 0,286 | 0,400 | 18.430 ms | 3.284 ms | 3.903 ms |

> Số trên là baseline của đúng máy/browser/backend đã ghi, không phải SLA và không phải mAP. Ready time có browser cache không kiểm soát.

## Kết quả theo cảnh

- RT-DETR: dog 0/1; astronaut 1/1; bus 5/5, có 2 person duplicate/dư trong lớp được chấm.
- OWL-ViT: dog 1/1 với query `a photo of a dog`; astronaut 0/1; bus 1/5 và 1 box bus dư.
- RT-DETR sinh thêm nhãn ngoài scope ở cảnh bus; các nhãn không có annotation tương ứng được ghi `ignoredPredictionCount`, không bị tính sai thành FP.

## Lệnh kiểm chứng

```bash
npm run typecheck
npm run test:unit
npm run fixtures:detection-benchmark:verify
npm run benchmark:detection
```

## Nhận định

Baseline xác nhận hai engine phục vụ hai mục đích khác nhau: RT-DETR có recall cao hơn và nhanh hơn trên lớp đóng; OWL-ViT bắt được lớp chó khi dùng prompt cụ thể nhưng latency cao và recall thấp ở corpus/query hiện tại. Đây là tín hiệu để ưu tiên NMS/post-processing cho RT-DETR và preset/query tuning cho OWL-ViT ở TIP kế tiếp.
