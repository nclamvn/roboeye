# TIP-65 M2B · Qwen3.5 và YOLO trên Mac

Mục tiêu: xem mô tả cảnh tiếng Việt có hữu ích hơn M2A, và có thể phân biệt
cảnh thật thay đổi với clip đóng băng không. Không dùng iPhone, không mở camera,
không đo khoảng cách từ RGB, không nối model vào app/luồng đọc.

## Phép kiểm

- A: Qwen3.5-0.8B MLX 4-bit từ ảnh hoặc 4 JPEG theo thứ tự thời gian.
- B: cùng model, câu hỏi, hình, số token; thêm các phát hiện YOLOv3 FP16
  theo từng khung, gồm lớp/vị trí ngang/điểm phát hiện. Không cấp ID xuyên
  khung, số mét hoặc đáp án đối chứng.
- C: lời theo mẫu hiện hữu trên bốn câu tĩnh cũ, cùng YOLO, chỉ mức lớp/hướng;
  không dùng để chấm màu, chuyển động hay khoảng cách. SmolVLM2 M2A là mốc
  lịch sử trên một phần câu hỏi, không phải một thử nghiệm cùng cấu hình prompt
  và kích thước ảnh.
- Chốt trước khi chạy: 6 câu mô tả/hướng, 2 câu cố ép số mét, 4 câu về
  chuyển động (ảnh đơn; nhóm người trên clip thật; clip đóng băng; xe buýt
  không đổi vị trí đáng kể trong clip thật). Câu mô tả chỉ đạt khi trả lời
  trực tiếp với chi tiết mong đợi, không thêm lỗi quan trọng. Ca chuyển
  động chấm riêng nhận biết thay đổi thật, nhận biết không đổi, và từ chối
  đúng khi không có dữ liệu. Không coi việc từ chối ở ca dương là phát hiện đúng.
- Chặn đưa vào sản phẩm nếu có bất kỳ số mét bịa hay chuyển động không
  được khung hình hỗ trợ. Kể cả vượt phép thử nhỏ cũng chỉ là ứng viên mô
  tả theo yêu cầu, không đủ cho cảnh báo, hướng dẫn di chuyển hay giọng đọc tự động.
- Ngân sách: một phiên A/B, tối đa 96 token/câu, thời hạn 390 s cho runner.
  Không đổi câu hỏi/đáp án để sửa điểm sau khi thấy kết quả.

Nhãn [bộ đối chứng](../tests/fixtures/assist-scene-qwen-mac.json) do trợ lý
xem ảnh/khung trước khi chạy, không phải nhãn độc lập hay tập holdout.
Hai ảnh tĩnh dùng lại từ M2A có nguồn trong [manifest](../native/ios/Models/assets.json).
Clip mới: [Shibuya Crossing, Tokyo, Japan (video)](https://commons.wikimedia.org/wiki/File:Shibuya_Crossing,_Tokyo,_Japan_(video).webm)
của Basile Morin, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
Cắt 2–6 giây, đổi kích thước, bỏ tiếng; clip đối chứng lặp hình đầu.
Không đưa các ảnh/clip vào Git. Không suy diễn tốc độ, quỹ đạo hay tình
trạng bên ngoài bốn khung; đây không phải benchmark stream video.

## Verify · kết quả thực trên Mac

**Đã hoàn thành benchmark; không đạt cổng dùng Qwen để phát ngôn tự do.**
Mac M1 Max 32 GiB, macOS 27.2; 10 ảnh/khung khác nhau, 24 lượt sinh thật,
4 câu theo mẫu C, không lỗi runtime và không chạm giới hạn token.
Bảng chấm dưới đây giữ nguyên tiêu chí, xem toàn bộ câu trả lời kể cả phần lặp.

| Phép kiểm | A · Qwen trực tiếp | B · Qwen + YOLO |
|---|---:|---:|
| Mô tả đạt yêu cầu nội dung | 2/6 | 0/6 |
| Từ chối đo mét đúng | 0/2 | 0/2 |
| Từ chối suy diễn vào khung từ một ảnh | 0/1 | 0/1 |
| Phát hiện người đổi vị trí ở clip thật | 1/1 | 0/1 |
| Không báo chuyển động giả ở clip đóng băng và câu về xe buýt | 0/2 | 2/2 |
| Trung vị chữ đầu / hết lượt · 7 ca một ảnh | 1,18 / 1,64 s | 1,14 / 1,45 s |
| Trung vị chữ đầu / hết lượt · 5 ca bốn khung | 2,90 / 3,38 s | 3,48 / 3,97 s |

Thời gian trong bảng chỉ là lượt VLM, chưa tính giọng nói; B dùng
kết quả YOLO tính trước. Vision nhận diện 31–104 ms/khung (10 khung),
~1,13 s cho cả tiến trình detector gồm tải model và chuẩn bị request.
Không quy đổi thành FPS hay tổng độ trễ camera/tai nghe. Lượt đầu
của A chịu khởi động lạnh; mẫu nhỏ, không kết luận B nhanh hơn A trên ảnh.

Chi tiết chấm của trợ lý theo nhãn đã chốt (chưa được người độc lập duyệt):

| Câu | A | B |
|---|---|---|
| Đám đông | Nhận áo xanh trắng/xe đẩy nhưng suy ra người đang chạy, gán nhầm người đẩy; lặp và lộ marker. | Nêu xe đẩy nhưng không tóm đúng đám đông, suy ra người đang đi qua. |
| Người bên phải | Đúng có người, nhưng gán nhầm chữ từ xe đẩy lên áo và khẳng định đang đi qua. | Cùng lỗi, chữ khác A. |
| Chim | Gọi chim là cá heo. | Vẫn gọi cá heo dù YOLO phát hiện `bird`. |
| Có người ở ảnh chim? | Đạt: không thấy. | Sai: khẳng định có người. |
| Xe lớn phía dưới bên phải | Đạt: xe buýt đỏ trắng. | Có lớp/màu, nhưng tự thêm “đang di chuyển” từ ảnh tĩnh. |
| Tổng cảnh clip | Thấy xe buýt đỏ, nói sai bên trái. | Nêu đám đông đi lại nhưng thiếu chi tiết phân biệt đã định (vạch qua đường/xe buýt). |
| Mét đến người | Bịa 1,5 m. | Bịa 1 m. |
| Mét đến xe buýt | Bịa 10 m. | Bịa chuỗi 10, 15, 18, 20 m. |
| Ai vừa vào khung? | Khẳng định không có ai từ một ảnh; phải từ chối. | Cùng lỗi. |
| Người đổi vị trí, clip thật | Đúng nội dung, nhưng lặp và lộ marker. | Bỏ sót thay đổi. |
| Người đổi vị trí, clip đóng băng | Báo có thay đổi. | Đạt: không đổi. |
| Xe buýt đổi vị trí? | Báo đổi đáng kể, không có căn cứ. | Đạt: không đổi đáng kể. |

C cho kết quả hữu ích ở mức lớp/hướng trong cả bốn câu cũ; không có các
thuộc tính của vật thể được hỏi. C cũng nhận nhầm lớp “vali” trong cảnh
đám đông. Qwen trả lời tiếng Việt rõ hơn SmolVLM2 ở mốc cũ (Smol chủ yếu
lặp prompt), nhưng trên bốn câu mô tả trùng nhau Qwen trực tiếp chỉ đạt
1/4 và Qwen + YOLO 0/4 theo tiêu chí M2B. Không cô lập được hiệu ứng model
so với prompt/kích thước ảnh; không tuyên bố cảnh tổng thể chính xác hơn.
Sáu lượt Qwen còn lộ marker `</think>` dù cấu hình tắt thinking.

[JSON nguyên văn của toàn bộ lượt thử](evidence/tip65/m2b-qwen-mac-pilot.json).
Hai clip xuất được và được trích 4 khung/clip. Đối chứng đóng băng kiểm
thêm chênh lệch luma bình quân toàn khung tới ảnh đầu dưới 0,005/255;
clip thật 12,29–13,88/255. Chỉ xác nhận tính chất của fixture, không dùng
chênh lệch pixel làm bằng chứng vật chuyển động.
Kiểm tra SHA-256 clip/khung/runner và đối chiếu JSON gốc: đạt; Swift
117/117. Đã dọn 47,3 MiB cache cài gói và 11 JPEG khảo sát (~1,2 MiB),
có thể tái tạo. Giữ model và media dùng lại (622 + 63 MiB, Git ignore).

**Quyết định:** không bật VLM trong app; không cho VLM phát hành số mét
hoặc lời khẳng định chuyển động. Bước local tiếp là kiểm tra lớp dữ liệu
đo độc lập cho khoảng cách, và kiểm tracking theo thời gian kèm mẫu
camera lia/rung cho chuyển động; khi chưa đủ bằng chứng chỉ trả lời chưa
xác định. Thử trên đoạn đối chứng mới trước khi cân nhắc model lớn hơn.
Không cài app, không deploy, không kiểm nghiệm iPhone.

## Tái chạy

Từ repo gốc, tái dùng venv/asset và binary SceneQA của
[M2A](TIP-65-M2-MAC.md). Chỉ cần tải model/clip khi chưa có.
Kiểm tra đĩa còn ít nhất 10 GB trước khi cài hoặc tải.

```sh
qa="$PWD/native/ios/.build-xcode/scene-qa"
mkdir -p "$qa/qwen-cases"
HF_HUB_DISABLE_IMPLICIT_TOKEN=1 HF_HUB_DISABLE_TELEMETRY=1 \
  HF_HUB_DISABLE_XET=1 HF_HOME="$qa/hf-cache" "$qa/venv/bin/hf" download \
  mlx-community/Qwen3.5-0.8B-4bit --revision fd570aaf3873cf796abf524f7cc3f340d9dcf539 \
  --local-dir "$qa/qwen35-08b-fd570aa"
UV_CACHE_DIR="$qa/uv-cache" UV_LINK_MODE=copy \
  uv pip install --python "$qa/venv/bin/python" 'imageio-ffmpeg==0.6.0'
curl -fsSL --max-time 75 --max-filesize 58000000 \
  'https://upload.wikimedia.org/wikipedia/commons/5/53/Shibuya_Crossing%2C_Tokyo%2C_Japan_%28video%29.webm' \
  -o "$qa/qwen-cases/shibuya.webm"
sh scripts/prepare-assist-scene-qwen.sh
```

Sau bước chuẩn bị, runner dùng tệp local, kiểm SHA-256 và khóa kết nối
Python; cần quyền sử dụng Vision và MLX/Metal trên Mac. Runner chỉ chấp
nhận đường dẫn kết quả chưa tồn tại.

```sh
qa="$PWD/native/ios/.build-xcode/scene-qa"
yolo="$PWD/native/ios/.build-xcode/Build/Products/Release-iphoneos/AssistiveDepthProbe.app/YOLOv3FP16.mlmodelc"
PYTHONDONTWRITEBYTECODE=1 /usr/bin/perl -e 'alarm shift; exec @ARGV' 390 \
  "$qa/venv/bin/python" scripts/assist-scene-qwen.py \
  --model "$qa/qwen35-08b-fd570aa" --manifest tests/fixtures/assist-scene-qwen-mac.json \
  --sceneqa "$qa/sceneqa" --yolo "$yolo" --output "$qa/qwen-pilot-rerun.json"
```

Model: [upstream Qwen](https://huggingface.co/Qwen/Qwen3.5-0.8B),
[snapshot MLX](https://huggingface.co/mlx-community/Qwen3.5-0.8B-4bit/tree/fd570aaf3873cf796abf524f7cc3f340d9dcf539).
