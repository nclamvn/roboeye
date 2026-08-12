# TIP-27 · Real-time perception recovery

## Vai Chủ thầu

**Vấn đề nghiệm thu.** Người dùng báo AirSketch chậm/không mượt và detection
khóa vật thể chậm, dù landmark ngón tay vẫn xuất hiện. Điều tra T26 đo được
RT-DETR khoảng 1,8 giây và OWL-ViT khoảng 3,2 giây mỗi suy luận khi detector bị
ép sang WASM/CPU. Đồng thời depth, detector và hand tracking cùng tranh capture
và tài nguyên tính toán.

**Mục tiêu.** Khôi phục đường tương tác thời gian thực mà không che giấu fallback:

1. Detection ưu tiên WebGPU theo mặc định; lỗi khởi tạo tự khởi động worker WASM sạch.
2. Depth nhường tài nguyên khi RGB đang bật detection hoặc khi AirSketch hoạt động.
3. Hand worker mang timestamp frame về main để cursor dự đoán độ trễ có giới hạn.
4. Tăng nhịp hand mới nhất-thắng từ 24 lên 30 fps, giữ lọc rung và không xếp hàng frame.
5. Hướng dẫn UI phản ánh đúng grammar thực: trỏ = định vị, chụm cái+trỏ = vẽ,
   nắm = hạ bút, xòe-giữ rồi chụm = cầm/đặt.
6. Hiển thị backend, thời gian infer và cadence detector thay vì che chất lượng thấp.

**Không nhận sai.** Đây không biến detector thành chứng cứ an toàn hoặc đảm bảo
chất lượng trên GPU không hỗ trợ WebGPU. Khi status hiện `WASM`, tốc độ/khóa khung
có thể vẫn thấp; đây là fallback rõ ràng để người dùng có thể chẩn đoán.

## Vai Thợ

- Default init dùng WebGPU; `?detectwasm=1` dành cho chẩn đoán CPU, còn `?wasm=1`
  vẫn ép toàn bộ inference WASM/offline.
- Mỗi kết quả hand trả `capturedAt`; `AirInteractionController` tính vận tốc EMA,
  bù tối đa 55 ms và dịch tối đa 0,075 stage-unit trước adaptive smoothing.
- Ink giữ nhiều điểm chậm hơn và tách segment ngắn hơn để đường cong không thành
  các dây thẳng thưa.
- E2E fixture sử dụng đủ sample open-palm cho dwell 350 ms ở nhịp 30 fps.

## VERIFY

- `npm run test:unit`: state machine, filter, timestamp compensation, multi-object.
- `npm run typecheck`: TypeScript worker contract.
- `npm run test:airsketch-e2e`: bridge worker → ink, draw/grab/place, AAC/mobile.
- `npm run test:detection-e2e`: WebGPU-first init, WASM retry, lock/badge overlay.
- `npm run test:detection-models` và `npm run test:airsketch-models`: real pinned-model gates.
