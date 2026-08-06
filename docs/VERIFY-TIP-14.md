# Verify · TIP-14

## Traceability

| Requirement | Evidence | Trạng thái |
|---|---|---|
| REQ-B01 | `tests/fixtures/detection-benchmark.manifest.json` | PASS |
| REQ-B02 | `scripts/prepare-detection-benchmark.mjs` + verify command | PASS |
| REQ-B03 | benchmark API trong `src/main.ts`, production worker | PASS |
| REQ-B04 | `src/detection-metrics.ts` + unit tests | PASS |
| REQ-B05 | runner warm-up/measured runs + latency summary | PASS |
| REQ-B06 | generated JSON environment/config fields | PASS |
| REQ-B07 | `src/detection-config.ts`, CI scheduled/manual job | PASS |
| REQ-B08 | scope warning trong manifest/spec/report | PASS |

## Safety review

- Hook không tồn tại nếu thiếu query flag `detection-benchmark`.
- Benchmark không gọi camera, không upload frame và chỉ đọc fixture từ cùng origin preview.
- Fixture không vào release bundle thường; chỉ được stage sau build bởi benchmark pre-script.
- Cache và result JSON bị ignore khỏi Git.
- URL fixture cố định được bảo vệ bởi size + SHA-256; download dùng file `.part` rồi rename.

## Gate policy

- Fail ngay: manifest drift, checksum/size/dimension mismatch, model load/infer error, browser error, thiếu measured run.
- Chưa fail theo F1/latency: corpus v1 mới là baseline quan sát. Chỉ thêm threshold gate sau khi có nhiều artifact trên cùng runner class và tolerance được phê duyệt.
