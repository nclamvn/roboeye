# Verify · TIP-15

| Requirement | Evidence | Trạng thái |
|---|---|---|
| REQ-T01 | `postprocessDetections`, RT NMS config, benchmark FP 2→0 | PASS |
| REQ-T02 | `overlapOverSmaller` + containment unit test | PASS |
| REQ-T03 | invalid/clamp/cap unit test | PASS |
| REQ-T04 | `createOwlPromptPlan`, canonical labels in real benchmark | PASS |
| REQ-T05 | preset UI + mock worker E2E | PASS |
| REQ-T06 | shared config threshold 0,08 + OWL post-process | PASS |
| REQ-T07 | T14/T15 QA tables and generated JSON | PASS |
| REQ-T08 | 23 unit tests, detection E2E, real browser benchmark | PASS |

## Regression policy

- Fail: duplicate FP tăng lại trên corpus, TP giảm, manifest/config drift, browser/model errors.
- Theo dõi: p50/p95 và ready time; chưa đặt hard latency threshold xuyên phần cứng.
- Mở rộng tiếp: thêm corpus domain kho vận/robotics trước khi điều chỉnh NMS hoặc threshold thêm.
