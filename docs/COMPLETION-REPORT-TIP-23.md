# Completion Report — TIP-23

## Delivered

The timing-sensitive double-flick grammar has been removed from the AirSketch drawing path. The controller now uses a static clutch: thumb–index pinch draws, release ends the stroke, fist is safe transport, and an open palm held for 350 ms enters manipulation. In manipulation, pinch grabs and release drops the selected object.

The UI now states the active contract in Vietnamese and preserves the explicit `Đã đặt vật thể` feedback instead of overwriting it with a default manipulation message in the same frame.

## Verification

- Typecheck: PASS.
- Unit: 39/39 PASS, including clutch, dwell reset, fist safety, hysteresis and unlimited sequential drawings.
- AirSketch browser E2E: PASS, including real mock-landmark stroke, grab, scale path and drop.
- Release browser E2E: PASS.

## Operator guide

1. Nắm tay để di chuyển an toàn.
2. Giơ ngón trỏ để định vị.
3. Chụm ngón cái + trỏ để vẽ; nới ra để kết thúc nét.
4. Giữ bàn tay mở đến khi trạng thái chuyển sang `Chế độ cầm`.
5. Chụm gần vật thể để cầm; nới ra để đặt.
