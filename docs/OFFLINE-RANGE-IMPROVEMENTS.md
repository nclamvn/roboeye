# DriveSense — tăng tốc offline và kiểm soát số mét sai

Ngày kiểm tra: 2026-09-14. Phạm vi: phần mềm desktop, phân tích file rồi replay
5 Hz; không chuyển sang realtime, không triển khai xe thật, không push/deploy.

## Kết luận điều tra

1. **GPU chưa thực sự chạy detector.** Graph fp16 lỗi khởi tạo. Graph fp32 gốc
   lỗi `using ceil() in shape computation is not yet supported for AveragePool`
   trong ORT WebGPU 1.22. Nhánh dự phòng WASM q8 một luồng tốn khoảng 1,75 giây
   mỗi nhận diện trong phép đo mới. Tải model không phải toàn bộ nguyên nhân.
2. **Luồng cũ tuần tự.** Seek → detector → depth → mẫu tiếp theo. Canvas bị đặt
   lại kích thước dù shape không đổi. Depth vẫn chạy khi không có xe mạnh.
3. **Định nghĩa số mét gây hiểu nhầm.** Learned trả Z quang học tới bề mặt,
   hình học trả Z dọc mặt đường tới điểm chân xe. Không nhánh nào đo khoảng hở
   ngang 1–3 m của xe vừa vượt hoặc khoảng hở cản xe. Xe khác làn vẫn có thể có
   Z phía trước >10 m; chưa có ground truth để kết luận số đó đúng hay sai.
4. **Zoom không được đưa vào model.** Nhánh neural hiện tại không nhận intrinsics.
   Camera 2×/crop khác phân phối quay; chia/nhân đầu ra theo zoom không phải phép
   hiệu chuẩn hợp lệ. Profile trước đây không được ưu tiên khi AI đã có mét.
5. **Xe xa dễ thiếu thông tin.** Depth 392×224 và ROI bbox có thể lẫn nền/xe gần
   khi xe xa nhỏ hoặc che khuất. Model metric outdoor có miền đầu ra tối đa 80 m.
   Đây là nguyên nhân khả dĩ của A–C bị nén, chưa phải chẩn đoán từng frame clip
   của anh: cần frame, calibration và cự ly đối chứng để chứng minh.

Mô hình phối cảnh làm khoảng cách nhìn bằng mắt không tỷ lệ với số mét. Không
được sửa A–C bằng cách cộng một khoảng B–C chưa được đo.

## Đã triển khai

- Detector GPU riêng cho DriveSense, không thay worker của AirSketch/robot.
  Cố định RT-DETR ở 640×640 và sửa đúng ba AveragePool ceil→floor có cửa sổ lấy
  mẫu tương đương tại shape này; giữ FP32, tất cả lớp và decoder focal/NMS.
  Không đưa thử nghiệm FP16 thất bại vào sản phẩm.
- Pin revision/source hash/derived hash/bytes; worker và lệnh stage kiểm graph.
  Thiếu graph hoặc init lỗi: detector thử WASM trong worker sạch một lần.
  Không ép depth sang CPU chỉ vì detector GPU lỗi.
- Pipeline gối đầu có giới hạn: depth mẫu trước chạy cùng seek/detector mẫu sau.
  Chụp RGBA depth **trước** seek tiếp theo, commit đúng thứ tự, tối đa một request
  mỗi worker. Không giữ video frame toàn clip; hủy/lỗi không tạo replay hoàn chỉnh.
- Không reset canvas khi shape giữ nguyên; không chạy depth nếu thiếu ứng viên xe
  mạnh. Giữ 5 mẫu/giây để phép đo tốc độ không nhờ hạ sampling.
- Learned từ chối xe cắt biên, bbox dưới 10 pixel mỗi chiều trên depth map và
  cặp xe căn dọc cùng lớp có depth xa–gần mâu thuẫn nghiêm trọng với phối cảnh.
  **Đây là heuristic abstention, không phải sửa số mét thành đúng hoặc lane model.**
- Khai báo zoom/crop trong panel Phân tích. Zoom khác 1× chặn công bố mét neural;
  profile đúng nguồn được ưu tiên ngay cả khi hình học trả unknown. Đổi nguồn
  range reset Kalman để không trộn Z quang học và Z mặt đất.
- Hàm crop intrinsics dùng `K' = S × T_crop × K`. UI có trợ giúp điền tiêu cự từ
  FOV ngang thực trước zoom, chỉ với pinhole/square pixels/crop giữa ảnh; chưa tự
  hiệu chuẩn méo lens, EIS, chiều cao gá hay pitch.
- Report v5 ghi policy, zoom, định nghĩa mét, hash GPU, detector/depth/seek latency,
  request depth đã chạy/bỏ qua và tốc độ xử lý toàn clip.

## Bằng chứng đã đo

Máy phát triển macOS, Chrome/WebGPU và WASM một luồng. Không chạy detector khác
trong lúc lấy 21 lượt đối chiếu; tab smoke được đưa lên phía trước. Ảnh bus công
khai của corpus có cùng RGBA 480×640 trong hai nhánh. Một warmup bị loại. Nhánh
WASM là q8, GPU là graph FP32 tương đương graph FP32 gốc; không phải so hai
execution provider trên cùng dtype. Latency ở đây là `detMs` worker, gồm resize/
preprocess/inference/decode, **không** gồm load, seek hay camera-to-display.

| Phép thử | P50 | P95 | Ghi chú |
|---|---:|---:|---|
| WASM q8, 21 lượt | 1.746,7 ms | 1.783,2 ms | bus track, không có profile nên không bịa mét |
| GPU FP32 mới, 21 lượt | 72,4 ms | 76,4 ms | cùng ảnh, bus track; khoảng 24,1× theo P50 |

Bus bbox giữa hai nhánh gần tương đương, không dùng score 0,92 như accuracy.
Native original-FP32 ↔ derived-FP32 kiểm zero/random/bus/dog: max |logits| sai lệch
7,2479e-5, max |bbox| sai lệch 8,5235e-6, dưới gate 1e-4.

Lượt GPU trước đó khi tab ở nền có P50 427,2 ms/P95 773,7 ms. Giữ tab phía trước
đã thay đổi mạnh số đo; cần ghi điều kiện tab khi so hiệu năng, không gộp hai lượt.

Full UI trên clip màu tổng hợp 2 giây: 11 mẫu, detector/depth backend WebGPU,
hoàn tất khoảng 4 giây, không xe mạnh/track/mét. Lượt baseline cùng fixture khoảng
28 giây. Đây là kiểm tra plumbing và skip depth, **không** đại diện video hành trình
có nhiều xe. Chưa đo lại end-to-end video riêng 3 phút bằng bản mới; không lấy
24× của detector để cam kết thời gian xử lý toàn clip.

157 unit tests, typecheck, build, diff-check và security audit đã đạt. Range regression kiểm crop/zoom, clipped/
tiny ROI, A–B=40/A–C=50 bị từ chối và profile ưu tiên. Toàn bộ cự ly trong unit test
là analytic fixtures, **không phải đối chứng vật lý**. UI helper 2×/90°/1280 px
đã kiểm tra fx=fy≈1280, cx=640 và xóa mét khi chưa áp dụng profile đúng zoom.
Đếm depth trong report phân biệt attempt, success, skipped và failed; lỗi không
được gộp thành một frame đã chủ động bỏ qua.

Kiểm tra đóng gói trước commit: tách staged tree khỏi các sửa đổi RoboHand chưa
commit, chạy độc lập **145/145 unit tests**, typecheck, build và security audit —
tất cả đạt. Con số 157 ở trên là working tree có thêm kiểm thử RoboHand; commit
DriveSense không phụ thuộc những sửa đổi đó. Model lớn/cache và dữ liệu tạm
không được đưa vào Git.

Chi tiết số đo: [offline-detector-ab.json](measurements/offline-detector-ab.json).

## Giới hạn nghiệm thu còn mở

Tăng tốc đã có bằng chứng. **Độ chính xác khoảng cách xe vượt và xe xa chưa được
nghiệm thu**: gate làm giảm số mét sai tự tin, có thể giảm coverage; không đồng
nghĩa cự ly còn lại đã đúng. Camera 2× cần profile đúng ảnh sau crop/zoom hoặc
thuật toán metric có điều kiện intrinsics được kiểm chứng độc lập. Xe xa cần
đánh giá depth cao phân giải hơn/geometry trên cùng frame và holdout, không
ngoại suy model ngoài 80 m.

Bước kiểm tra tiếp: phân tích lại cùng clip 3 phút trên tab foreground, xuất v5
để lấy thời gian toàn clip; lập tập near-side/30–70 m/far theo đúng Z, riêng cho
1× và 2×. Cần đối chứng độc lập để báo MAE/P95/coverage; các chỉ số vẫn null khi
không có đối chứng. Browser file chooser tự động hiện bị từ chối quyền đọc file
local; không thay đổi quyền extension hoặc hệ thống để vượt qua.

## Tái tạo và đóng gói

Theo [hướng dẫn](DRIVESENSE-USER-GUIDE.md), export/stage detector và metric trước
build. Artifact GPU 81.033.458 bytes và depth 99.159.817 bytes bị git-ignore;
`npm run build` chỉ đóng gói những file đã stage. **Release CI hiện chưa tự dựng
hai artifact này**; cần thêm gate stage/check hash trước một lần deploy mới.
Không tải file video lên mạng; model/cache không được coi là source code.

Nguồn kỹ thuật chính: [RT-DETR preprocessing đã pin](https://huggingface.co/onnx-community/rtdetr_v2_r18vd-ONNX/blob/936f90b6a476c6da4dfe053fc521af55285976ba/preprocessor_config.json),
[ORT Web session options](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html),
[OpenCV intrinsics/calibration](https://docs.opencv.org/4.13.0/d9/d0c/group__calib3d.html),
[Depth Anything V2 Metric](https://github.com/DepthAnything/Depth-Anything-V2/blob/main/metric_depth/README.md),
[metric head/domain](https://github.com/DepthAnything/Depth-Anything-V2/blob/main/metric_depth/depth_anything_v2/dpt.py).
