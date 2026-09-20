# Đo khoảng cách xe bằng camera đơn trong trình duyệt máy tính

## Kết luận điều hành

Mục tiêu **có khả thi trên máy tính**, nếu phạm vi được khóa là Chrome/Edge có WebGPU, camera gắn cố định hoặc video hành trình, điều kiện ban ngày ban đầu, và sản phẩm được mô tả là công cụ ước lượng/phân tích chứ chưa phải hệ thống an toàn để điều khiển phanh. Việc tạm gác điện thoại giải phóng đáng kể ngân sách RAM, tải model và GPU, nhưng không xóa được tính bất định căn bản của camera đơn: cùng một ảnh 2D có thể tương ứng với nhiều kích thước và khoảng cách 3D.

RoboEye hiện chưa hiện số mét vì **hai hệ thống chưa được nối với nhau**:

1. Trang DriveSense sản phẩm đang phát hiện và tracking xe, nhưng chỉ gọi bộ hình học mặt đường khi có `CameraProfile`. Không có profile, code cố ý trả về “Chưa hiệu chuẩn”.
2. TIP44 đã chạy thật hai model metric-depth trong browser, nhưng chúng nằm trong phòng đo riêng. Đầu ra chưa được ghép với track/bounding box của DriveSense.

Đây không phải lỗi nhận diện xe và cũng không chứng minh máy tính thiếu hiệu năng. DA2 Metric đã đo được P95 request→result **40,9 ms** sau warmup trên WebGPU của máy đang phát triển, còn MoGe-2 Small là **112,3 ms**, cùng tensor 224×280. Tuy nhiên accuracy vật lý vẫn `null`, đầu vào thử DA2 hiện là fixture dọc, và detector RT-DETR hiện phải fallback WASM: trên clip nội bộ, P95 detector khoảng **2.472 ms mỗi mẫu**. Vì vậy bản hiện tại có thể phân tích rồi phát lại, nhưng chưa thể gọi là realtime tổng pipeline.

Quyết định kỹ thuật nên là:

- **Tích hợp DA2 Metric Outdoor Small trước** để tạo phép đo learned-metric theo track xe trên desktop browser.
- **Giữ hình học mặt đường hiện có làm phép đo thứ hai**, không xóa nó. Khi có profile, hai phép đo kiểm tra chéo và hợp nhất theo sai số đã hiệu chuẩn; khi chưa có profile, hiển thị số AI với nhãn “ước lượng chưa hiệu chuẩn”, không tô màu “an toàn”.
- **Đưa Metric3D Small ONNX vào challenger** ngay sau DA2. Nó có canonical camera transform rõ, upstream liên kết bản ONNX Small; đây là đối chứng phù hợp hơn việc nhảy lên model hàng trăm triệu tham số.
- **Sửa detector trước khi tuyên bố realtime**: chạy graph tĩnh trực tiếp bằng ONNX Runtime WebGPU hoặc đổi graph/dtype đã đo được. Model card RT-DETR hiện có FP32, FP16 và graph quantized; lựa chọn phải dựa trên A/B accuracy–latency của chính clip, không dựa vào kích thước file.[^1]

## 1. Định nghĩa đúng thứ cần đo

“Khoảng cách tới xe” có ít nhất ba nghĩa khác nhau:

| Đại lượng | Ý nghĩa | Nguồn phù hợp |
| --- | --- | --- |
| `surface_z_m` | Độ sâu theo trục quang từ camera tới bề mặt xe nhìn thấy | Dense metric depth trong vùng xe |
| `ground_forward_m` | Khoảng tiến dọc mặt đường tới điểm tiếp xúc của xe | Intrinsics + cao/pitch camera + điểm chân xe |
| `clearance_m` | Khoảng hở từ cản trước xe mình tới bề mặt gần nhất xe trước | Hai đại lượng trên + vị trí camera so với cản xe |

Nhãn sản phẩm nên mặc định là **khoảng cách dọc ước lượng từ camera tới xe**. Chỉ gọi là “khoảng hở cản xe” sau khi đã có offset vị trí camera và kiểm chứng riêng. Không dùng khoảng cách Euclid theo tia nhìn thay cho khoảng cách dọc mà không ghi rõ.

Dense depth và công thức mặt đường không hoàn toàn độc lập: cả hai nhìn cùng ảnh và đều chịu ảnh hưởng camera. Tuy vậy, chúng có kiểu lỗi khác nhau. Depth model dễ sai scale theo domain, phản xạ kính/xe và vật thể nhỏ; hình học mặt đường dễ sai do pitch, dốc và điểm đáy box không đúng lốp. Sự không nhất quán giữa chúng là tín hiệu quan trọng để **abstain**.

## 2. Điều máy tính thay đổi — và điều không thay đổi

Desktop cho phép dùng WebGPU, model 100–200 MB, bộ nhớ lớn hơn, chạy worker dài và UI rộng. ONNX Runtime Web hỗ trợ WebGPU trực tiếp, graph capture cho graph tĩnh phù hợp, và I/O binding để giảm sao chép CPU↔GPU; tài liệu cũng cảnh báo graph capture không hoạt động với mọi graph và cần kiểm tra kernel/shape thực.[^2]

Nhưng máy tính không tự tạo ground truth hay tiêu cự. Nếu browser không có metadata focal đáng tin, DA3 Metric và Metric3D vẫn cần focal/canonical transform; mặt đường vẫn cần cao/pitch. Đổi phần cứng không biến output đã scale-align trong paper thành mét thô.

Hai mức sản phẩm cần tách:

- **Phân tích video trên máy tính:** khả thi sớm. Giải mã, detector và depth chạy lần lượt, lưu sample đúng timestamp rồi replay; không gọi là realtime.
- **Camera trực tiếp trên máy tính:** khả thi có điều kiện, nhưng phải đưa detector từ P95 ~2,47 giây xuống ngân sách nhỏ hơn 150–200 ms và đo tổng pipeline. Depth 41 ms riêng lẻ chưa đủ chứng minh điều này.

## 3. Sàng lọc open source

### 3.1 Nhóm triển khai ngay

| Ứng viên | Bằng chứng hữu ích | Quyết định |
| --- | --- | --- |
| **DA2 Metric Outdoor Small** | 24,8M tham số, fine-tune Virtual KITTI, checkpoint Small ghi Apache-2.0; graph RoboEye đã có parity browser/native và 40,9 ms P95 ở fixture hiện tại.[^3] | **Primary v1.** Export graph ngang giữ aspect ratio, benchmark trực tiếp video; không dùng graph fixture dọc hiện tại cho sản phẩm. |
| **Metric3D v2 Small ONNX** | Upstream liên kết ONNX ViT-Small/RAFT-4; hậu xử lý tham chiếu scale intrinsics theo resize, bỏ pad rồi nhân `focal/1000`; code upstream BSD-2-Clause.[^4] | **Challenger v1.** Giá trị lớn nhất là hợp đồng camera rõ và dữ liệu đa domain; cần kiểm provenance/license chính xác của graph cộng đồng và benchmark browser. |
| **MoGe-2 Small** | Point map/depth/normal/FoV; ONNX chính thức nhưng chỉ forward, hậu xử lý focal/shift bắt buộc. RoboEye đã triển khai hậu xử lý và đo 112,3 ms.[^5] | **Calibration/geometry challenger.** Không primary về tốc độ, nhưng hữu ích để bootstrap FoV/ground normal và đối chiếu DA2. |
| **Hình học mặt đường RoboEye** | Code hiện có Brown–Conrady, ray-plane, propagation sai số và fit cao/pitch với fit/check tách biệt. | **Giữ trong production.** Đây là cue nhẹ, giải thích được; chỉ hoạt động khi có profile và giả thiết mặt đường hợp lệ. |

DA2 được chọn đầu tiên không có nghĩa nó chính xác nhất. Nó chỉ là lựa chọn có đường tích hợp ngắn nhất và bằng chứng latency browser thật duy nhất ngoài MoGe trong codebase này. Kết quả số mét chưa có ground truth nên không được dùng để xếp hạng accuracy.

### 3.2 Nhóm lấy ý tưởng hoặc để phase sau

**GVDepth** là thiết kế gần bài toán nhất: mô hình hóa hai cue kích thước vật thể và vị trí dọc ảnh, dự đoán uncertainty cho từng cue rồi probabilistic fusion. Nghiên cứu báo cáo khả năng thích nghi resolution và camera setup trên nhiều bộ dữ liệu lái xe.[^6] Tuy nhiên repo công khai được kiểm tra hiện chỉ chứa website/README/assets, không có implementation/weights đủ để tích hợp. Quan trọng hơn, phần hiệu chuẩn cao/pitch trong paper dùng **ground-truth depth maps và road segmentation**, nên không thể trích Algorithm 1 rồi gọi là auto-calibration RGB-only.[^7]

**Metric Video Depth Anything Small** có 28,4M tham số, checkpoint metric Small và hỗ trợ streaming metric; model card Small ghi Apache-2.0.[^8] Đây là nhánh tốt để giảm flicker sau khi ảnh đơn chạy đúng. Chế độ streaming được upstream gắn experimental và tự báo giảm chất lượng so với offline trong ví dụ của họ; cache temporal và graph export browser chưa sẵn trong RoboEye. Không nên dùng nó để trì hoãn phép đo tĩnh đúng.

**GeoCalib** ước lượng intrinsics và gravity từ ảnh, hỗ trợ pinhole/radial và shared intrinsics qua nhiều ảnh; code Apache-2.0, weights CC BY 4.0.[^9] Nó phù hợp cho wizard tạo **profile nháp một lần**, không phải dense depth từng frame. Principal point hiện được giả định ở giữa và không tối ưu, camera height vẫn cần nguồn khác.

**FUMET** chứng minh một hướng huấn luyện metric scale từ dashcam video, nhưng quy trình công khai cần mask xe và chiều cao ước lượng, CUDA/Python và dữ liệu huấn luyện.[^10] Đây là chiến lược fine-tune sau khi thu dữ liệu, không phải package browser cắm vào ngay.

### 3.3 Không chọn làm đường chính lúc này

- **DA3 Metric Large:** 0,35B tham số; output cần `focal × output / 300`. Graph lớn và focal bắt buộc khiến nó không thắng đường tích hợp desktop-browser hiện tại.[^11]
- **MetricAnything:** point-map student 326M, depth-map student 876,66M; pointmap model card Apache-2.0, nhưng nặng hơn rõ so với DA2/MoGe. Depth-map còn yêu cầu focal. Giữ làm offline quality ceiling/challenger tương lai.[^12]
- **UniDepthV2:** metric depth, camera, confidence và ONNX support hấp dẫn, nhưng repo/weights CC BY-NC 4.0; không là mặc định cho hướng sản phẩm thương mại.[^13]
- **FlashDepth:** công bố streaming nhanh ở 2K trên A100, môi trường CUDA/Torch; đánh giá paper scale+shift-align cả sequence với ground truth. Nó rất có giá trị về temporal architecture, nhưng không phải bằng chứng raw metric hoặc browser desktop.[^14]
- **GARD:** geometry nhanh nhưng dành cho camera roadside cố định, đòi intrinsics hiệu chuẩn và chiều cao lắp; không chuyển thẳng sang dashcam xe đang chạy.[^15]
- **YOLO depth:** benchmark được khảo sát có alignment; không dùng điểm đó để hứa số mét zero-shot. Có thể nghiên cứu detector YOLO riêng, nhưng nghĩa vụ AGPL/phương án license phải được xử lý trước.
- **MoGe-3:** upstream ghi macOS không được hỗ trợ vì FlexGEMM/Triton; 370M tham số ở nhánh nhỏ được liệt kê. Không phải drop-in cho browser Mac hiện tại.[^5]

## 4. Kiến trúc sản phẩm đề xuất

```text
VideoFrame + timestamp
        │
        ├── Detector tần số thấp ──► VehicleTracker ──► box + ID
        │
        └── Metric depth tần số riêng ──► depth Z + valid mask
                                            │
box + depth cùng timestamp ──► robust vehicle ROI ──► z_model, sigma_model
box + CameraProfile ─────────► ground ray ──────────► z_ground, sigma_ground
                                            │
                                  gate + uncertainty fusion
                                            │
                               track state [z, dz/dt, age]
                                            │
                              label mét / không đủ tin cậy
```

### 4.1 Tiền xử lý chung

Mỗi frame chỉ resize/color-convert một lần cho mỗi resolution cần thiết. Cần khóa bằng fixture: RGB/BGR, range 0–1, normalize, letterbox, vị trí padding, orientation, mirror, focal/cx/cy sau resize. Graph DA2 hiện tại 224×280 dọc phải được export lại thành input ngang tĩnh, ví dụ một hoặc hai candidate resolution; **không kéo dãn video ngang vào graph dọc**.

Detector và depth không nên chạy đồng thời vô điều kiện trên cùng WebGPU. Một scheduler latest-frame-only phân bổ GPU: detector 5–10 Hz, depth 8–15 Hz theo số đo, tracker/render 60 Hz. Frame cũ bị bỏ trước inference; output luôn kèm source epoch, media timestamp, capture timestamp và model revision.

### 4.2 Lấy depth của đúng xe

Không đọc một pixel giữa box và không median toàn box. Box chứa kính, nền, đường, xe bên cạnh và vùng bị che. Adapter nên:

1. Ánh xạ box về depth map đúng letterbox.
2. Co box theo cạnh; tạo vùng lõi ở thân xe, loại dải sát biên và dải dưới box có nguy cơ là đường.
3. Bỏ pixel mask invalid, depth gradient lớn và outlier theo median/MAD.
4. Tách histogram/cluster depth; ưu tiên cluster có support liên tục quanh lõi track, không mặc định chọn pixel gần nhất.
5. Trả `coverage`, dispersion, boundary contamination và `z_model`; nếu support thấp thì trả null.

Ở xe bị cắt biên hoặc bị che, track có thể giữ ID nhưng phép đo phải mất hiệu lực. Không dùng smoothing để biến null thành số hiện tại.

### 4.3 Cue mặt đường và hợp nhất

`z_ground` lấy ray qua điểm tiếp xúc ước lượng, với profile camera và mô hình road plane. Điểm đáy bounding box chỉ là proxy; phase kế tiếp nên thêm tire/contact anchor hoặc road segmentation nhẹ. Trên dốc/cầu, plane cần cập nhật cục bộ hoặc cue này giảm trọng số.

Khi cả hai nguồn có số:

- Chuẩn hóa về cùng trục Z và cùng gốc camera.
- Kiểm `|log(z_model/z_ground)|` và interval giao nhau.
- Nếu bất đồng lớn: trả “chưa đủ tin cậy”, ghi lý do; không trung bình cưỡng bức.
- Nếu đồng thuận: fuse theo inverse variance **chỉ sau khi** variance đã được hiệu chuẩn trên holdout. Trước đó dùng rule-based conservative fusion và ghi `intervalCalibrated=false`.

Khi chỉ có depth model, có thể hiển thị `≈ x m · AI chưa hiệu chuẩn`; khi chỉ có geometry nhưng profile được xác nhận, hiển thị `≈ x m · hình học`; khi cả hai đồng thuận, hiển thị `≈ x m · đối chiếu kép`. Màu xám cho unknown. Chưa dùng xanh như bảo đảm an toàn.

### 4.4 Theo thời gian

Tracking không chỉ làm box mượt; nó nối measurement đúng vật thể. State tối thiểu `[z, v_z]` với timestamp measurement, update Kalman/alpha-beta theo covariance nguồn. Render có thể extrapolate rất ngắn theo `v_z`, nhưng nhãn quá 200 ms phải chuyển stale. Track đổi ID, cut-in hoặc occlusion dài phải reset covariance.

TTC chỉ thêm sau khi `v_z` được kiểm chứng. Công thức `TTC = -z/v_z` không đáng tin khi camera pitch thay đổi, xe rẽ hoặc depth scale nhảy. Cảnh báo màu phải dùng range + closing speed + uncertainty, không chỉ một ngưỡng khoảng cách cố định.

## 5. Kế hoạch triển khai không vòng vo

### Phase D45-A — có số mét đúng hợp đồng trên video desktop

1. Export DA2 Metric Outdoor Small graph **landscape static**, giữ aspect ratio; pin source revision/hash/input/output/license.
2. So native PyTorch ↔ native ONNX ↔ browser WebGPU trên tối thiểu 10 ảnh ngang, kiểm toàn depth map và phép lấy ROI xe.
3. Nối depth worker vào sample loop DriveSense. Mỗi sample lưu depth timestamp; detector box chỉ nhận depth cùng frame/tolerance đã khóa.
4. Thêm robust ROI estimator và nhãn `AI chưa hiệu chuẩn`; không bật cảnh báo màu.
5. Video file vẫn chạy analysis→replay nếu detector chưa realtime. Đây là đầu ra sản phẩm hữu ích, có số mét thật từ model, nhưng UI phải ghi rõ chế độ.

Điều kiện qua A: mọi xe hợp lệ có `distanceM` hoặc lý do null; report không còn null hàng loạt do wiring; số không tồn tại khi stale/mismatch; cùng frame cho kết quả lặp ổn định; không kéo dãn ảnh.

### Phase D45-B — đối chứng model và tối ưu detector

1. Port Metric3D Small ONNX với de-canonical transform đúng focal/resize/pad.
2. A/B DA2 và Metric3D trên cùng crop/track/ground truth, không scale-align theo test.
3. Tách pipeline RT-DETR khỏi abstraction lỗi WebGPU hiện tại: graph static + direct ORT WebGPU, profile per-op, thử FP32/FP16/INT8 **từng graph**. Chọn model theo accuracy và age, không theo dung lượng.
4. Scheduler một GPU queue; đo cold load, warm P50/P95, memory, dropped frames và 20 phút.

Điều kiện realtime desktop ban đầu: P95 tuổi perception khi render ≤200 ms; ít nhất 10 update perception/s trên cấu hình được công bố; không hàng đợi tăng; không device loss/memory leak. Nếu detector vẫn không đạt, sản phẩm chỉ công bố “phân tích video”, không đổi tên replay thành live.

### Phase D45-C — fusion, calibration UX và temporal

1. Wizard profile: resolution/lens cố định, focal/FoV draft, camera height đo một lần, pitch draft từ horizon/ground rồi người dùng xác nhận.
2. Thu 6+ mốc fit và 2+ mốc holdout như code hiện có; thêm cảnh báo crop/EIS/lens change.
3. Ground/depth agreement gate, uncertainty logging, track filter và cut-in reset.
4. Sau khi ảnh đơn ổn định mới thử VDA Metric Small hoặc temporal student; chấm flicker và delay, không chỉ ảnh đẹp.

### Phase D45-D — nghiệm thu có ground truth

Tập tĩnh kiểm soát: xe tại 5, 10, 15, 20, 30 và 40 m, nhiều loại xe/vị trí ảnh; laser rangefinder hoặc phép đo độc lập. Tập động cần tham chiếu đồng bộ như radar/LiDAR/RTK phù hợp; thước ở vài điểm tĩnh không chứng minh cut-in hay phanh.

Tách train/calibration/test theo **chuyến đi và camera**, không chia ngẫu nhiên frame liền nhau cùng clip. Báo theo từng dải: MAE, bias, P95 absolute/relative error, coverage, tỷ lệ ước lượng xa hơn thực tế, flicker, stale rate, latency. Không median-align/scale-align theo ground truth test. Model từ chối nhiều ca phải bị phạt coverage.

Mục tiêu R&D khởi đầu có thể giữ từ kiến trúc trước: ban ngày, gá cố định, 5–30 m, coverage ≥90%, P95 tuổi ≤200 ms, và ngưỡng sai số theo dải được khóa trước. Đây không phải chuẩn chứng nhận an toàn; cỡ mẫu và interval phải đi kèm.

## 6. Rủi ro và tiêu chí dừng

- Nếu DA2 và Metric3D cùng sai scale theo camera mới, không tăng smoothing. Kiểm focal/crop/domain và dùng mốc/profile.
- Nếu geometry và depth thường mâu thuẫn trên dốc, cần local road plane/IMU; không nới gate để tăng coverage giả.
- Nếu WebGPU detector không thể đạt age budget trên cấu hình mục tiêu, giữ offline analysis hoặc chọn detector nhỏ hơn với license rõ. Không gọi WASM 2,47 giây là realtime.
- Nếu tập holdout không đạt sai số/false-safe, sản phẩm chỉ hiển thị thứ tự gần–xa/ước lượng phân tích, không bật cảnh báo nguy hiểm.
- Hai advisory `sharp` trong dependency tree hiện vẫn chặn release. Không nới allowlist để phát hành; xử lý upgrade/compatibility ở task riêng.

## 7. Quyết định cuối

**Khả thi để tiếp tục và đáng đầu tư**, với desktop browser là nền tảng đầu tiên. Đường ngắn nhất không phải đi tìm thêm một model “SOTA” rồi thay toàn bộ: đó là nối DA2 đã chạy thật vào track xe, thêm ROI estimator, giữ geometry hiện có, rồi A/B Metric3D và tối ưu detector WebGPU. Kiến trúc fusion lấy cảm hứng từ GVDepth, nhưng implementation phải do RoboEye sở hữu vì upstream chưa cung cấp drop-in code/weights.

Kết quả mong đợi sau D45-A là video desktop có box/ID và số `≈m` kèm nguồn/chất lượng, report lưu được timestamp và lý do abstain. Sau D45-B mới quyết định có thể công bố “camera trực tiếp”. Sau D45-D mới cân nhắc cảnh báo màu. Đây là cách biến PoC đang có thành một hệ đo có thể kiểm chứng, thay vì thêm nhãn mét chưa có cơ sở.

## Nguồn

Nguồn được kiểm tra ngày 14/09/2026. README/model card cùng nhóm tác giả không được coi là hai kiểm chứng độc lập. Bảng tốc độ do tác giả công bố giữ nguyên phần cứng/chế độ; số RoboEye được dẫn từ measurement artifact nội bộ. Raw snapshots, hash và claim registry nằm cùng thư mục báo cáo.

[^1]: ONNX Community, [RT-DETRv2 R18 ONNX model card](https://huggingface.co/onnx-community/rtdetr_v2_r18vd-ONNX) và [danh sách graph](https://huggingface.co/onnx-community/rtdetr_v2_r18vd-ONNX/tree/main/onnx).
[^2]: ONNX Runtime, [Using WebGPU](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html) và [Performance diagnosis](https://onnxruntime.ai/docs/tutorials/web/performance-diagnosis.html).
[^3]: Depth Anything, [DA2 metric-depth README](https://github.com/DepthAnything/Depth-Anything-V2/tree/main/metric_depth); RoboEye, [TIP44 measurements](/Users/os/Documents/Codex/2026-08-05/new-chat/roboeye-live/docs/measurements/tip44/README.md).
[^4]: Yin et al., [Metric3D repository/ONNX links](https://github.com/YvanYin/Metric3D) và [reference inference](https://github.com/YvanYin/Metric3D/blob/main/hubconf.py).
[^5]: Microsoft Research, [MoGe repository](https://github.com/microsoft/MoGe) và [ONNX contract](https://github.com/microsoft/MoGe/blob/main/docs/onnx.md).
[^6]: Koledić et al., [GVDepth project page](https://unizgfer-lamor.github.io/gvdepth/) và [paper](https://arxiv.org/abs/2412.06080).
[^7]: Koledić et al., [GVDepth supplementary calibration procedure](https://arxiv.org/html/2412.06080v2#Sx14).
[^8]: Depth Anything, [Video Depth Anything repository](https://github.com/DepthAnything/Video-Depth-Anything) và [Metric Small model card](https://huggingface.co/depth-anything/Metric-Video-Depth-Anything-Small).
[^9]: Veicht et al., [GeoCalib](https://github.com/cvg/GeoCalib).
[^10]: Kyoto Vision, [FUMET](https://github.com/kyotovision-public/fumet).
[^11]: ByteDance Seed, [Depth Anything 3](https://github.com/ByteDance-Seed/Depth-Anything-3).
[^12]: Ma et al., [MetricAnything](https://github.com/metric-anything/metric-anything) và [point-map model card](https://huggingface.co/yjh001/metricanything_student_pointmap).
[^13]: Piccinelli et al., [UniDepth](https://github.com/lpiccinelli-eth/UniDepth).
[^14]: Chou et al., [FlashDepth code](https://github.com/Eyeline-Labs/FlashDepth) và [ICCV 2025 paper](https://arxiv.org/abs/2504.07093).
[^15]: SonicAutoDrive, [GARD](https://github.com/SonicAutoDrive/GARD).
