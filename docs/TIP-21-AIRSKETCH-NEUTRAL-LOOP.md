# TIP-21 — AirSketch neutral hand loop and continuous composition

## Gesture contract

```text
nắm tay (idle, bút ẩn) → di chuyển an toàn → giơ trỏ
→ vẩy trỏ hai lần (armed) → vẽ → nắm tay (idle) → lặp lại không giới hạn

vẽ → xòe bàn tay → pinch để cầm → thả để đặt → nắm tay → arm → vẽ object mới
```

## Requirements

- `REQ-21-01`: closed fist immediately raises the pen, cancels pinch and hides the visual cursor.
- `REQ-21-02`: pointing after a fist never starts drawing; exactly the deliberate two-flick activation arms a new stroke.
- `REQ-21-03`: repeatable neutral → arm → draw → neutral cycles retain every completed object.
- `REQ-21-04`: long sparse tracking jumps are interpolated before rendering, improving visual continuity without changing the classifier or camera model.

## Acceptance

- A pinch while idle cannot create ink.
- A fist ends current ink and the next extended index remains non-drawing until two flicks complete.
- Two complete cycles create two preserved strokes.
- The worker-to-canvas browser contract uses the neutral double-flick flow.
