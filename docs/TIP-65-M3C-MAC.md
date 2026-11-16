# TIP-65 M3C · RGB và pose camera đồng bộ

Mục tiêu: kiểm chứng trên Mac liệu biết chuyển động camera có giảm bỏ sót
mà không thêm báo nhầm khi so với M3 (RGB). Không đưa nhãn 3D vào thuật toán
và không suy ra số mét từ camera. Không mở iPhone, tài khoản hay deploy.

## Cổng trước khi chạy

1. Chỉ nhập nuScenes từ tập chính thức có quyền dùng cho mục đích R&D này.
   [Motional ghi rõ giới hạn dùng miễn phí và cách xin quyền thương mại](https://www.nuscenes.org/data-format).
   Không coi URL tải công khai là giấy phép. Không đăng nhập, chấp nhận điều
   khoản thay người dùng, tải qua mirror hay suy diễn quyền thương mại.
2. Tách ảnh, camera pose/kích thước/hiệu chuẩn khỏi nhãn 3D. A dùng M3 RGB
   và cổng quy mô ảnh của M3B; B dùng đúng ảnh/detection nhưng thêm hình học
   pose. Với camera tịnh tiến, điểm vật tĩnh phải gần đường epipolar, không
   cần biết độ sâu. Không xem điểm gần đường là bằng chứng vật đứng yên.
   Chuyển động dọc đường epipolar có thể không quan sát được; thiếu nền kiểm
   pose, track mơ hồ, điểm mất/che, pose thiếu hoặc sai thời gian thì không báo.
3. Dùng token và mốc camera chính xác để chấm. Chỉ chấm keyframe có nhãn
   3D đủ rõ; bỏ khỏi mẫu trạng thái unknown/che/méo chiếu. Báo mà không
   ghép được nhãn đưa vào đếm riêng, không tự coi đó là báo sai hay đúng.
   Đếm theo target-keyframe cho cả hai; cửa sổ giữ nguyên trước thử.
4. Phân biệt synthetic geometry, detector thật, dataset thật. Không kết
   luận hiệu năng trên nuScenes nếu thiếu dữ liệu có quyền.

## Verify · Mac

**Pipeline QA đã chạy; benchmark nuScenes chưa chạy.** Người sở hữu dự án
chưa xác nhận quyền. Không tải, mở hay chấm nuScenes; không mở iPhone.

| Cảnh tổng hợp | M3 RGB | M3C có pose |
|---|---:|---:|
| Xe tĩnh, camera tịnh tiến, hai lớp sâu | 1/9 báo nhầm | 0/9 báo nhầm |
| Xe chạy cắt ngang đường epipolar | 8/9 đúng | 9/9 đúng |
| Xe chạy dọc đường epipolar | 4/9 đúng | 0/9 đúng |
| Xe chạy, không có pose | 8/9 đúng | 0/9 đúng; 23/23 khung im lặng |
| Tổng bỏ sót | 7/27 | 18/27 |

Tổng 92 ảnh, 36 target-keyframe được chấm. 184 đầu ra RGB × lane không có
số mét. Dùng đúng một lần kết quả YOLOv3 FP16 thực cho mỗi ảnh ở cả A và
B. Pose, khoảng cách giữa các lớp và chuyển động vật do chương trình dựng;
hình dùng chất liệu từ ảnh Shibuya của Basile Morin, CC BY-SA 4.0, theo
[M2B](TIP-65-M2B-QWEN-MAC.md), không phải video xe thật. Không dùng số
tổng để che đánh đổi: B giảm báo nhầm ở ca thị sai, nhưng bỏ sót thêm
ngoài điều kiện quan sát được. B không chứng minh rằng xe đứng yên.
[Điểm theo từng ca](evidence/tip65/m3c-mac-synthetic-score.json).

B kiểm pose hợp lệ/đồng bộ, so với luồng điểm vùng nền ngoài box; khi
camera tịnh tiến dùng khoảng cách hai chiều tới đường epipolar. Mỗi báo
đòi hỏi điểm nội vùng cùng đối tượng, ghép không mơ hồ và đủ số cặp liên
tiếp. Cộng sai số nền quan sát vào mức sàn; đây không phải khoảng tin cậy
hay bảo đảm chống thị sai/camera rolling shutter. A dùng căn nền RGB và
quy tắc chặn đổi tỷ lệ của M3B. Hai lane dùng cùng ảnh và detector,
khác khâu ổn định/ghép bằng chứng, không phải ablation chỉ đổi một hệ số.
Không tự rơi về A khi B thiếu pose.

Lượt đầu synthetic đã chỉ ra một lỗi tích hợp: yêu cầu 320 điểm trong
khi hàm hình học chỉ chấp nhận ≤256. Sửa bằng cách dùng chung ngân sách
điểm; giữ ảnh và nhãn. Biên bản local:
`native/ios/.build-xcode/scene-qa/m3c-synthetic-replay.json` (trước sửa)
và `m3c-synthetic-v2.json` (bảng trên). Đã kiểm 71/71 Python.
Chưa dùng M3C để phát cảnh báo hay chạy sản phẩm.

## Chạy trên Mac

Dùng lại venv SceneQA và YOLO trong [M3](TIP-65-M3-MAC.md). Tái tạo
fixture tổng hợp nếu muốn chạy lại (chọn đường dẫn output chưa tồn tại):

```sh
qa="$PWD/native/ios/.build-xcode/scene-qa"
export PYTHONDONTWRITEBYTECODE=1
py="$qa/venv/bin/python"
yolo="$PWD/native/ios/.build-xcode/Build/Products/Release-iphoneos/AssistiveDepthProbe.app/YOLOv3FP16.mlmodelc"
"$py" scripts/prepare-assist-scene-motion-m3c.py "$qa/qwen-cases/crossing-0.jpg" "$qa/m3c-rerun"
"$py" scripts/assist_scene_motion_m3c.py --input "$qa/m3c-rerun/input.json" \
  --sceneqa "$qa/sceneqa" --yolo "$yolo" --output "$qa/m3c-rerun-receipt.json"
"$py" scripts/score-assist-scene-motion-m3c.py --input "$qa/m3c-rerun/input.json" \
  --truth "$qa/m3c-rerun/truth.json" --receipt "$qa/m3c-rerun-receipt.json"
"$py" -m unittest discover -s tests -p 'test_assist_scene_*.py'
```

Sau khi có quyền và có **bản chính thức đã giải nén ở local**, dùng bộ nhập
chỉ định 2–5 cảnh khác nhau. Chốt đoạn và ca dương/âm trước kết quả; các
scene ID và khoảng dưới đây minh họa cú pháp, chưa phải xác nhận có ca
xe buýt hoặc che khuất ở đúng giây đó.

```sh
"$py" scripts/assist_scene_nuscenes_import.py --license-verified \
  --dataset-root "$dataset" --output-dir "$qa/m3c-official" \
  --clip scene-0061:0:6 --clip scene-0103:2:8
```

Dùng `m3c-official/input.json` chạy inference như trên, sau đó mới đưa
`m3c-official/truth.json` cho scorer. Ghép keyframe theo token/mốc
camera, nhãn global 3D chỉ dùng ở bước chấm. Trích xuất pose từ
`ego_pose` và hiệu chuẩn; pose định vị đã xử lý của dataset không đồng
nghĩa thiết bị thật đã có gyro/pose đúng chất lượng. Cổng tiếp theo:
phải đo được cả cửa sổ có vật chuyển động và vật đứng yên khi camera
di chuyển, cùng các báo không ghép được; không tuyên bố cải thiện nếu
thiếu cohort độc lập hoặc nếu tỷ lệ bỏ sót tăng quá mức.

Nguồn cấu trúc: [nuScenes devkit schema](https://github.com/nutonomy/nuscenes-devkit/blob/master/docs/schema_nuscenes.md),
[giới thiệu cách gắn pose và nhãn 2 Hz](https://www.nuscenes.org/tutorials/nuscenes_tutorial.html),
[hình học epipolar OpenCV](https://docs.opencv.org/4.13.0/d9/d0c/group__calib3d.html).
