# RoboEye Assist: rà soát kỹ thuật hiểu cảnh và không gian

13/11/2026 · Đợt 1 · **Nghiên cứu nguồn công khai, chưa tích hợp, chưa benchmark điện thoại.**

## Kết luận để ra quyết định

Không lấy một VLM đọc video liên tục làm kiến trúc mặc định. Làm **hỏi đáp tiếng Việt theo yêu cầu** trước, sau đó thêm một bộ nhớ cảnh ngắn, có mốc thời gian và bằng chứng để trả lời *“Có gì vừa thay đổi?”*. Giữ đường tín hiệu nhạy thời gian độc lập với VLM và mạng. Dùng camera iPhone trước để loại biến số phần cứng; chuyển nguồn camera sang kính sau khi UX và độ trễ có kết quả.

Điểm mới so với thiết kế cũ là không dùng YOLO làm trục chính của toàn sản phẩm. Với một câu hỏi mô tả đơn giản, VLM trực tiếp có thể đủ. Chỉ giữ tầng detector/tracker hoặc bộ nhớ khi cho thấy giảm đếm sai, nhầm trái/phải, mô tả nhầm hành động hay nói lặp. Đừng thêm một mô hình “kiểm tra lại” chỉ vì hai mô hình đồng ý.

## Ma trận thử, không phải bảng xếp hạng

| Vai trò | Ưu tiên | Hạn chế hoặc điều kiện dừng |
|---|---|---|
| VLM nhẹ, đối chứng chạy local | [SmolVLM2 500M](https://huggingface.co/HuggingFaceTB/SmolVLM2-500M-Video-Instruct); [OpenVision](https://github.com/rayl15/OpenVision) là bằng chứng tác giả đã làm luồng kính → khung ảnh → hỏi đáp local trên iPhone. | Không suy ra FPS streaming, tiếng Việt hay chất lượng trên iPhone 16 Pro Max từ demo của tác giả. |
| VLM so độ đúng và tiếng Việt | [Qwen3.5-0.8B](https://huggingface.co/Qwen/Qwen3.5-0.8B) cho nhánh nhẹ, [Qwen3.5-2B](https://huggingface.co/Qwen/Qwen3.5-2B) làm mốc chất lượng trên Mac trước. | Pin model gốc, artifact lượng tử, runtime, prompt và cách lấy khung. Có bản lượng tử trên Hub không chứng minh chạy đúng bằng Swift trên iPhone. |
| Ứng viên nghiên cứu ưu tiên sau vòng 1 | [MiniCPM-V 4.6](https://huggingface.co/openbmb/MiniCPM-V-4.6) cho nén token ảnh; [LFM3-VL-2B](https://huggingface.co/LiquidAI/LFM3-VL-2B) cho bài toán video, quan hệ không gian, tiếng Việt theo model card; [Gemma 4 E2B](https://huggingface.co/google/gemma-4-E2B-it) cho ảnh và đầu vào âm thanh. | Không đem cả ba lên máy cùng lúc. LFM3 có điều khoản riêng và tác giả không khuyến nghị nhiều lượt. Gemma tạo text; phát giọng vẫn là một tầng riêng. Nén token chỉ có giá trị nếu không mất chi tiết người dùng hỏi. |
| Nghiên cứu kiến trúc, không nhúng sản phẩm | [Apple FastVLM 0.5B](https://huggingface.co/apple/FastVLM-0.5B) và app tham chiếu [iOS](https://github.com/apple-aiml-research/ml-fastvlm/tree/main/app). | [LICENSE của weights](https://huggingface.co/apple/FastVLM-0.5B/blob/main/LICENSE) giới hạn mục đích nghiên cứu phi thương mại và loại trừ phát triển sản phẩm. Không chọn làm runtime sản phẩm. |
| Detector | Giữ YOLOv3 iOS làm đối chứng. [RF-DETR Nano](https://github.com/roboflow/rf-detr) là ứng viên Apache-2.0 theo bảng checkpoint của tác giả. [YOLO26n](https://docs.ultralytics.com/models/yolo26) có đường export [Core ML](https://docs.ultralytics.com/integrations/coreml/) rõ ràng hơn, nhưng phải qua [cổng AGPL/Enterprise](https://www.ultralytics.com/license). | Không so mAP khác kích cỡ input hoặc thời gian trên T4 với Core ML iPhone. Chưa xác minh đường Core ML của RF-DETR Nano trên máy đích. Bản COCO không tự thêm quạt, nón bảo hiểm hay thuộc tính theo người dùng hỏi. |
| Detector mở từ vựng | [YOLOE](https://github.com/THU-MIG/yoloe) để khảo sát tìm vật theo prompt và mask. | Chỉ xem xét khi nhu cầu tìm lớp ngoài COCO thực sự xuất hiện; repo AGPL và phải kiểm quyền weights. Không gọi ở mọi khung. |
| Theo dõi và hình học | Giữ tracker Swift và ARKit LiDAR của RoboEye trước. Học cách phục hồi track từ [ByteTrack](https://github.com/FoundationVision/ByteTrack) và bù chuyển động camera từ [BoT-SORT](https://github.com/NirAharon/BoT-SORT). [MoGe](https://github.com/microsoft/MoGe) để nghiên cứu ảnh đơn khi mất LiDAR, không kế thừa độ tin cậy số mét. | Không thay tracker cho đến khi quay đầu thật gây đếm trùng hoặc báo chuyển động sai. MoGe-3 upstream ghi không hỗ trợ macOS; không đưa vào P0 iPhone. |
| Kính | [Meta Wearables DAT iOS](https://github.com/meta/meta-wearables-dat-ios) có stream khung camera. Dùng repo OpenVision làm đối chứng tích hợp, không mặc nhiên tái sử dụng mã hay phụ thuộc. | Xác minh model kính, phiên bản SDK, quyền phát hành, độ trễ kính→phone, rớt kết nối, nhiệt/pin và quyền riêng tư. SDK tồn tại không có nghĩa mọi kính hỗ trợ hay sẵn sàng thương mại. |

## Phương pháp nên lấy về

1. **Lưu sự kiện đã quan sát, không lưu lịch sử video vô hạn.** Một quan sát giữ ID phiên, ID track, timestamp, mốc tọa độ, vị trí, trạng thái có còn nhìn thấy hay không và nguồn bằng chứng. Bộ nhớ chỉ cần trả lời cảnh hiện tại và thay đổi gần đây. Nếu người dùng vừa quay đầu, “bên phải” phải tính theo góc nhìn hiện tại hoặc nói rõ đó là vị trí lúc nhìn thấy. Mượn ý tưởng scene graph và truy xuất của [DirectMe/UCS-Bench](https://github.com/cocowy1/UCS-Bench), không bê nguyên stack nghiên cứu.
2. **Chỉ gửi khung có ích cho VLM.** Hỏi cảnh hiện tại: một khung tốt. Hỏi chuyển động: lấy ít nhất hai khung ở hai thời điểm có bằng chứng; thêm khung nếu thực sự cần. Dừng tác vụ cũ khi có câu hỏi mới. [STC](https://github.com/lern-to-write/STC) cho thấy hướng nén và tái dùng thông tin thị giác; bản đầu dùng chọn khung, chưa sửa transformer. Nếu trả lời đang phát mà cảnh đã đổi, phải nói rõ thời điểm hoặc hủy mô tả cũ.
3. **Tách điều chắc khỏi điều suy luận.** Số người, màu, quan hệ “đang ngồi trên”, chuyển động và số mét là các claim riêng. Mất dấu hoặc bị che thì nói “ít nhất…”, “không thấy rõ” hoặc từ chối. Không đoán danh tính, tuổi, giới tính hoặc ý định để làm câu nói sinh động. Phát hiện thấy bốn người trong khung không có nghĩa chỉ có bốn người quanh người dùng.
4. **Giữ lớp ưu tiên âm thanh nhỏ.** Hỏi đáp tiếng Việt do người dùng yêu cầu là ưu tiên đầu; cảnh báo đủ bằng chứng có thể ngắt mô tả, không phải lấp đầy khoảng lặng. Không tự nói “lối trống” hay “qua đường được”. Tầng khẩn không chờ VLM; không có dữ liệu không phải tín hiệu an toàn. Chỉ thử trong khu vực có kiểm soát với người hướng dẫn.
5. **Giữ nguồn camera có khai báo năng lực.** Camera iPhone có thể có depth cùng khung; kính RGB dùng điện thoại trong túi không có LiDAR cùng góc nhìn. Không cấp số mét chỉ vì cùng chạy trên iPhone. Khi mất kính, thông báo mất nguồn; không âm thầm dùng camera điện thoại như cùng góc nhìn.

## Dữ liệu dùng để kiểm, không lấy để quảng cáo

| Nguồn | Dùng cho | Không dùng để kết luận |
|---|---|---|
| [VizWiz-VQA](https://vizwiz.org/tasks-and-datasets/vqa/) | Câu hỏi thật của người khiếm thị, ảnh khó và trường hợp không trả lời được. | Không đo quan hệ không gian động, tiếng Việt hay độ an toàn. Không lưu lại ảnh cá nhân cho đợt nghiên cứu này. |
| [ORBIT](https://github.com/microsoft/ORBIT-Dataset) | Phương pháp nhận ra đồ cá nhân người dùng dạy, trong cảnh sạch và lộn xộn. | Không phải dữ liệu giao thông hay đo khoảng cách. Repo và quyền dữ liệu là hai việc; chưa xác nhận quyền tái phân phối. |
| [OVO-S-Bench](https://github.com/InternLM/OVO-S-Bench), [UCS-Bench](https://github.com/cocowy1/UCS-Bench), [StreamArena](https://github.com/JIA-Lab-research/StreamArena) | Thiết kế câu hỏi có thời điểm, vùng bằng chứng, trí nhớ và chủ động thông báo; chỉ được xem khung trước lúc hỏi. | Không chứng minh thuật toán chạy mượt trên thiết bị đeo, cũng không xác nhận quyền lấy các video nguồn về huấn luyện. |
| Bộ cảnh Việt Nam có đồng ý tham gia | Phòng/hành lang, cửa hàng, đồ vật cá nhân, bãi xe có kiểm soát; quay đầu nhanh, vật bị che, ánh sáng yếu, xe/người di chuyển, biển chữ Việt, câu hỏi không đủ dữ kiện. | Không dùng frame liền kề của cùng clip làm holdout. Không thu dữ liệu khuôn mặt hoặc trẻ em trên mạng để lấp chỗ thiếu. Không upload video người dùng khi chưa có quyền. |

## Kế hoạch thử nhỏ nhất có thể bác bỏ thiết kế

- **A: VLM trực tiếp** nhận ảnh hoặc các khung chọn lọc; **B: cùng VLM** nhận cùng khung và thông tin do tracker đã kiểm cung cấp; **C: tracker + mẫu câu tất định** cho nhóm đếm, hướng và thay đổi đơn giản. Cùng clip, cùng câu hỏi, cùng phần cứng. So thêm Apple Magnifier/Be My AI về nhiệm vụ và mức làm phiền, không gộp dịch vụ có mạng vào số đo local.
- Tập phát triển riêng với tập holdout mới theo địa điểm/người/clip. Nhãn thủ công độc lập cho số người nhìn thấy, trái/phải theo góc nhìn, quan hệ/hành động, mốc sự kiện, câu trả lời không thể xác định. AI có thể đề xuất nhãn, không tự xác nhận. Nếu thử số mét, đo đối chiếu tới cùng bề mặt; nhóm kính RGB không báo mét.
- Chấm đúng/sai theo từng claim: đếm, hướng, hành động, màu, nhãn OCR và thời điểm. Tính cả tỷ lệ bỏ sót, báo sai, từ chối đúng/sai, trả lời sau khi cảnh đã đổi, câu nói lặp và mức người dùng hiểu được không cần nhìn. Đo riêng cold/warm, P50/P95 từ hỏi đến bắt đầu nghe, độ trễ sự kiện tới tín hiệu, bộ nhớ và nhiệt trong một phiên dài; công bố mẫu số và cấu hình.
- **Cổng chọn:** nếu B không giảm lỗi có ý nghĩa so với A hoặc làm chậm/rối trải nghiệm, bỏ lớp B ở chế độ hỏi đáp mặc định. Nếu detector mới không cải thiện cùng iPhone, giữ baseline. Nếu VLM chưa đủ ổn, vẫn có thể demo C và hỏi đáp đứng yên, không hạ ngưỡng nhận làn hay dẫn đường để lấy hiệu ứng demo.

## Provenance và điều chưa xác nhận

Registry là mẫu có chủ đích. Mẫu số 27 chỉ là số mục được giữ trong đợt này; phân bố do máy tính chỉ mô tả cơ cấu mẫu, không phải độ bao phủ thị trường. Tier A là nguồn gốc cho điều nguồn tự công bố, không phải xác nhận độc lập hiệu năng; tier B là báo cáo của tác giả tích hợp độc lập với nhà phát hành model; tier C là tín hiệu X. Bài X về [MLX](https://x.com/Prince_Canuma/status/1884729653933306223) nói về Qwen2.5-VL trên Mac; [tín hiệu Omni](https://x.com/xy_gu/status/2038859338874528076) không phải card của model nhỏ. Không dùng hai tín hiệu này cho điểm model. Không đăng nhập, không vượt giới hạn truy cập. Một số truy vấn X chỉ trả profile hoặc kết quả không liên quan nên bị loại.

`snapshots/` lưu các đoạn nguyên văn truy hồi được, không phải trang đầy đủ hoặc revision bất biến. `claims.jsonl` chỉ chuẩn hóa những đoạn này; mỗi giá trị nối tới URL, ngày, chủ nguồn và đoạn gốc. Model khác kích cỡ, checkpoint khác và dữ liệu khác điều khoản không gộp. Các cột benchmark iPhone 16 Pro Max, holdout tiếng Việt và thông qua quyền thương mại để trống có chủ đích. Chưa tải model/video, chưa cài SDK, chưa test phần cứng, chưa có số latency sản phẩm và chưa có chứng cứ thay gậy trắng hoặc hướng dẫn qua đường.

### Kiểm lại

Từ repo, chạy engine hiện có tại `/Users/os/.codex/skills/refinery/refinery.py` trên thư mục domain này. Dùng `bites.py` của cùng bộ công cụ để tiêm lỗi trên bản tạm và kiểm tra các cổng. Nếu mở rộng mẫu phải cập nhật mẫu số đợt hoặc khai khung mẫu mới. Kiểm lại nguồn gốc và pin revision, bản lượng tử, LICENSE tương ứng trước khi tải artifact cho bake-off.
