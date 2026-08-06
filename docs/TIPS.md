# TIP-01 → TIP-04 · RoboEye

Chủ thầu phát cho Thợ 01/08/2026, sau khi Chủ nhà approve PRD v1.0 bằng chỉ thị build trực tiếp.
Nguyên liệu gốc: registry fact F01–F11 trong PRD mục 4. Bốn TIP tương ứng bốn milestone M1–M4.

## TIP-01 · M1: Nền tảng + Depth mode

- **Dependencies:** không. **Priority:** P0.
- **Context:** project trống, tạo mới tại `roboeye/`. Stack chốt trong Blueprint (PRD mục 7): Vite + TypeScript, DOM thuần, three r182+ qua `three/webgpu`, `@huggingface/transformers` v3.x.
- **Task:** scaffold app, webcam qua getUserMedia (chọn camera, R1), Web Worker chạy pipeline depth-estimation `onnx-community/depth-anything-v2-small` device webgpu dtype fp16 fallback wasm (F01, F04), vòng inference latest-frame-wins tách khỏi vòng render (R2), chế độ Depth grayscale gần sáng xa tối, hai đồng hồ fps riêng, badge backend thật (R8), progress bar tải model.
- **Acceptance:** mở app, cho phép camera, thấy depth map sống; badge đúng backend; không xếp hàng frame khi inference chậm.
- **Constraints:** không React; không server; model Small vì license apache-2.0 (F03).

## TIP-02 · M2: Point Cloud

- **Dependencies:** TIP-01. **Priority:** P0 (xương sống demo, không bỏ).
- **Task:** chế độ Point Cloud ≥100k điểm (F08) qua sprite instanced + TSL, positionNode sample depth texture ngay vertex stage nên buffer tĩnh; unproject pinhole FOV giả định 60° có slider tinh chỉnh; màu lấy từ RGB frame cùng độ phân giải inference để depth và màu khớp orientation; nội suy vị trí giữa 2 depth frame (uMix) cho chuyển động mềm; OrbitControls; freeze/resume (R6); fallback WebGL giảm còn ~30k điểm.
- **Acceptance:** kéo camera ra khỏi vị trí webcam thấy khối phòng nhận ra được; freeze giữ nguyên khối để bay quanh.

## TIP-03 · M3: BEV + shell HIVE

- **Dependencies:** TIP-02. **Priority:** P1.
- **Task:** BEV occupancy grid 96×96 bin trên CPU mỗi depth frame, ước lượng sàn qua percentile y, band vật cản, EMA + hysteresis chống nhấp nháy (rủi ro R3 PRD), quạt FOV + marker camera, monochrome; shell HIVE theo skill lam-nguyen-style bản dark plate: sidebar đen 192px, Noto Serif brand, Inter UI, 4 nút chế độ phím 1-4, slider inference size 140–504 và point size (R7), 2 fps meter, 2 badge, ghi chú relative depth cố định (R8, F11).
- **Acceptance:** lật BEV thấy vật gần thành ô occupied; đi lại trước camera grid đổi theo; đủ 4 chế độ chuyển bằng phím.

## TIP-04 · M4: Panel + polish + fallback

- **Dependencies:** TIP-03. **Priority:** P2 (bỏ đầu tiên nếu thiếu giờ).
- **Task:** panel giải thích tiếng Việt trượt từ phải, phím ?, mỗi chế độ một đoạn cho người không chuyên (R9), FOV slider trong panel; switch fallback tường minh `?webgl=1` `?wasm=1` để demo "tắt WebGPU vẫn sống"; README kèm demo script 5 phút và mục ghi số đo F10; smoke test E2E fake webcam.
- **Acceptance:** chạy trọn kịch bản demo PRD mục 5 không vấp; làn fallback render được point cloud và inference WASM tự hạ 140px, badge nói thật.

## TIP-05 · Obstacle alert (phase 2)

- **Task:** từ BEV grid tính vật cản gần nhất trong quạt FOV, dưới ngưỡng 1.15 đơn vị thì hiện chip cảnh báo dashed góc phải trên ở mọi chế độ, kèm khoảng cách tương đối. Monochrome, không màu đỏ (HIVE: status không phụ thuộc màu).
- **Acceptance:** người bước lại gần camera thì chip hiện kèm số, lùi ra thì tắt.

## TIP-06 · Robot ảo A* trên BEV (phase 2, nối đề tài 011)

- **Task:** A* 8 hướng có binary heap trên grid 96×96, occupied inflate 1 ô thành blocked, ngoài FOV là unknown đi được với phạt nhẹ, chặn lách chéo qua khe. Robot ảo xuất phát tại camera, click lên grid đặt đích, di chuyển mượt theo render frame (1.5 đv/s), replan mỗi depth frame nên người thật bước vào là đường tự vòng qua. HUD chữ mono ghi số bước hoặc KHÔNG CÓ ĐƯỜNG. Đích mặc định tự chọn ô free xa nhất giữa FOV.
- **Acceptance:** click đặt đích thấy đường và robot chạy; đứng chắn đường thấy path bẻ cong theo thời gian thực.
