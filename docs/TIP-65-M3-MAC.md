# TIP-65 M3 · Bằng chứng khoảng cách và chuyển động trên Mac

Mục tiêu: không đọc số mét hoặc trạng thái chuyển động do VLM sinh. Câu trả lời
ngắn tiếng Việt lấy từ phép đo hoặc bằng chứng theo dõi đúng đối tượng.
Chỉ làm runner video trên Mac, không thay đổi app iPhone, không deploy.

## Tiêu chí trước khi chạy

1. Mô tả Qwen đã lưu chỉ dùng để kiểm thử phản ví dụ, không được chuyển thành
   phép đo, trạng thái chuyển động hay câu phát ra. Clip RGB không có đầu vào
   đo khoảng cách. Chứng minh ca dương và kiểm nguồn, track/epoch/mốc, chất
   lượng, tuổi và dải đo bằng mẫu cấu trúc **tổng hợp**, không gọi là số đo thật.
2. Dùng YOLO lấy khung vật và nền ngoài vật để ước lượng dịch/căn khung.
   So cùng track và ngưỡng theo thời gian giữa tâm box thô và tâm đã căn nền.
   Không dùng track dự đoán, lấy vị trí camera làm chuyển động vật hay
   nối track qua mất căn chỉnh/cắt cảnh. Thiếu nền hoặc mâu thuẫn thì im lặng
   về chuyển động; không suy ra vật đứng yên. Chỉ mô tả đổi vị trí *so với nền
   trong chuỗi khung*, không tuyên bố quỹ đạo hay tốc độ ngoài đời.
3. Bộ [nhãn trước thử](../tests/fixtures/assist-scene-motion-mac.json):
   0 báo nhầm trong hai bản đóng băng có lia/rung; phát hiện người ở clip
   camera cố định và cùng clip có áp lia/rung; từ chối ở nền trơn và không
   nối qua cắt cảnh. Clip xe buýt lia thật là ca khó, ghi nhận riêng bỏ sót
   và sự kiện sai, không đổi nhãn hoặc tùy chỉnh ngưỡng theo từng clip.
4. Giới hạn clip 3–6 giây và lấy mẫu 5 Hz trong phép thử; đo theo công đoạn.
   Không gọi API, không cài thêm model/phần cứng, không tính cước cloud.

Tách hai loại bằng chứng: clip thật mới để kiểm detector và tracking;
clip biến đổi có kiểm soát để biết chắc cái gì gây dịch ảnh. Nhãn do trợ lý
xem trước khi chạy, chưa có người độc lập gán ID từng người. Hai bản
biến đổi từ cùng cảnh, không coi là nguồn độc lập.

Nguồn: [phố đi bộ – Taurus Media Technik, CC0](https://commons.wikimedia.org/wiki/File:Video_Codec_Test_pedestrian_area_1080p25.y4m.webm);
[xe buýt – Charstone Simon, CC BY-SA 4.0](https://commons.wikimedia.org/wiki/File:BUS_on_the_move.webm),
[giấy phép](https://creativecommons.org/licenses/by-sa/4.0/).
Mô tả biến đổi và SHA-256 nằm trong manifest. Không đưa clip vào Git.

Đối chứng M2B là VLM: đã bịa mét và không phân biệt ổn định clip thật/đóng băng.
Phép đối chiếu chuyển động M3 dùng cùng track để cô lập tác động của căn nền,
không coi đây là AB của hai model ngôn ngữ.

**Phép thử bổ sung sau lượt đầu, ghi riêng:** hai ca rung/lia ban đầu có thể
tự triệt tiêu dao động qua bộ lọc nhiều khung ngay cả khi không bù camera.
Thêm bản ảnh đóng băng dịch ngang đều 96 pixel theo công thức cấu hình,
để kiểm xem phép trừ chuyển động nền có giá trị khác bộ lọc hay không.
Không đổi ngưỡng, track, nhãn hoặc bỏ bảy kết quả đầu. Cùng ảnh nguồn nên
đây vẫn là kiểm chứng cơ chế, không phải nguồn độc lập.

## Verify · Kết quả Mac

**Hoàn tất bản lab; không đạt để dùng làm cảnh báo ngoài đời.** Mac M1 Max,
32 GiB, macOS 27.2, OpenCV 5.0.0, Core ML YOLOv3 FP16; 8 clip, 160 khung
lấy mẫu ở 5 Hz. Không gọi VLM khi chạy. 160/160 khung không có số đo thì
trả đúng “Chưa đo được khoảng cách.” Tất cả 24 câu Qwen M2B khi phát lại
(dạng text và object JSON) đều bị từ chối làm bằng chứng ở cả hai cổng.
Ca dương tổng hợp kiểm nguồn tin cậy, track không coast, phiên/mốc khớp,
dữ liệu mới ≤300 ms, kết quả đã được cảm biến xác nhận và trong dải
0,5–5 m. Mac không gắn cảm biến nên chưa có phép đo vật lý; kiểu dữ liệu
không phải cơ chế xác thực, chỉ adapter đáng tin mới được cấp phép tạo mẫu.

Lượt bù nền ban đầu còn 2 khung báo sai ở ca lia đều. Sai số căn nền trung
vị từng cặp tương ứng chỉ ~0,03 px, nhưng tâm box YOLO lệch tới ~29 px
so với nền ngay trên ảnh đóng băng. [Giữ bằng chứng của lượt lỗi](evidence/tip65/m3-mac-bbox-only.json).
Bản cuối chỉ phát ngôn nếu luồng quang học xuôi/ngược trong vùng giữa của vật
có đủ điểm và cùng hướng với phần dịch còn lại qua ít nhất hai bước gần nhất
trong cửa sổ ba bước. Không dùng riêng tâm box. Nhãn không được đưa vào detector.

| Clip | Cặp căn nền hợp lệ / 19 | Khung báo nếu không bù | Chỉ bù nền và box | Bản cuối: cần điểm ảnh đồng thuận |
|---|---:|---:|---:|---:|
| Người đi bộ, camera cố định | 19 | 10 | 9 | 2 |
| Người đi bộ + lia/rung mô phỏng | 18 | 8 | 7 | 2 |
| Đóng băng + lia/rung mô phỏng | 19 | 0 | 0 | 0 |
| Đóng băng + rung mô phỏng | 19 | 0 | 0 | 0 |
| Đóng băng + lia đều | 19 | 16 | 2 | 0 |
| Nền trơn | 0 | 0 | 0 | 0 |
| Cắt cảnh xen kẽ | 10 | 0 | 0 | 0 |
| Xe buýt, camera lia thật | 0 | 0 | 0 | 0 |

Đơn vị là số khung có ít nhất một báo, không phải số người hay sự kiện duy
nhất. Đối chứng không bù dùng cùng track và điều kiện căn nền hợp lệ,
chỉ không trừ chuyển động nền khi tính độ dịch. Bản cuối phát hiện người
ít nhất một lần ở cả hai clip dương; ở clip có lia/rung, một khung phát
hiện người và một khung là túi xách của người đang đi. Việc phát hiện thưa
hơn cho thấy đánh đổi độ phủ, không suy ra recall theo từng người.
Tất cả 9 lần cắt bị gãy phiên theo dõi; nền trơn 19/19 lần từ chối.
**Bỏ sót xe buýt thật**: nền quá ít điểm ổn định khi camera lia theo,
0/19 cặp hợp lệ nên hệ thống không phát ngôn. Các phép thử mô phỏng
không đại diện cho lia 3D, rung mờ, rolling shutter hoặc parallax ngoài đời.

Trung vị thời gian trên 160 khung: YOLO 25,77 ms, căn nền 5,05 ms,
ghép track và kiểm điểm cục bộ 2,77 ms; trung vị của tổng ba công đoạn
theo từng khung 34,18 ms. Loại tải model, đọc/ghi khung, camera và đọc
thành tiếng. Không phải thời gian đầu-cuối hoặc bằng chứng real-time.

[Biên bản kiểm máy và các sự kiện đã phát](evidence/tip65/m3-mac-motion-verified.json).
JSON đầy đủ tại `native/ios/.build-xcode/scene-qa/motion-m3-vetted.json`.
Mac unit test 32/32, Swift hồi quy 117/117; SHA-256 cho hai nguồn, tám clip,
manifest và runner đã kiểm. Xóa 9 JPEG khảo sát tạm (~127 KiB, tái tạo được);
giữ 15 MiB media QA trong cache ignored. Không tạo scratch tồn ngoài repo.

Tiếp theo: thêm clip thật có camera di chuyển tịnh tiến, camera lia nhanh
và che khuất, có nhãn track do người duyệt; đánh giá riêng cải thiện
đối với xe buýt trước khi đem logic Mac vào native. Âm thanh, iPhone,
LiDAR thật và cảnh báo an toàn vẫn chưa kiểm trong phase này.

## Tái chạy trên Mac

Tại repo gốc, tái dùng môi trường QA và SceneQA của
[M2A](TIP-65-M2-MAC.md), có OpenCV 5.0.0 và numpy 2.5.4 trong môi trường
đã dùng, `imageio-ffmpeg==0.6.0` từ [M2B](TIP-65-M2B-QWEN-MAC.md).
Chỉ tải hai clip nếu chưa có; không cần tải VLM. Vision/Core ML cần quyền
chạy ngoài sandbox nếu sandbox ngăn cấp quyền xử lý.

```sh
qa="$PWD/native/ios/.build-xcode/scene-qa"
mkdir -p "$qa/motion-cases"
curl -fLsS --max-time 45 --max-filesize 11300000 \
  'https://upload.wikimedia.org/wikipedia/commons/a/ae/Video_Codec_Test_pedestrian_area_1080p25.y4m.webm' \
  -o "$qa/motion-cases/pedestrian-source.webm"
curl -fLsS --max-time 45 --max-filesize 500000 \
  'https://upload.wikimedia.org/wikipedia/commons/f/f5/BUS_on_the_move.webm' \
  -o "$qa/motion-cases/bus-source.webm"
PYTHONDONTWRITEBYTECODE=1 "$qa/venv/bin/python" scripts/prepare-assist-scene-motion.py
```

Sinh fixture bằng FFmpeg kèm imageio-ffmpeg 0.6.0 trên Mac; file MP4
khác encoder/bản nền có thể không trùng hash, runner từ chối thay vì chạy
dữ liệu không cùng bản. Clip chuẩn CFR 25 Hz, ảnh chuẩn 640×360, không tiếng.
Dùng đường dẫn kết quả chưa tồn tại:

```sh
qa="$PWD/native/ios/.build-xcode/scene-qa"
yolo="$PWD/native/ios/.build-xcode/Build/Products/Release-iphoneos/AssistiveDepthProbe.app/YOLOv3FP16.mlmodelc"
if [ ! -d "$yolo" ]; then
  yolo="$qa/YOLOv3FP16.mlmodelc"
  xcrun coremlcompiler compile native/ios/Models/YOLOv3FP16.mlmodel "$qa"
fi
PYTHONDONTWRITEBYTECODE=1 /usr/bin/perl -e 'alarm shift; exec @ARGV' 220 \
  "$qa/venv/bin/python" scripts/assist_scene_motion.py \
  --manifest tests/fixtures/assist-scene-motion-mac.json \
  --sceneqa "$qa/sceneqa" --yolo "$yolo" --output "$qa/motion-m3-rerun.json"
PYTHONDONTWRITEBYTECODE=1 "$qa/venv/bin/python" \
  -m unittest discover -s tests -p 'test_assist_scene_*.py'
```

Tham chiếu kỹ thuật: [OpenCV theo dõi luồng quang học](https://docs.opencv.org/4.13.0/dc/d6b/group__video__track.html)
và [ước lượng affine](https://docs.opencv.org/4.13.0/d9/d0c/group__calib3d.html).
