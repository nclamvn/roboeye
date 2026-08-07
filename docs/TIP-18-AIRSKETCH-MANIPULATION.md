# TIP-18 — AirSketch: vẽ, cầm và đặt vật thể

## Contract

- `REQ-18-01`: hai flick nhanh bằng ngón trỏ trong 900 ms để arm bút.
- `REQ-18-02`: chỉ tư thế ngón trỏ mới tạo nét sau khi arm.
- `REQ-18-03`: xòe bàn tay chuyển sang manipulation mode.
- `REQ-18-04`: pinch ngón cái + trỏ chọn object gần nhất; nhả pinch để đặt.
- `REQ-18-05`: palm span tương đối điều khiển scale, clamp 0.45–2.8×.
- `REQ-18-06`: mỗi stroke hoàn tất trở thành scene object độc lập.
- `REQ-18-07`: render 2.5D gồm scale, shadow, highlight và selection frame.
- `REQ-18-08`: dữ liệu và thao tác chỉ ở local; không biến tính năng thành kênh cứu hộ tự động.

## Implementation

- `src/airsketch-interaction.ts`: state machine `idle → armed → drawing → manipulating → grabbing`.
- `src/airsketch-scene.ts`: object store, hit-test, drag, depth scale và render.
- `src/main.ts`: nối hand landmarks, scene lifecycle và pointer fallback.
- `src/airsketch-ink.ts`: snapshot nét đang vẽ để không render trùng object đã hoàn tất.

## Decision

Đây là 2.5D tương tác trên mặt phẳng camera, không phải world-space 3D reconstruction. Classifier vẫn chạy sau khi stroke hoàn tất và không quyết định gesture.
