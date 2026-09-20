# DriveSense: đo khoảng cách xe bằng camera đơn trong trình duyệt

Ngày chốt nguồn: **13/09/2026**. Phạm vi: xử lý trên thiết bị, trong trình duyệt **điện thoại và laptop**; camera trực tiếp hoặc video có sẵn. Không lấy backend GPU, ứng dụng native hay phân tích trước–phát lại làm phương án thay thế cho realtime.

## 1. Kết luận điều hành

**Có cơ sở kỹ thuật để phát triển tiếp, nhưng chưa có bằng chứng rằng một mô hình có sẵn đáp ứng đồng thời độ chính xác khoảng cách, độ trễ và tương thích trên cả hai nhóm thiết bị.** Quyết định phù hợp là một đợt thử nghiệm kỹ thuật có cổng loại rõ ràng, không tích hợp ngay một mô hình lớn vào giao diện rồi gọi đó là sản phẩm hoàn chỉnh.

Ba thay đổi nền tảng cần thực hiện:

1. **Từ “bắt người dùng nhập đủ thông số mới có mét” sang hai mức đo.** Mức tự động dùng mô hình học thang đo và ước lượng camera; mức được kiểm chứng bổ sung profile hoặc mốc đo độc lập. Kết quả tự động vẫn là ước lượng, không được trình bày như số đo đã hiệu chuẩn.
2. **Từ một công thức đáy bounding box sang hệ đo kết hợp.** Nhận diện xe, xác định vùng bề mặt/điểm tiếp xúc, độ sâu có thang mét, hình học mặt đường, theo dõi thời gian và đánh giá chất lượng phải là các thành phần riêng.
3. **Từ “video mượt” sang “thông tin đủ mới”.** Độ trễ đầu-cuối, tuổi quan sát, tần suất đo mới và sai số theo từng xe mới là chỉ số quyết định; nội suy khung ở 60 FPS không biến phép đo chậm thành realtime.

**Ứng viên thử trước:** MoGe-2 ViT-S Normal và Depth Anything V2 Metric VKITTI Small. **Ứng viên giai đoạn sau:** Metric Video Depth Anything Small chạy streaming. YOLO26-Depth là nhánh đối chứng tốc độ có điều kiện giấy phép và cần đánh giá lại số mét không căn chỉnh bằng đáp án. Đây là lựa chọn nghiên cứu, chưa phải xếp hạng thắng cuộc.[^1][^2][^3][^4]

## 2. Hiện trạng và nguyên nhân thiếu khoảng cách

Báo cáo TIP43 trong codebase ghi nhận lỗi giải mã RT-DETR đã được sửa trong phạm vi DriveSense, xử lý trùng nhãn và thời hạn giữ chứng cứ đã được kiểm tra. Tuy vậy, lần thử video thực cuối cùng vẫn mất **235.465 ms để phân tích 99 mẫu**, P95 capture-to-result **2.471,6 ms**; profile rỗng và không có khoảng cách mét. Những số này là số liệu của báo cáo thử trước, không phải phép đo mới trong đợt nghiên cứu này.[^20]

Điều đó chỉ ra ba vấn đề khác nhau, không thể sửa bằng một ngưỡng confidence:

| Vấn đề | Bản chất | Cách kiểm chứng cần có |
| --- | --- | --- |
| Biển báo bị nhận thành xe | Lỗi hợp đồng giải mã đã tìm thấy; ngoài ra vẫn có sai số mô hình/dữ liệu | Golden tensor, nhãn xe/biển báo độc lập, precision và recall |
| Nhận được xe nhưng không có mét | Pipeline đang phụ thuộc hiệu chuẩn hình học; chưa có nhánh metric-depth tự động | Kiểm tra hợp đồng độ sâu và thử trên khoảng cách đo thật |
| Khung có vẻ chuyển động nhưng dữ liệu cũ | Phân tích/replay và chi phí suy luận quá cao | Đồng hồ frame, hàng đợi, tuổi kết quả, phép đo thiết bị đích |

**Đính chính về giới hạn kỹ thuật:** thiếu hiệu chuẩn thủ công không đồng nghĩa không thể ước lượng mét. MoGe-2 và Depth Pro có cách suy ra hình học/thang đo từ ảnh; chúng dùng tri thức đã học về thế giới. Tuy nhiên “ước lượng theo mét” không đồng nghĩa “đã biết chính xác kích thước thế giới của cảnh đang quay”.[^1][^7]

## 3. Phải định nghĩa đúng số mét đang hiển thị

### 3.1 Bốn đại lượng không được đánh đồng

- **Độ sâu Z:** khoảng cách dọc trục quang học tới bề mặt nhìn thấy.
- **Khoảng cách Euclid:** độ dài từ tâm camera tới một điểm 3D.
- **Khoảng cách trên mặt đường:** thành phần nằm trên mặt đường tới vị trí xe.
- **Khoảng hở giữa hai xe:** từ phần đầu xe chủ tới phần xe phía trước; cần biết camera nằm lùi sau đầu xe bao nhiêu và bề mặt mục tiêu nào đang được đo.

Xe ở bên cạnh hoặc đang vượt có chênh lệch lớn giữa các đại lượng trên. Không được gắn nhãn “khoảng cách an toàn phía trước” cho mọi vật xuất hiện trong hình. Đề xuất ban đầu hiển thị **“≈ … m tới xe — ước lượng camera”**; chỉ chuyển sang khoảng hở đầu xe khi offset và hệ tọa độ đã được xác nhận.

### 3.2 Vì sao một camera không tự bảo đảm thang đo

Với hình chiếu phối cảnh, một cảnh và một camera cùng được phóng tỷ lệ có thể sinh ảnh giống nhau. Chuyển động camera đơn cũng không tự tạo mét nếu chưa có một thông tin thang đo độc lập. Mô hình metric-depth chọn một lời giải dựa trên dữ liệu đã học; nó có thể hữu ích, nhưng có thể lệch trên camera góc rộng, xe lạ, đường dốc hoặc cảnh chưa gặp.

Mốc độc lập có thể là chiều cao gá camera đã đo, profile intrinsics đúng chế độ quay, hay điểm ngoài thực địa có khoảng cách đã đo. Kích thước “xe thường rộng 1,8 m”, chiều rộng làn đường hoặc chiều cao camera đoán từ ảnh chỉ là **prior**, không phải ground truth.

### 3.3 Độ nhạy của hình học giải thích lỗi ở xa

Với camera lý tưởng, đường phẳng, đã xử lý tư thế và distortion, dạng gần đúng là:

`Z ≈ f × h / (v_contact − v_horizon)`

Ví dụ tính toán minh họa, không phải thông số video đang dùng: `f=800 px`, `h=1,4 m`, `Z=30 m` làm điểm tiếp xúc chỉ cách chân trời khoảng `37,3 px`. Lệch điểm tiếp xúc `2 px` gây sai số bậc nhất khoảng `1,6 m`. Lệch pitch `1°` có thể dịch chân trời khoảng `14 px`; gần chân trời, tác động rất lớn và phi tuyến.

Vì vậy, lọc cho box bớt rung không xử lý được sai lệch mặt đường, camera hoặc điểm tiếp xúc. Công thức giao tia–mặt phẳng vẫn là baseline tốt khi giả thiết đúng; nghiên cứu single-view geometry cũng phải đặt và kiểm tra các giả thiết hình học đó.[^18]

## 4. Những phương pháp đáng tích lũy, và giới hạn thực sự

Bảng dưới là tập ứng viên có chủ đích, không phải toàn bộ lĩnh vực. “Có ONNX” chỉ là điều kiện ban đầu, không phải chứng nhận chạy đúng hoặc nhanh trong browser.

| Phương án | Giá trị kỹ thuật | Hạn chế quyết định | Vị trí đề xuất |
| --- | --- | --- | --- |
| **MoGe-2 ViT-S Normal** | 35M tham số; point map, thang mét, normal và FoV; có ONNX chính thức; checkpoint MIT | ONNX thiếu hậu xử lý hình học; chưa đo browser/điện thoại | Ứng viên A, ưu tiên thử tính đúng và chi phí toàn pipeline |
| **DA2 Metric VKITTI Small** | 24,8M; checkpoint ngoài trời riêng, Apache-2.0 | Học từ dữ liệu tổng hợp; không nhầm với bản relative; giới hạn độ sâu của cấu hình | Ứng viên B, baseline đơn giản hơn |
| **Metric Video Depth Anything Small** | 28,4M; thông tin thời gian; checkpoint Apache-2.0 | Streaming còn experimental, có suy giảm; phải đưa cache vào graph/browser | Giai đoạn hai nếu A/B bị flicker đáng kể |
| **YOLO26-Depth** | ONNX, kiến trúc hướng tốc độ, có biến thể nano | Benchmark có scale/alignment; AGPL-3.0; chưa có kiểm chứng mét trên clip mới | Nhánh đối chứng có điều kiện |
| **MoGe-3** | Bản mới công bố 18/08/2026, cải thiện chi tiết hình học | Phụ thuộc FlexGEMM/Triton; bản nhỏ trong bảng vẫn 370M; không phải bản browser sẵn dùng | Đối chứng nghiên cứu, không đưa thẳng lên điện thoại |
| **UniDepthV2** | Metric-depth, camera, confidence; có ONNX support | CC BY-NC 4.0 theo repository; chi phí browser chưa biết | Đối chứng; không chọn mặc định cho sản phẩm thương mại |
| **Depth Pro** | Metric-depth không bắt buộc intrinsics; ước lượng tiêu cự | 0,3 giây công bố là trên GPU; giấy phép riêng của Apple | Đối chứng offline trong R&D |
| **DA3 Metric Large** | Metric model Apache-2.0 | 0,35B; quy đổi mét còn cần focal; DA3 Small không thay thế trực tiếp | Đối chứng khi có intrinsics |
| **GeoCalib** | Suy intrinsics và trọng lực từ ảnh bằng học máy + tối ưu hình học | Không đo chiều cao camera; trọng lực không phải pháp tuyến mọi con dốc | Bootstrap tùy chọn nếu thử nghiệm chứng minh có ích |
| **Online camera-to-ground** | Cập nhật quan hệ camera–đường, giải quyết pitch/độ cao thay đổi | Công trình được khảo sát dùng wheel odometry | Tích lũy phương pháp; không mặc định có đầu vào trên web |

Nguồn cho từng hàng: MoGe/MoGe ONNX/model card[^1][^2]; DA2[^3]; VDA[^4]; YOLO26[^5]; UniDepth[^6]; Depth Pro[^7]; DA3[^8]; GeoCalib[^9]; camera-to-ground[^10].

### 4.1 Bẫy tích hợp quan trọng: MoGe ONNX chưa xuất “mét hoàn chỉnh”

Tài liệu chính thức nói graph ONNX chỉ gồm forward pass. Focal/shift recovery và reprojection nằm ngoài graph. Mã tham chiếu sau đó khôi phục camera, dịch trục Z, áp metric scale và loại vùng không hợp lệ.[^2][^21]

Điều kiện đưa MoGe vào sản phẩm phải gồm: cùng ảnh đầu vào, cùng resize/token budget, cùng đầu ra trung gian, so hậu xử lý TypeScript/WASM với tham chiếu, kiểm thử mask/NaN/Infinity. Không lấy trực tiếp kênh Z của raw point map rồi thêm hậu tố “m”. Không được min–max normalize depth để tạo ảnh đẹp rồi dùng dữ liệu đó làm khoảng cách.

### 4.2 Bẫy benchmark: nhanh và chính xác ở chế độ khác

**YOLO26-Depth:** tài liệu depth công bố tốc độ trên TensorRT/T4 và ONNX CPU Xeon, không phải WebGPU điện thoại. Một số chỉ số có TTA và log-least-squares alignment; validator single-scale lại dùng median alignment. Trang KITTI còn ghi trọng số phát hành từng được huấn luyện với split cũ chứa 72 frame thuộc tập test hiện tại. Vì vậy không dùng bảng đó để tuyên bố khả năng đo mét zero-shot trên đường mới.[^5][^11]

**Video Depth Anything:** số tốc độ/bộ nhớ được đo trên A100 với đầu vào nhiều frame; streaming một frame sử dụng trạng thái quá khứ là chế độ khác và tác giả ghi nhận giảm chất lượng. Không chuyển số GPU đó thành FPS iPhone/Android; phải đo causal streaming thực, không dùng frame tương lai.[^4]

**DA3 Metric Large:** công thức chính thức là `metric_depth = focal × net_output / 300`. Có chữ “metric” trong tên không có nghĩa bỏ qua hợp đồng tiêu cự; bản DA3 Small thuộc dòng khác.[^8]

### 4.3 “Tự hiệu chuẩn” cần tách thành ba phần

1. **Intrinsics/FoV/distortion:** từ metadata nếu đáng tin, model camera như GeoCalib, hoặc profile đo sẵn.
2. **Tư thế camera so với mặt đường:** cập nhật bằng vùng đường và hình học nhiều frame; không đồng nhất với gravity khi xe lên/xuống dốc.
3. **Thang mét:** prior học được hoặc mốc đo thật. Một công trình “targetless” vẫn có thể cần wheel odometry; không được bỏ qua điều kiện đó khi áp dụng.[^9][^10]

Thiết kế UX phù hợp là khởi động tự động trước, rồi cung cấp **hiệu chuẩn nhanh để cải thiện/kiểm chứng**, không yêu cầu mọi người tự điền ma trận camera. Điện thoại có thể đổi lens, crop, chống rung điện tử; bất kỳ thay đổi ảnh hưởng phép chiếu nào phải làm profile hết hiệu lực hoặc kích hoạt kiểm tra lại. Các trường hợp này cần được kiểm thử theo thiết bị, không dựa vào giả định tên camera.

## 5. Kiến trúc khả thi nhất dưới ràng buộc browser-only

Phần này là **đề xuất kỹ thuật**, chưa phải kết quả thực nghiệm.

```text
Camera / video → frame + timestamp + phép biến đổi ảnh
                         │
                Bộ lập lịch: frame mới nhất
                 ┌───────┴────────┐
                 │                │
          Detector xe nhỏ    Metric-depth nhỏ
          + vùng mục tiêu    + hình học camera
                 │                │
                 └───────┬────────┘
                         │
            Gắn ID + đồng bộ về cùng thời điểm
                         │
        Ước lượng mặt đường / mốc thang đo tùy chọn
                         │
          Bộ ước lượng khoảng cách + độ bất định
                         │
           Box + nhãn mét + tuổi dữ liệu + trạng thái
```

### 5.1 Nhánh nhận diện không được chiếm hết ngân sách

Dùng detector nhỏ làm baseline ngân sách, rồi chấm riêng khả năng nhìn xe nhỏ/xe vừa vượt. YOLOX-Nano là một baseline công khai nhỏ có hướng xuất ONNX; không phải mặc định detector tốt nhất hiện nay. Độ chính xác phải so với RT-DETR đã giải mã đúng trên cùng dữ liệu, và bổ sung hard negatives biển báo, trụ, đuôi xe xa, phản chiếu.[^19]

Không chạy đồng thời thêm segmentation lớn mặc định. Thử trước vùng mục tiêu co vào trong box và phân cụm depth có kiểm soát; nếu vẫn lẫn nền, chi phí mask/segmentation phải vào benchmark. Không lấy trung vị cả box vì box chứa đường, cửa kính và xe khác; cũng không lấy pixel nhỏ nhất vì nhiễu có thể tạo khoảng cách cực gần giả.

Không loại cứng mọi box trên đường chân trời hoặc ngoài làn hiện tại: thao tác đó có thể làm mất xe trên dốc hoặc xe đang cắt vào. Tình huống chưa chắc phải giảm chất lượng/khoảng phủ, không giả vờ không có xe.

### 5.2 Nhánh khoảng cách và hợp nhất

- Lấy cụm bề mặt thuộc xe để ước lượng khoảng cách tới phần xe nhìn thấy. Định nghĩa rõ vùng được đo và cách xử lý che khuất/cắt mép hình.
- Ước lượng mặt đường cục bộ bằng điểm thuộc đường và robust fitting; loại bóng, vỉa hè, nắp capo, gầm cầu. Chấp nhận mặt phẳng chỉ khi residual và phạm vi hỗ trợ đạt yêu cầu.
- Giao tia–mặt đường chỉ tạo mét độc lập khi có thang đo đáng tin. Nếu cả mặt đường và thang đo đều lấy từ cùng model depth, sự đồng thuận **không phải chứng cứ độc lập**.
- Theo dõi khoảng cách/vận tốc tương đối với bộ lọc trạng thái có timestamp, phát hiện thay đổi đột ngột và reset khi đổi ID. Lọc giảm rung không được tạo trễ dài hoặc làm chậm phản ứng với xe cắt vào.
- Hai nhánh bất đồng lớn: nới khoảng bất định hoặc dừng công bố số; không lấy trung bình để che bất đồng. Chỉ dùng trọng số theo phương sai sau khi đã hiệu chỉnh và đánh giá tương quan lỗi; có thể so với covariance intersection khi tương quan chưa biết.

Không cần chạy hai backbone depth đồng thời trong sản phẩm. A/B là thử nghiệm để chọn một; mô hình lớn chỉ dùng làm đối chứng R&D. Ground truth vẫn phải là phép đo độc lập, không phải dự đoán của mô hình lớn.

### 5.3 Hiệu chuẩn nhanh đề xuất

**Tự động:** thu một chuỗi ngắn khi camera gá ổn định; ước lượng FoV và độ sâu, kiểm tra độ ổn định, bắt đầu chế độ “ước lượng”. Nếu dùng MoGe đã có camera recovery, chỉ thêm GeoCalib khi chứng minh cải thiện đủ bù chi phí.

**Có mốc:** chọn profile đúng lens/chế độ quay; hoặc nhập chiều cao gá đã đo, đánh dấu vùng đường phù hợp; hoặc gán các mốc khoảng cách thực. Một mốc có thể sửa scale đơn giản nhưng không xác định đồng thời focal, pitch, distortion và mọi hệ số phi tuyến. Với mô hình hiệu chỉnh hai tham số cần nhiều mốc tách biệt về khoảng cách và một tập kiểm chứng không dùng để fit.

**Theo dõi hiệu lực:** kiểm tra crop/zoom/orientation, độ lệch mặt đường, độ ổn định camera. Khi mất điều kiện: quay về trạng thái ước lượng hoặc không đủ dữ liệu; không giữ badge “đã hiệu chuẩn” vĩnh viễn.

### 5.4 Realtime: lập lịch trước, tăng FPS sau

Chỉ giữ frame mới nhất đang chờ; không tích hàng đợi để xử lý dần. Gắn kết quả với frame nguồn và phép biến đổi ảnh nguồn. Detector và depth không được kết hợp từ hai thời điểm khác nhau như thể cùng một ảnh. Nếu dùng dự đoán chuyển động để đưa box về thời điểm hiển thị, phải ghi rõ tuổi phép đo thật và tăng bất định.

Dùng callback theo frame video để tránh suy luận lặp trên cùng frame, nhưng callback không tự bảo đảm độ trễ bằng không. Timestamp hiển thị, timestamp video và thời điểm hoàn thành cần tách biệt; với camera cục bộ, thời điểm cảm biến thật không phải lúc nào cũng có trong API. Muốn biết sensor-to-screen cần phép đo ngoài bằng đồng hồ/đèn và ghi hình kiểm chứng.[^15]

ONNX Runtime Web có hướng giữ tensor trên GPU và graph capture cho graph phù hợp. Tuy nhiên graph capture đòi hỏi điều kiện về shape và node chạy trên GPU; ONNX export động không tự đạt các điều kiện đó. Đề xuất thử shape tĩnh, token budget cố định, tiền xử lý GPU, chỉ đọc về các thống kê cần thiết; đo lợi ích thay vì mặc định mọi đường truyền là zero-copy.[^14]

WASM là fallback tính năng, **không phải cam kết realtime**. Khi không đạt ngưỡng độ mới, giao diện phải báo thiết bị không đạt chế độ realtime thay vì phát ra cảnh báo trễ. Không chạy nền nặng song song với RoboHand/AirSketch khi DriveSense đang cần GPU.

## 6. Điện thoại và laptop: API hỗ trợ chưa đủ

Safari 26 đã bổ sung WebGPU; Chrome công bố WebGPU Android từ Chrome 121 trên Android 12 trở lên với các GPU được nêu. Nhưng bảng hỗ trợ ONNX Runtime Web được thu thập vẫn đánh dấu Safari/iOS WebGPU chưa hỗ trợ. Đây là thông tin ở **hai tầng khác nhau**: trình duyệt có API không chứng minh model/runtime đã được thử đúng trên đó. Không loại Safari chỉ bằng bảng cũ, cũng không hứa chạy iPhone chỉ bằng tin WebGPU ra mắt.[^12][^13][^14]

Ma trận tối thiểu phải có thiết bị thật:

| Nhóm | Điều phải đo, không được suy từ nhóm khác |
| --- | --- |
| iPhone + Safari hỗ trợ WebGPU | Tạo session, đúng kết quả, bộ nhớ, camera, nóng máy, GPU device loss |
| Android tầm trung + Chrome | Operator support, độ trễ khi detector và depth dùng chung GPU, thermal throttling |
| Laptop Apple Silicon + Safari/Chrome | Sự khác biệt backend và trình duyệt, không lấy FPS desktop thay phone |
| Laptop Windows GPU tích hợp + Chrome/Edge | Precision, memory, hiệu suất không có GPU rời |

“Chạy trên cả điện thoại và laptop” phải dẫn tới danh sách cấu hình được kiểm chứng. Không thể đổi yêu cầu thành “chạy trên mọi điện thoại” khi chưa xác định phiên bản tối thiểu và ngân sách phần cứng. Toàn bộ suy luận vẫn trong browser; khác nhau ở chất lượng/resolution được phép, không chuyển âm thầm sang server.

## 7. Nghiệm thu bằng phép đo, không bằng ảnh chụp đẹp

### 7.1 Dataset và ground truth

KITTI cung cấp RGB, LiDAR và depth để làm đối chứng kỹ thuật, nhưng xếp hạng depth toàn ảnh không thay cho sai số khoảng cách từng xe trong điều kiện triển khai. Tập thử nội bộ phải tách theo camera, chuyến đi và cảnh; không lấy frame liền kề của cùng clip chia ngẫu nhiên train/test.[^16]

Tập kiểm chứng tối thiểu cần: biển báo cạnh đường; ba xe gần nhau; xe vừa vượt/cắt vào; xe tải/xe máy; xe bị che một phần; dốc, cầu, cua; bóng gắt; đêm/mưa; kính phản chiếu; rung và thay đổi crop. Chỉ triển khai phạm vi đã đạt, không tự suy rộng ban ngày đường phẳng sang mọi tình huống.

Mốc tĩnh có thể đo tại bãi kiểm soát. Đánh giá động cần tham chiếu đồng bộ thời gian phù hợp, ví dụ radar/LiDAR hoặc hệ đo vị trí được kiểm chứng; thước đo vài vị trí tĩnh không xác nhận sai số khi xe phanh/cắt vào. Việc thu dữ liệu không yêu cầu người lái thao tác màn hình trong giao thông thực.

### 7.2 Quy tắc chấm khoảng cách

**Không median-align, scale-align hay fit lại bằng ground truth của từng ảnh test.** Profile/mốc hiệu chỉnh phải được khóa trước khi chấm tập holdout. Báo riêng ba chế độ: tự động chưa có mốc; có mốc; oracle-calibration dùng cho phân tích lỗi, không gộp vào thành tích sản phẩm.

Chấm theo xe và theo dải `5–10`, `10–20`, `20–30`, `30–50 m`: MAE, bias, P95 sai số tuyệt đối/tương đối, tỷ lệ ước lượng xa hơn thực tế, tỷ lệ không ra số, flicker và độ trễ phản ứng. Báo **coverage cùng accuracy**: bỏ hết ca khó có thể làm sai số đẹp nhưng không thành sản phẩm hữu ích.

Không gán “độ tin cậy 95%” từ softmax/sigmoid detector. Khoảng bất định phải được kiểm tra coverage trên dữ liệu chưa dùng fit. Nếu chưa hiệu chỉnh được, ghi trạng thái chất lượng thay vì phần trăm giả chính xác.

### 7.3 Cổng kỹ thuật đề xuất — chưa đạt và không phải tiêu chuẩn an toàn

Các con số sau là **mục tiêu thử nghiệm ban đầu**, có thể điều chỉnh sau baseline; không phải số công bố của nguồn hay chứng nhận chống va chạm.

| Cổng | Tiêu chí đề xuất |
| --- | --- |
| Hợp đồng model | Python/reference và browser trùng quy ước hình học; FP32 parity trong dung sai được khóa; FP16/quantization chấm lại lỗi mét |
| Thông tin mới | Ít nhất 10 cập nhật perception/giây duy trì trên thiết bị được hỗ trợ; P95 tuổi quan sát tại lúc hiển thị ≤200 ms |
| Giao diện | P95 khoảng cách giữa hai lần render ≤33 ms; không dùng chỉ số này thay độ mới perception |
| Ổn định lâu | Chạy 20 phút không tràn bộ nhớ/device loss; chấm lại latency cuối phiên, không chỉ khi máy lạnh |
| Mét trong ODD ban đầu | Ban ngày, gá cố định, dải 5–30 m: P95 của `abs(error)/max(2 m, 0,15×distance)` ≤1; công bố riêng từng dải |
| Khoảng phủ | ≥90% quan sát xe hợp lệ trong ODD có ước lượng đúng thời hạn; bỏ số cũng phải được tính là bỏ sót |
| Xe và hard negatives | Mục tiêu precision ≥98%, recall ≥95% trên tập đã gán nhãn và quy định kích thước tối thiểu; báo riêng xe cắt vào và xe xa |

Phải công bố cỡ mẫu và khoảng tin cậy theo clip/chuyến đi, không xem các frame sát nhau là mẫu độc lập. Những mục tiêu này chỉ giúp quyết định tiếp tục R&D. Dù đạt, vẫn cần quy trình an toàn và đánh giá độc lập trước khi dùng như hệ cảnh báo hỗ trợ lái thật.

### 7.4 Cảnh báo màu đúng ý nghĩa

Màu diễn tả mức gần/đang tiếp cận theo policy được kiểm chứng; **màu xanh không phải “an toàn để lái”**. Thiếu mét hoặc dữ liệu quá cũ phải có trạng thái không xác định riêng. Không làm trơn hoặc giữ nhãn cũ để che mất phép đo.

TTC có thể bổ sung khi ước lượng closing speed đủ ổn định, nhưng không thể suy TTC tin cậy chỉ từ box phồng lên khi xe đang rẽ, camera pitch hoặc đối tượng đổi hướng. Các phương pháp phát triển hệ cảnh báo phải đánh giá false positives/false negatives và rủi ro ngoài độ đẹp của hình hiển thị; đây là nhánh sản phẩm cần kiểm định, không phải thêm một điều kiện màu.[^17]

## 8. Trình tự triển khai sau nghiên cứu

| Bước | Đầu ra bắt buộc | Điều kiện qua bước |
| --- | --- | --- |
| R0 — khóa bài đo | ODD, định nghĩa khoảng cách, timestamps, tập test và ground truth, baseline RT-DETR hiện tại | Đọc lại được số liệu; không lẫn replay với realtime |
| R1 — spike model độc lập | MoGe-2 Small đủ hậu xử lý; DA2 Metric Small đúng checkpoint; license/hash/input/output contract | Đúng số trước khi tối ưu; không sửa UI sản phẩm để che lỗi |
| R2 — so trực tiếp trên browser | Kết quả trên iPhone, Android, laptop; detector+depth chạy chung; latency/memory/thermal | Chọn ứng viên theo Pareto chất lượng–độ mới–bộ nhớ; không chọn bằng benchmark server |
| R3 — hệ đo kết hợp | Bootstrap, mốc hiệu chỉnh, mặt đường cục bộ, tracking thời gian, khoảng bất định | Ablation cho thấy mỗi thành phần cải thiện và không gây trễ quá mức |
| R4 — sản phẩm hóa trong ODD | UI tự động, trạng thái đo rõ, camera/video cùng pipeline, báo cáo lỗi đầy đủ | Cổng §7 đạt trên holdout và thiết bị đã khai báo |
| R5 — mở rộng | Streaming depth hoặc student nhỏ hơn; dữ liệu đêm/dốc/mưa; kiểm định ứng dụng lái | Chỉ mở phạm vi có bằng chứng mới |

Nếu A/B không đạt ngân sách điện thoại: thử token/resolution thấp hơn có chấm lại xe xa, precision phù hợp, rồi student đã fine-tune/distill bằng dữ liệu có quyền sử dụng. Không hứa quantization luôn nhanh hơn; kernel/precision trên từng GPU có thể khác. Nếu vẫn không đạt, phải công bố cấu hình tối thiểu hoặc thu hẹp ODD, không đổi sang phân tích trước rồi gọi realtime.

Để chống lặp lại lỗi giải mã trước đây, mỗi model adapter phải mang: ID/revision, SHA-256, license code/weights, kích thước ảnh, color space, normalization, tensor names/shapes, quy ước depth, hậu xử lý và fixture số. Kiểm tra thêm resize/letterbox/crop, intrinsics sau resize, rotate/mirror và lens distortion. Không tái sử dụng adapter chỉ vì hai model có cùng tên task.

## 9. Quyết định và điều chưa biết

**Quyết định đề xuất:** giữ mục tiêu browser-only; mở spike A/B MoGe-2 Small và DA2 Metric Small; chọn một nhánh depth cùng detector nhỏ sau đo thiết bị thật; thêm hình học có kiểm tra giả thiết, không coi nó là thước đo độc lập khi cùng phụ thuộc một nguồn depth. Hiệu chuẩn nhanh là tầng cải thiện và kiểm chứng, không phải rào cản bắt buộc để sản phẩm bắt đầu trả ước lượng.

**Chưa biết:** FPS/latency của từng graph trên điện thoại đích; sai số mét trên camera đang dùng; tác động lượng tử hóa; chi phí phục hồi camera của MoGe trong web; khả năng duy trì 20 phút; chất lượng xe cắt vào và đêm. Những ô này phải để trống cho đến khi đo, không được điền bằng số của paper.

**Giấy phép:** ưu tiên checkpoint MIT/Apache-2.0 nhưng vẫn kiểm tra code, weights và dữ liệu riêng. UniDepth BY-NC không phải mặc định cho thương mại; YOLO AGPL không đồng nghĩa cấm thương mại nhưng cần đáp ứng nghĩa vụ tương ứng hoặc thỏa thuận khác; Depth Pro có điều khoản riêng. Đây là bộ lọc kỹ thuật, không thay rà soát pháp lý trước phát hành.[^1][^3][^4][^6][^7][^22]

## Nguồn

Các nguồn trực tuyến dưới đây được kiểm tra ngày 13/09/2026. README/model card/paper cùng nhóm tác giả không được tính là nhiều phép kiểm chứng độc lập. Số liệu tự báo cáo được giữ nguyên phạm vi phần cứng/chế độ đánh giá. Tài liệu và nguồn lưu trong thư mục nghiên cứu không phải bằng chứng rằng model đã chạy trong RoboEye.

[^1]: Microsoft, [MoGe repository và bảng phiên bản](https://github.com/microsoft/MoGe); [model card MoGe-2 ViT-S Normal](https://huggingface.co/Ruicheng/moge-2-vits-normal). Dùng bảng 35M và license checkpoint, không suy tốc độ ViT-S từ số ViT-L.
[^2]: Microsoft, [MoGe ONNX Support](https://github.com/microsoft/MoGe/blob/main/docs/onnx.md). Giới hạn forward-only và hậu xử lý chưa export.
[^3]: Depth Anything, [Metric-depth README](https://github.com/DepthAnything/Depth-Anything-V2/tree/main/metric_depth); [checkpoint Metric VKITTI Small](https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-VKITTI-Small).
[^4]: Depth Anything, [Video Depth Anything](https://github.com/DepthAnything/Video-Depth-Anything); [Metric Small model card](https://huggingface.co/depth-anything/Metric-Video-Depth-Anything-Small).
[^5]: Ultralytics, [Depth task: inference, alignment và tốc độ](https://docs.ultralytics.com/tasks/depth/). Không dùng số đã alignment để kết luận độ chính xác mét zero-shot.
[^6]: Piccinelli et al., [UniDepth repository](https://github.com/lpiccinelli-eth/UniDepth); [UniDepthV2 paper](https://arxiv.org/abs/2502.20110).
[^7]: Apple, [Depth Pro](https://github.com/apple/ml-depth-pro); [LICENSE](https://github.com/apple/ml-depth-pro/blob/main/LICENSE).
[^8]: ByteDance Seed, [Depth Anything 3: model zoo và metric conversion](https://github.com/ByteDance-Seed/Depth-Anything-3).
[^9]: Veicht et al., [GeoCalib repository](https://github.com/cvg/GeoCalib); [ECCV 2024 paper](https://arxiv.org/abs/2409.06704).
[^10]: Li et al., [Online Camera-to-ground Calibration for Autonomous Driving](https://arxiv.org/abs/2303.17137), 2023 preprint. Abstract nêu wheel odometry và sliding-window factor graph.
[^11]: Ultralytics, [KITTI depth protocol và giới hạn split của weights](https://docs.ultralytics.com/datasets/depth/kitti/).
[^12]: WebKit, [WebKit Features in Safari 26.0](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/).
[^13]: Chrome for Developers, [What's New in WebGPU — Chrome 121](https://developer.chrome.com/blog/new-in-webgpu-121).
[^14]: ONNX Runtime, [Web support matrix](https://onnxruntime.ai/docs/get-started/with-javascript/web.html), [Using WebGPU](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html). Khác biệt với thông báo WebKit được giữ lại để buộc kiểm thử runtime thực.
[^15]: MDN, [HTMLVideoElement.requestVideoFrameCallback](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback).
[^16]: KITTI, [Depth Prediction Evaluation](https://www.cvlibs.net/datasets/kitti/eval_depth.php?benchmark=depth_prediction). Không dùng vị trí leaderboard thay thử nghiệm khoảng cách từng xe.
[^17]: comma.ai, [Bringing Forward Collision Warnings to our open source self-driving car](https://blog.comma.ai/bringing-forward-collision-warnings-to-our-open-source-self-driving-car/), 2018. Kinh nghiệm kiểm thử lịch sử của tác giả, không phải chứng nhận an toàn cho DriveSense.
[^18]: Ali et al., [Real-time vehicle distance estimation using single view geometry, WACV 2020](https://openaccess.thecvf.com/content_WACV_2020/papers/Ali_Real-time_vehicle_distance_estimation_using_single_view_geometry_WACV_2020_paper.pdf). Công thức minh họa trong §3 là phép tính phân tích, không phải benchmark của paper.
[^19]: Megvii, [YOLOX repository](https://github.com/Megvii-BaseDetection/YOLOX). Chỉ chọn làm baseline detector nhỏ, không khẳng định tối ưu hiện hành.
[^20]: Bằng chứng nội bộ: [COMPLETION-REPORT-TIP-43.md](/Users/os/Documents/Codex/2026-08-05/new-chat/roboeye-live/docs/COMPLETION-REPORT-TIP-43.md), phần Final real-video verification. Video riêng tư không được đưa vào bộ nguồn công khai.
[^21]: Microsoft, [MoGe v2 reference infer](https://github.com/microsoft/MoGe/blob/main/moge/model/v2.py), phục hồi focal/shift và áp metric_scale.
[^22]: Ultralytics, [LICENSE của repository](https://github.com/ultralytics/ultralytics/blob/main/LICENSE). Phải chốt nghĩa vụ code/weights theo phiên bản được chọn trước khi phân phối.
