# Registry notes · đóng fact F10

F10 trong PRD đang là **honest-null**: chưa có benchmark công bố cho DA-v2-small WebGPU trên Mac M-series, không bịa số. Nghiệm thu M1 đo tại chỗ trên máy Chủ nhà rồi điền bảng này. Sau khi điền, F10 nâng tier từ honest-null lên P (đo trực tiếp, có điều kiện đo kèm theo).

## Cách đo

1. `npm install && npm run dev`, mở Chrome trên máy M1, cho phép camera.
2. Đợi badge hiện INFER · WEBGPU và RENDER · WEBGPU (nếu badge khác, ghi đúng badge thấy được).
3. Đặt Inference size 252, quét camera quanh phòng 30 giây, đọc số fps INFERENCE ổn định trên sidebar.
4. Lặp lại ở 504. Ghi thêm fps RENDER ở chế độ Point Cloud.
5. Muốn đo thêm q4f16 thì đổi Model dtype rồi lặp lại.

## Kết quả đo

**F10 ĐÃ ĐÓNG 01/08/2026** tại nghiệm thu M1 trên máy Chủ nhà (MacBook Apple Silicon, Chrome, cả hai badge WEBGPU). Bằng chứng: 4 screenshot nghiệm thu trong session Cowork.

| Điều kiện | fps inference | fps render | Ghi chú |
|---|---|---|---|
| MacBook Apple Silicon · Chrome · fp16 · 336px | 14.1 đến 15.2 | 30 | đo qua 4 chế độ, cảnh thật 2 người |
| fp16 · 252px | [ĐIỀN CỤ THỂ] | [ĐIỀN CỤ THỂ] | tuỳ chọn, kỳ vọng cao hơn 336px |
| fp16 · 504px | [ĐIỀN CỤ THỂ] | [ĐIỀN CỤ THỂ] | tuỳ chọn |

Ngưỡng chấp nhận demo: tối thiểu 5fps inference ở 252px. Kết quả 14 đến 15fps ở 336px vượt ngưỡng khoảng 3 lần ở độ phân giải cao hơn yêu cầu. Render 30fps thay vì 60 nhiều khả năng do Chrome/macOS giới hạn rAF khi tiết kiệm pin; cắm sạc và tắt Low Power Mode nếu muốn kiểm 60fps.

## Số đo được trong container build (chỉ để tham chiếu, KHÔNG đại diện máy thật)

Chromium headless không GPU, inference WASM q8 ở 140px: 0.2fps inference, 1-2fps render (software GL). Giá trị này chứng minh làn fallback sống, không dùng để đánh giá hiệu năng.
