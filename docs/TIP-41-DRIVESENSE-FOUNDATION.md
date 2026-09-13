# TIP-41 — DriveSense D1/D2: nền đo hình học camera đơn

Priority P0. Depends: TIP-40, blueprint approved by user 2026-09-13.
Context: `src/worker/detect-worker.ts`, `detection-types.ts`, Vite multi-entry.
Vai tuần tự: chủ thầu giao TIP → thợ xây → chủ thầu kiểm chứng.

## Scope and acceptance

- R1: Trang DriveSense riêng, link từ RoboEye; local video/camera opt-in, không
  mirror; seek/source change reset; không ảnh hưởng mode cũ.
- R2: Camera profile kiểm tra chặt; ray/plane intersection có pitch/roll và
  Brown–Conrady inverse distortion, uncertainty propagation; missing/mismatched
  calibration, clipping, horizon/large uncertainty → null, không mét giả.
- R3: Robust refinement height/pitch bằng điểm đất có khoảng cách đo, tách holdout;
  unit test ngoại lai/degenerate. Không thay cho intrinsic lens calibration.
- R4: RT-DETR baseline, two-stage score association + Hungarian matching; Kalman
  range/velocity, reject outliers; stale/missing range không carry số cũ.
- R5: Bbox/badge, trạng thái chất lượng, màu gần thử nghiệm không FCW; không suy
  làn đường hoặc TTC an toàn từ bbox. Dataset replay/benchmark JSON có coverage,
  signed bias, MAE/P95 và latency; mọi chưa đo là null.
- R6: Synthetic replay và tests chứng minh wiring/toán, KHÔNG gọi synthetic là
  độ chính xác camera. Source teardown, stale result, backpressure và resize test.

D1 thực địa chưa có dữ liệu người dùng: xây công cụ nhập đối chứng, giữ gate nghiệm
thu mở. D2 chỉ là baseline nghiên cứu. D3 model bake-off/fusion và D4 FCW không được
coi hoàn tất khi thiếu benchmark. Chưa đổi native/edge, mua hardware hay deploy.

Math: original TypeScript pinhole/Brown–Conrady ray projection (OpenCV convention),
Huber-weighted Gauss–Newton calibration refinement, 1D constant-velocity Kalman,
Hungarian assignment and ByteTrack-inspired two-score association. Không gọi bản
này là upstream ByteTrack đầy đủ. Không tuyên bố thuật toán tốt nhất trên mọi data.

Design plan (frontend-design): vùng video là trọng tâm, nền graphite #17232b,
bảng thao tác paper #edf2f3, ink #142631, tracking blue #479ec2, caution #e0a12b,
near #d35b4e. Inter cho điều khiển, Noto Serif cho tên sản phẩm để nối RoboEye.
Desktop video trái/control phải; mobile video trước/control sau. Chữ căn trái,
không hero marketing/cards lặp lại. Cảnh báo cố định bên ngoài video, badge nhỏ
trên vật thể. Rà soát brief: không panel tối đặc che video, không chuyển động trang
trí. Chỉ demo do người dùng kích hoạt mới chạy hoạt ảnh synthetic.

No new dependencies. Unit+typecheck+production build+browser visual/functional QA.
Ground truth camera/thermal mobile acceptance remains explicit open work.
