# TIP-65 M3B · Camera lia nhanh, camera di chuyển và che khuất

Mục tiêu trên Mac: giảm bỏ sót xe buýt đã biết mà không gỡ cổng bằng
chứng của [M3](TIP-65-M3-MAC.md). Không mở rộng phạm vi sang iPhone,
LiDAR, cảnh báo an toàn, upload, VLM hay triển khai.

Tái hiện: detector có box vào phần lớn đoạn xe buýt; cổng căn nền của
M3 từ chối 19/19 cặp 5 Hz. Khi xe che phần lớn ảnh, không đủ nền.
Sau đó YOLO đổi từ bus sang truck/car. Hai giả thuyết kiểm độc lập:
khung trung gian giúp nền/điểm trên vật không nhảy quá xa; có thể giữ
liên tục theo hình học qua nhiễu nhãn mà không đổi nhãn thành sự thật.
So sánh M3 và M3B ở cùng 5 Hz detector; tỷ lệ báo không phải FPS.

Cổng bắt buộc: mất nền, mất vật, cắt cảnh hoặc che kín thì không được
ra kết luận trong khoảng liên quan. Chỉ báo dịch so với nền đã căn,
không suy ra vận tốc, số mét, vật tự di chuyển hoặc lối an toàn. Mọi
kết quả phát sau khi vật hiện lại phải xây lại chuỗi bằng chứng.

Chấm trên clip và các cửa sổ không chồng nhau đã khóa trước lượt chạy
M3B. Mỗi cửa sổ dương không có báo hợp lệ là một bỏ sót. Mỗi cửa sổ âm
có ít nhất một báo là một báo nhầm; đếm riêng số khung báo. Ghi khoảng
camera không đủ điều kiện để không lẫn im lặng với xác nhận đứng yên.
Đây là nhãn thô do trợ lý đặt trước, không phải ground truth từng pixel
hay đánh giá độc lập. Một lượt làm giàu căn nền và điểm vật, một lượt
chạy lại nếu QA tìm lỗi cụ thể; không hạ ngưỡng theo từng clip.

## Verify · Bản lab Mac

**Giảm báo nhầm ở clip camera tiến tới; chưa xử lý xong bỏ sót xe buýt.**
11 clip × 20 mẫu YOLO, 7 cửa sổ dương và 8 cửa sổ âm. M3 và M3B dùng
cùng phát hiện YOLO, cùng khung 5 Hz. M3B thêm các khung nguồn 25 Hz để
căn nền từng bước và bám điểm trên vật, không mượn box một mình làm bằng
chứng. Với xe tải/xe buýt nhiễu nhãn chỉ giữ khái niệm “phương tiện”
nếu track có bằng chứng hình ảnh liên tục và nhãn xe buýt đủ tin cậy
trước đó. Mất dấu, che toàn phần hay cắt thì không giữ báo cũ.

| Phương án | Đúng / 7 cửa sổ dương | Bỏ sót / 7 | Báo nhầm / 8 cửa sổ âm |
|---|---:|---:|---:|
| M3 gốc | 3 | 4 | 1 |
| Căn 25 Hz + bám điểm vật, chưa chặn đổi tỷ lệ | 0 | 7 | 1 |
| Căn 25 Hz + bám điểm vật + chặn đổi tỷ lệ | 0 | 7 | 0 |
| M3 + chặn đổi tỷ lệ cảnh | 3 | 4 | 0 |

- **Xe buýt quay tay:** căn nền qua khung trung gian tăng từ 0/19 lên
  3/19 khoảng hợp lệ (3,2 s, 3,6 s, 3,8 s). Không báo ở cả hai cửa sổ
  dương. Lúc xe gần, nền bị che hoặc chỉ còn điểm tập trung một vùng.
  Lúc xe xa, nhãn đổi hoặc mất dấu. Chẩn đoán YOLO toàn bộ 100 khung
  thấy phương tiện ở 81, căn được 35/99 cặp liên tiếp mà vẫn không
  có đề xuất đủ bằng chứng. Dò homography/ORB không cho bằng chứng
  nền quanh vị trí xe để dùng an toàn ở đoạn đầu; không mở đường ngoại lệ.
- **Lia nhanh:** clip ảnh đóng băng, pan ngang ±61 px và roll mô phỏng.
  0/20 khung báo nhầm ở cả hai; nhánh chuỗi dày chỉ căn được 1/19,
  so với 16/19 của M3, nên im lặng không chứng minh căn tốt.
- **Camera tiến và cua thật:** M3 và nhánh bám dày từng báo nhầm xe đỗ
  ở 1,4 và 1,6 s. Khung 1,6 s ở trong cửa sổ âm đã khóa, khung 1,4 s
  nằm ngoài cửa sổ nhưng được đối chiếu thêm với xe cạnh vạch đỗ. Veto
  đổi tỷ lệ liên tục loại cả hai báo; không tìm được xe bạc di chuyển
  trong cửa sổ dương đầu đoạn. Đây là cổng thận trọng khi camera
  tiến/lùi hoặc zoom, không phải thuật toán giải riêng chuyển động 3D.
- **Che kín:** từ 1,2 đến 2,8 s không phát báo. M3 có phát hiện trước khi
  che, nhưng không xác nhận lại trong 1,2 s sau hiện ra. Tính là một bỏ
  sót sau che, không gọi giữ ID xuyên che là thành công.

Độ trễ offline trung vị: YOLO 29,56 ms/mẫu; nhánh 25 Hz căn nền và
theo dõi 6,37 ms/khung nguồn, gồm cả các khung dừng sớm. Hai số không
được cộng thành độ trễ toàn luồng. Python 47/47; cả 880 đầu ra frame ×
nhánh không có số mét. Không có dữ liệu live, iPhone, khoảng cách thật,
hoặc chấm độc lập theo từng target ID. Nhiều fixture cùng video nguồn.
Đã xác minh lại fingerprint clip, nhãn, code và receipt. Dọn 22 ảnh JPEG
khảo sát tái tạo được; giữ clip nguồn và biên bản trong cache build Git ignore.

**Quyết định:** chỉ giữ M3 + veto đổi tỷ lệ làm ứng viên Mac, không
thay M3 bằng nhánh bám dày và không chuyển sang app. Để xử lý ca xe buýt
cần thêm nguồn bù camera độc lập (chẳng hạn gyro đồng bộ/quay có mốc
nền hoặc pose có kiểm định) hoặc benchmark đa góc có nhãn 3D; RGB đoạn
hiện có không đủ để khẳng định phần bị từ chối.

[Bảng điểm, thời điểm từng báo và chẩn đoán xe buýt](evidence/tip65/m3b-mac-motion-score.json).
Biên bản đầy đủ nằm ở `native/ios/.build-xcode/scene-qa/motion-m3b-final.json`
và `motion-m3b-bus-dense.json` trong cùng thư mục.

## Tái chạy

Dùng venv, SceneQA, YOLO và hai clip nguồn của [M3](TIP-65-M3-MAC.md).
Kiểm tra đĩa trống ≥10 GB. Tải một lần nguồn camera tiến/cua
[Fernost / CC0](https://commons.wikimedia.org/wiki/File:Dashcam_recording_example_-_Panorama_II_BlackBox_Dashcam_daylight.mp4.ogv):

```sh
qa="$PWD/native/ios/.build-xcode/scene-qa"
yolo="$PWD/native/ios/.build-xcode/Build/Products/Release-iphoneos/AssistiveDepthProbe.app/YOLOv3FP16.mlmodelc"
curl -fsSL --max-time 60 --max-filesize 74000000 \
  'https://upload.wikimedia.org/wikipedia/commons/e/eb/Dashcam_recording_example_-_Panorama_II_BlackBox_Dashcam_daylight.mp4.ogv' \
  -o "$qa/motion-cases/dashcam-source.ogv"
PYTHONDONTWRITEBYTECODE=1 "$qa/venv/bin/python" scripts/prepare-assist-scene-motion-m3b.py
PYTHONDONTWRITEBYTECODE=1 "$qa/venv/bin/python" scripts/assist_scene_motion_m3b.py \
  --manifest tests/fixtures/assist-scene-motion-m3b-mac.json \
  --sceneqa "$qa/sceneqa" --yolo "$yolo" --output "$qa/motion-m3b-rerun.json"
PYTHONDONTWRITEBYTECODE=1 "$qa/venv/bin/python" scripts/score-assist-scene-motion-m3b.py \
  tests/fixtures/assist-scene-motion-m3b-mac.json "$qa/motion-m3b-rerun.json"
```

Thêm `--case bus-real-pan --dense-detector-diagnostic` và tên output
mới để tái chạy khám nghiệm 25 Hz, chỉ ghi chẩn đoán, không phát hiện
thay cho cổng chính. FFmpeg và OpenCV dùng lại phiên bản đã pin ở M3.
