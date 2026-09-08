# BLUEPRINT · RoboHand Mirror — bàn tay robot mô phỏng bàn tay thật

Status: **DRAFT — chờ Homeowner APPROVED trước khi thi công**  
Release target: `v1.5.0`  
Proposed task range: `TIP-33` → `TIP-36`

## 1. Product outcome

RoboEye có thêm một chế độ trình diễn độc lập tên **RoboHand**. Camera đọc toàn bộ 21 mốc của một bàn tay, giải tư thế cổ tay và từng đốt ngón rồi điều khiển một bàn tay robot humanoid 3D theo thời gian thực. Người xem phải thấy ngay quan hệ một-một giữa bàn tay thật và bàn tay robot: xoay cổ tay, nắm, xòe, chỉ, chụm, chữ V, OK và mọi tư thế trung gian đều được sao chép liên tục, không bị giới hạn vào một danh sách gesture cố định.

“Độ trễ gần như bằng 0” được chuyển thành tiêu chuẩn đo được: không xếp hàng frame, animation vẫn chạy ở tần số màn hình, và camera-frame → robot-pose đạt `p95 ≤ 120 ms` trên máy demo mục tiêu. Đây là mục tiêu cảm giác tức thời; không tuyên bố độ trễ vật lý bằng 0.

## 2. SCAN report

### Hiện trạng có thể tái sử dụng

- Vite + TypeScript, Three.js `0.185.1`, WebGPU với WebGL2 fallback.
- MediaPipe Hand Landmarker chạy trong classic Worker, model `float16/1`, đã có cơ chế GPU → CPU fallback.
- Camera dùng `requestVideoFrameCallback`, `ImageBitmap`, giới hạn 30 fps và chiến lược latest-frame-wins.
- Pipeline đã có timestamp, adaptive filtering, bounded prediction và metric p50/p95.
- Scene hiện dùng một renderer và một animation loop; mode là union type tại compile time.

### Khoảng trống

- Worker mới trả normalized landmarks; RoboHand cần thêm `worldLandmarks` để giải góc ngón ổn định theo không gian.
- Chưa có skeleton/rig bàn tay, retarget solver, joint constraints hoặc hand-centric coordinate system.
- Chưa có chế độ render 3D chuyên biệt, camera picture-in-picture và HUD latency/FPS.
- Chưa có fixture chuyển động 21 điểm hay benchmark sai số góc/jitter/latency cho hand retargeting.

### Rủi ro cốt lõi

1. Asset ngoài có thể đẹp nhưng không có rig đúng, tên xương không chuẩn hoặc skin weight kém.
2. Tải asset trực tiếp từ Sketchfab tạo phụ thuộc auth, CORS, license và mạng — không phù hợp GitHub Pages/offline demo.
3. Chạy renderer nặng cùng inference có thể làm GPU contention và tăng latency.
4. Smoothing quá mạnh tạo cảm giác trễ; smoothing quá nhẹ làm ngón robot rung.
5. Sai hệ trục hoặc handedness khiến ngón gập ngược và cổ tay lật sai.

## 3. RRI — quyết định yêu cầu

| Câu hỏi | Quyết định |
|---|---|
| Một hay hai bàn tay? | P0 hỗ trợ một bàn tay, tự nhận trái/phải; hai tay để phase sau. |
| Sao chép gesture hay sao chép khớp? | Sao chép liên tục toàn bộ khớp; tên gesture chỉ là telemetry để người xem kiểm chứng. |
| Có bắt buộc hiệu chỉnh? | Không. Auto-normalize theo chiều rộng lòng bàn tay; nút hiệu chỉnh trung tính là tùy chọn. |
| Asset từ đâu? | P0 dùng rig nguyên bản sinh bằng code; adapter cho phép thay visual bằng `.glb` đã duyệt ở P1. |
| Camera có còn hiển thị? | Có, picture-in-picture để nhìn bàn tay thật cạnh mô hình và xác minh chuyển động. |
| Privacy? | Mọi landmark/inference chạy tại browser; không upload hình ảnh. |
| Khi mất tay? | Giữ pose ngắn 220 ms, sau đó blend về rest pose; tuyệt đối không snap. |

## 4. Vision và UX contract

```text
┌─────────────────────────────────────────────────────────────┐
│ ROBOHAND MIRROR          TRACKING · GPU     72 ms · 60 FPS │
│                                                             │
│                  [robot hand 3D · hero]                     │
│                                                             │
│                                      ┌───────────────────┐  │
│                                      │ camera + 21 điểm │  │
│                                      │ RIGHT · PINCH     │  │
│                                      └───────────────────┘  │
│  REST / OPEN / FIST / POINT / PINCH / V / OK               │
└─────────────────────────────────────────────────────────────┘
```

- Bàn tay robot chiếm vùng chính, nền graphite, ánh sáng studio và vật liệu PBR kim loại/carbon.
- Camera inset không che khớp quan trọng; 21 landmark và connection overlay là bằng chứng trực quan.
- HUD chỉ hiển thị handedness, pose quan sát được, backend tracking, pipeline latency và render FPS.
- Không modal, không panel nền đặc che camera, không yêu cầu thao tác kích hoạt.
- Khi vào RoboHand, pause depth/object detection/AirSketch để dành tài nguyên cho tracking và render.

## 5. Asset strategy

### Quyết định P0: procedural rig nguyên bản

Tạo một bàn tay robot exoskeleton bằng Three.js primitives và PBR materials: lòng bàn tay nhiều lớp, 5 cụm ngón, khớp actuator, tendon rod, fingertip shell và emissive status. Hình học có LOD, dùng chung geometry/material và không phụ thuộc tải mạng.

Lý do:

- Rig và hierarchy do RoboEye kiểm soát hoàn toàn nên retarget có kết quả xác định.
- Không có rủi ro license/attribution/CORS/auth ở runtime.
- Có thể tối ưu draw call và polygon budget theo máy demo.
- Visual tách khỏi `RobotHandRig` contract; một `.glb` có skeleton tương thích có thể thay thế sau.

### P1: adapter cho asset rigged GLB đã duyệt

Chỉ nhận asset sau khi kiểm tra license, tác giả, attribution, skeleton hierarchy, skin weights, neutral pose, triangle count và khả năng đóng gói local. Không dùng URL Sketchfab làm runtime dependency.

## 6. Architecture

```text
camera frame
   │ requestVideoFrameCallback · latest-frame-wins
   ▼
Hand Worker
   ├─ 21 normalized landmarks ──► screen root / scale / PiP overlay
   ├─ 21 world landmarks ───────► hand-centric pose solver
   └─ handedness + score ───────► canonical left/right mapping
                                      │
                                      ▼
                            joint constraints + adaptive filter
                                      │
                          capture-age bounded prediction
                                      │
                                      ▼
                RobotHandRig contract: root + 20 articulated joints
                                      │
                                      ▼
                  Three.js/WebGPU render interpolation at display Hz
```

### Coordinate and retarget contract

- Palm basis được dựng từ wrist `0`, index MCP `5`, middle MCP `9`, pinky MCP `17`.
- Finger chains: thumb `1-2-3-4`, index `5-6-7-8`, middle `9-10-11-12`, ring `13-14-15-16`, pinky `17-18-19-20`.
- Solver dùng fixed-length kinematic rig; landmarks cung cấp hướng xương, không kéo giãn mesh theo nhiễu camera.
- World rotation được đổi về local quaternion theo parent bone; mọi khớp có anatomical clamp để không bẻ ngược.
- Root translation/scale dùng normalized landmarks; joint articulation dùng world landmarks.
- Quaternion interpolation dùng đường ngắn nhất, adaptive cutoff theo tốc độ; prediction chỉ bù phần capture age và bị giới hạn.

### Runtime ownership

- Giữ duy nhất một Three.js renderer và một animation loop.
- Inference tiếp tục ở Worker, không đưa MediaPipe về main thread.
- Render loop chỉ đọc snapshot pose mới nhất; không chờ inference và không tạo hàng đợi frame.
- Geometry/material được reuse; không allocate vector/quaternion trong hot path.
- Pause các pipeline không liên quan khi RoboHand active; restore khi rời mode.

## 7. Requirements matrix

| REQ-ID | Requirement | Priority | Verification |
|---|---|---:|---|
| RH-01 | Có mode RoboHand độc lập trong UI | P0 | E2E + visual smoke |
| RH-02 | Copy liên tục wrist + 20 khớp từ 21 landmarks | P0 | deterministic pose fixtures |
| RH-03 | Tự xử lý bàn tay trái/phải không đảo sai ngón | P0 | mirrored fixtures |
| RH-04 | Robot hand PBR chất lượng cao, responsive, không asset mạng | P0 | render smoke + offline build |
| RH-05 | Camera PiP có skeleton 21 điểm đồng bộ | P0 | E2E screenshot/state |
| RH-06 | Open/fist/point/pinch/V/OK được nhận diện để telemetry | P1 | gesture fixtures |
| RH-07 | Latest-frame-wins, không queue và không block render | P0 | unit + runtime counters |
| RH-08 | Camera-frame → visible pose `p95 ≤ 120 ms` trên profile demo | P0 | benchmark report |
| RH-09 | Render `p95 frame interval ≤ 20 ms` sau warm-up | P0 | benchmark report |
| RH-10 | Static-pose angular jitter RMS `≤ 1.5°`; median joint error `≤ 8°` trên fixture | P0 | deterministic benchmark |
| RH-11 | Mất tay 220 ms hold rồi blend về rest, không snap | P0 | unit + E2E |
| RH-12 | WebGPU và WebGL2 fallback đều không crash | P0 | smoke tests |
| RH-13 | Video và landmarks không rời browser | P0 | architecture/code audit |

## 8. Latency budget

| Stage | p95 budget |
|---|---:|
| Camera capture + bitmap handoff | 12 ms |
| Hand Landmarker Worker | 70 ms |
| Pose solve + filtering | 4 ms |
| Main-thread scheduling | 14 ms |
| Next visible render | 20 ms |
| **End-to-end target** | **≤ 120 ms** |

Các budget không được cộng máy móc nếu stage overlap; metric chuẩn là timestamp camera frame đến animation frame đầu tiên đã áp pose đó.

## 9. Proposed modules

```text
src/
  robohand-types.ts          # contracts, joints, telemetry
  robohand-pose.ts           # basis, handedness, kinematic solve
  robohand-filter.ts         # adaptive quaternion/vector filter
  robohand-gestures.ts       # labels for observability only
  robohand-rig.ts            # procedural articulated PBR rig
  robohand-controller.ts     # lifecycle and latest pose bridge
  robohand-view.ts           # PiP + landmark overlay + HUD
tests/unit/
  robohand-pose.test.ts
  robohand-filter.test.ts
  robohand-gestures.test.ts
  robohand-benchmark.test.ts
docs/
  TIP-33-ROBOHAND-POSE-PIPELINE.md
  TIP-34-ROBOHAND-PREMIUM-RIG.md
  TIP-35-ROBOHAND-REALTIME-QUALITY.md
  TIP-36-ROBOHAND-RELEASE.md
```

## 10. Task graph after approval

```text
TIP-33 · world landmarks + canonical pose solver + fixtures
   ↓
TIP-34 · procedural PBR rig + RoboHand mode + camera PiP
   ↓
TIP-35 · adaptive filtering/prediction + gestures + latency benchmark
   ↓
TIP-36 · E2E, fallback, visual polish, docs, deploy v1.5.0 candidate
```

Mỗi TIP có acceptance criteria, unit/E2E tương ứng, Completion Report và commit riêng; không trộn quick fix vào phase.

## 11. Acceptance scenarios

### Scenario A — sao chép tự do

**Given** RoboHand đã warm-up và một bàn tay nằm trong field of view  
**When** người dùng lần lượt xoay cổ tay, gập từng ngón và chuyển giữa các tư thế trung gian  
**Then** robot copy chuyển động liên tục, không snap, không cần gesture kích hoạt và không kéo giãn ngón.

### Scenario B — bàn tay trái/phải

**Given** người dùng đổi từ tay phải sang tay trái  
**When** handedness ổn định qua hysteresis  
**Then** model đổi mapping một lần, giữ đúng thumb/pinky và không flip qua lại từng frame.

### Scenario C — tải và mất tracking

**Given** CPU/GPU đang chịu tải hoặc tay bị che ngắn  
**When** inference chậm hoặc mất landmarks  
**Then** render không bị block, frame cũ không xếp hàng, pose được hold 220 ms rồi trở về rest có easing.

### Scenario D — phát hành tĩnh

**Given** ứng dụng chạy trên GitHub Pages với cache rỗng  
**When** mở RoboHand bằng WebGPU hoặc WebGL2 fallback  
**Then** rig xuất hiện không cần tải asset ngoài và camera tracking hoạt động sau khi cấp quyền.

## 12. Non-goals của phase

- Không điều khiển robot vật lý.
- Không nhận dạng ngôn ngữ ký hiệu hay suy diễn ý nghĩa giao tiếp.
- Không multi-hand, full arm hoặc body retargeting.
- Không hứa mọi laptop đạt cùng latency; báo metric theo thiết bị/backend thực tế.
- Không đưa asset Sketchfab chưa audit vào bundle.

## 13. Sources and provenance

- MediaPipe Hand Landmarker trả normalized landmarks, world landmarks và handedness: https://ai.google.dev/edge/api/mediapipe/python/mp/tasks/vision/HandLandmarkerResult
- Quy ước 21 landmark: https://ai.google.dev/edge/api/mediapipe/python/mp/tasks/vision/drawing_styles/hand_landmarker/HandLandmark
- Three.js `SkinnedMesh` yêu cầu skeleton và skin weights: https://threejs.org/docs/pages/SkinnedMesh.html
- Three.js `GLTFLoader` hỗ trợ glTF skinning/PBR: https://threejs.org/docs/pages/GLTFLoader.html
- Three.js WebGPURenderer và WebGL2 fallback: https://threejs.org/manual/en/webgpurenderer
- Sketchfab Download API yêu cầu user auth và hiển thị attribution/license với CC models: https://sketchfab.com/developers/download-api/guidelines
- Sketchfab license overview: https://sketchfab.com/licenses
- Candidate tham khảo hình thức, chưa được chọn làm dependency: https://sketchfab.com/3d-models/robotic-hand-3e284b06bbb84d858f85f7a246cd65df

## 14. Approval checkpoint

Sau khi Homeowner trả lời **APPROVED**, Contractor sẽ tạo TIP-33…TIP-36 và Builder bắt đầu thi công tuần tự. Thay đổi phạm vi P0, asset strategy hoặc latency gate sau approval phải được ghi thành decision log trước khi code tiếp.
