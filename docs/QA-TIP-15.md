# QA · TIP-15

Ngày: 06/08/2026

Baseline before: `docs/QA-TIP-14.md`

After artifact: `tests/.benchmark-results/detection-benchmark-latest.json`

## Kết quả chất lượng

| Engine | TP before→after | FP before→after | FN before→after | F1 before→after |
|---|---:|---:|---:|---:|
| RT-DETR | 6 → 6 | 2 → 0 | 1 → 1 | 0,800 → 0,923 |
| OWL-ViT | 2 → 5 | 1 → 0 | 5 → 2 | 0,400 → 0,833 |

After theo cảnh:

- RT-DETR: dog 0/1; astronaut 1/1; bus 5/5, FP=0.
- OWL-ViT: dog 1/1; astronaut 1/1; bus 3/5, FP=0.

## Kết quả tốc độ after

| Engine | Ready | p50 | p95 |
|---|---:|---:|---:|
| RT-DETR | 4.451 ms | 1.792 ms | 1.840 ms |
| OWL-ViT | 16.523 ms | 3.179 ms | 3.321 ms |

Môi trường và protocol giống T14: M1 Max, Chromium 151 headless, WASM q8, width 384, 1 warm-up + 3 measured/cảnh. Ready time có browser cache không kiểm soát.

## Gates đã chạy trong quá trình build

- `npm run test:unit`: 23/23 PASS.
- `npm run typecheck`: PASS.
- `npm run build`: PASS.
- `npm run test:detection-e2e`: preset + custom query contract PASS.
- `npm run benchmark:detection`: both real engines PASS.
- `npm run qa`: PASS.
- `npm run test:detection-models`: real pinned RT-DETR + OWL-ViT PASS.
- `npm run smoke`: real depth q8/WASM PASS.
- `npm run release:verify`: RoboEye v1.2.1 release artifact PASS.
