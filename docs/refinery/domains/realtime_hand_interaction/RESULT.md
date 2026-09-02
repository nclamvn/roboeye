# Kết quả refinery · realtime_hand_interaction

- Build digest: `2a0851b01842052f`
- Entities: 4/4
- Coverage: 100%
- Idempotence: PASS
- Auditor: PASS
- Adversarial bites: PASS cho mọi tooth áp dụng

## Registry

| Entity | Lớp áp dụng | Nguồn chính |
|---|---|---|
| `frame-synchronous-capture` | capture | MDN `requestVideoFrameCallback()` |
| `worker-delegate-runtime` | inference | Google AI Edge MediaPipe worker sample/docs |
| `one-euro-filter` | filtering | Géry Casiez, 1€ Filter |
| `bubble-cursor-targeting` | targeting | Tovi Grossman, Bubble Cursor |

Tất cả claim trong `claims.jsonl` trỏ về snapshot raw và evidence span. Chạy lại:

```sh
python refinery.py domains/realtime_hand_interaction
python bites.py domains/realtime_hand_interaction
```
