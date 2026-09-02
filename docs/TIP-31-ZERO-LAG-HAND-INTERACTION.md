# TIP-31 · Zero-lag hand interaction pipeline

## Mục tiêu

Khôi phục cảm giác điều khiển trực tiếp cho AirSketch và AirDesk. Không sửa bằng
cách nới threshold riêng lẻ; TIP-31 đo và xử lý đủ chuỗi:

`camera frame → bitmap → worker → MediaPipe → lọc tín hiệu → hit target → render`.

## Điều tra nguyên nhân gốc

| Lớp | Hiện trạng trước TIP-31 | Hậu quả cảm nhận |
|---|---|---|
| Capture | Lấy frame tay từ vòng render Three.js 60 Hz dù camera thường 30 Hz | kiểm tra trùng frame, nhịp không đều, cạnh tranh main thread |
| Telemetry | `capturedAt` được đặt sau `createImageBitmap()` | số pipeline p95 cũ không tính thời gian chuyển bitmap và tuổi frame nguồn |
| Inference | Hand Landmarker khóa CPU | bỏ qua GPU delegate trên máy/trình duyệt hỗ trợ |
| Signal | EMA theo frame, không dựa trên thời gian thật | phải chọn giữa rung khi đứng yên hoặc trễ khi di chuyển nhanh |
| AirDesk DOM | tạo lại 5 node ngón tay, toàn bộ SVG và transition vị trí mỗi kết quả | thêm độ trễ nhân tạo, layout/style work và garbage collection |
| Target | `elementFromPoint()` đòi chạm đúng pixel vào nút/handle nhỏ | chụm có vẻ không ăn dù tracker đã nhận tay |
| Gesture | muốn cầm vật phải xòe tay chờ rồi mới chụm | trạng thái dài, khó nhớ và dễ rớt vì phân loại pose |

Số đo p95 khoảng 34 ms trong báo cáo trước chỉ là inference/reply sau bước tạo
bitmap. Đây không phải camera-to-result latency, vì vậy không được dùng làm bằng
chứng rằng tương tác đã nhanh.

## Quyết định kiến trúc

1. Dùng `HTMLVideoElement.requestVideoFrameCallback()` để chỉ xử lý frame camera
   mới; fallback render-loop chỉ dành cho trình duyệt không hỗ trợ.
2. Giữ latest-frame-wins: tối đa một bitmap/inference đang bay, không tạo queue.
3. Thử MediaPipe GPU trước, nhưng đo hai frame sống: nếu inference liên tiếp vượt
   120 ms thì tự chuyển CPU. Một GPU graph khởi tạo được vẫn có thể là software
   GPU và chậm hơn CPU; fallback không được chỉ dựa trên lỗi khởi tạo.
4. Dùng bộ lọc 1€ theo timestamp. `stable` làm hit-test/drag anchor; `display`
   được dự báo ngắn theo tuổi frame để con trỏ và nét bám tay mà không làm vật bị
   overshoot.
5. Dùng vùng bắt mục tiêu kiểu Bubble Cursor cho controls nhỏ: chọn tối đa một
   mục tiêu gần nhất trong bán kính giới hạn.
6. Chụm trực tiếp trên vật đã vẽ để cầm; chụm ở khoảng trống để vẽ. Open-palm
   dwell vẫn còn như lối vào workspace thao tác, nhưng không còn là cửa bắt buộc.
7. Giữ DOM fingertip, update bằng `translate3d`, bỏ transition vị trí. SVG chỉ
   cập nhật path vừa đổi; canvas AirSketch không còn vẽ hai lần mỗi hand sample.

## Telemetry và ngân sách nghiệm thu

`window.__roboeyeAirSketchBenchmark.snapshot()` công bố riêng:

- `capture.p50/p95`: thời gian `createImageBitmap`;
- `hand.p50/p95`: MediaPipe inference trong worker;
- `pipeline.p50/p95`: tuổi frame nguồn tại lúc main thread nhận kết quả;
- `droppedVideoFrames`: số frame camera bị bỏ theo `presentedFrames`.

Real-model smoke gate trên host kiểm soát:

- hand p95 < 80 ms;
- bitmap capture p95 < 30 ms;
- camera-to-result pipeline p95 < 160 ms;
- không queue frame; unit/E2E/build/security/release verifier phải xanh.

Các ngưỡng trên là cổng hồi quy kỹ thuật, không phải cam kết mọi thiết bị. FPS
camera, ánh sáng, motion blur, GPU/driver và nhiệt độ máy vẫn ảnh hưởng trực tiếp.
GitHub runner chia sẻ dùng smoke ceiling 250/60/350 ms cho hand/capture/pipeline
để bắt treo và hồi quy lớn; số đo nghiệm thu tương tác phải lấy trên máy demo.

## Nguồn đã cào lọc

Registry có provenance nằm tại
`docs/refinery/domains/realtime_hand_interaction/`. Bốn nguồn tier A bao phủ đủ
bốn lớp giải pháp: frame-synchronous capture, worker/delegate runtime, 1€ filter
và Bubble Cursor target acquisition. Xem `RESULT.md` để tái kiểm định.

## Acceptance

- Frame capture bám frame video thật và có fallback.
- GPU-first, performance-probed CPU fallback báo đúng delegate.
- AirSketch/AirDesk dùng cùng bộ lọc 1€ timestamp-aware.
- Direct spatial pinch phân biệt cầm vật và vẽ.
- AirDesk không tái tạo fingertip DOM hoặc toàn bộ SVG ở mỗi sample.
- Unit test khóa jitter, prediction bound, nearest target và direct pickup.
- Model smoke khóa cả capture, inference và camera-to-result p95.
