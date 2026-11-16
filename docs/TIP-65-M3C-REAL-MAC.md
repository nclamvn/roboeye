# TIP-65 M3C · A/B trên dữ liệu thật, Mac

**Quyết định:** M3C hiện không đạt để tự động báo vật đang di chuyển. Hai bộ, sáu đoạn, 273 ảnh thật. M3C giảm báo nhầm đã ghép từ sáu xuống không trong PandaSet nhưng không bắt được chuyển động đã chấm trên cả hai bộ. Không đưa vào luồng dẫn đường, không đổi tính năng sản phẩm, không suy số mét từ nhãn đối chứng.

## Dữ liệu và quyền sử dụng

| Bộ dữ liệu | Quyền và mức phù hợp với phép đo |
|---|---|
| **Boreas objects-v1** | Nguồn ASRL/UTIAS công bố [CC BY 4.0](https://github.com/utiasASRL/pyboreas/blob/master/DATA_LICENSE.md); [kho gốc AWS](https://registry.opendata.aws/boreas/), [pose và hiệu chuẩn](https://github.com/utiasASRL/pyboreas/blob/master/DATA_REFERENCE.md), [cửa sổ có nhãn liên tiếp](https://github.com/utiasASRL/pyboreas/blob/master/pyboreas/data/splits.py). Tải một lát cắt trực tiếp từ kho nguồn. Giữ ghi công, không phân phối ảnh/nhãn theo báo cáo này. |
| **PandaSet** | [Công bố của nhóm phát hành](https://arxiv.org/abs/2112.12610), [devkit gốc](https://github.com/scaleapi/pandaset-devkit), [mirror ZIP ghim revision](https://huggingface.co/datasets/georghess/pandaset/blob/53f4a13073719592d42a4fbf991e673be2f7cf1e/pandaset.zip). Giấy phép thực tế bên trong archive ghi CC BY 4.0 và điều khoản bổ sung của Scale/Hesai. Người dùng xác nhận thẩm quyền và đồng ý cho R&D nội bộ. Không tải toàn bộ archive. |
| **A2D2 / ZOD** | Có giấy phép cho phép dùng thương mại, nhưng [A2D2](https://arxiv.org/abs/2004.06320) có hộp 3D ở các khung không liên tiếp; các [chuỗi ZOD](https://zod.zenseact.com/sequences/) chỉ gán nhãn khung trung tâm. Không thay thế bộ đối chứng chuyển động nhiều khung ở vòng này. |
| **nuScenes** | Chưa xác nhận quyền R&D thương mại. Không tải, không chạy. [Điều kiện từ Motional](https://www.nuscenes.org/data-format). |

## Thiết kế phép đo

- Chọn 3 đoạn Boreas dài khoảng 4 giây từ tập công khai `obj_train`. Chọn trước khi xem detection/nhãn theo biến thiên lớn nhất của hướng quang trục, tốc độ ghi hình nhỏ nhất và tốc độ lớn nhất trong 15 cửa sổ được cố định trong script. Các mốc UTC µs lần lượt `1598989516069069`, `1598990189106857`, `1598992245041538`. Cùng một chuyến ghi, không huấn luyện hay chỉnh mô hình bằng lát cắt này. Ba đoạn không phải tập test chính thức và không đại diện đủ các tình huống của người đi bộ.
- A là đường M3 RGB có cổng thay đổi tỷ lệ của M3B, B là M3C RGB + pose. Cả hai dùng chung ảnh, độ phân giải cạnh dài 768 px và detection YOLOv3 FP16/Core ML; khác thuật toán bù camera, liên kết và tích lũy bằng chứng. Không có VLM trong vòng thời gian thực và không đưa LiDAR, nhãn 3D hay số mét của dataset vào mô hình.
- Boreas chiếu cuboid LiDAR qua pose riêng và hiệu chuẩn camera, chỉ dùng cặp gần nhất duy nhất (≤60 ms; thực đo tối đa 38,843 ms). Nhãn động/tĩnh suy từ lịch sử tâm 3D theo hệ thế giới và ngưỡng định trước, trạng thái không đủ chắc chắn chuyển `unknown`. Cuboid chiếu không chứng minh vật thể hoàn toàn nhìn thấy: có thể che khuất, sai lệch thời điểm hay hộp lớn hơn silhouette. Scorer giữ riêng những báo không ghép hoặc mơ hồ, không gộp thành nhầm hay đúng.
- Đơn vị: một đối tượng ở một khung có nhãn, không phải một xe/người độc lập hay một sự kiện cảnh báo. Ghép cùng nhóm người/xe, IoU ≥0,35; cạnh tranh hai đối tượng cần chênh ít nhất 0,08. Không kiểm khẳng định “đứng yên” chỉ vì không phát cảnh báo.

## Verify · Boreas

150 ảnh, 60 khung có nhãn ghép, 315 lượt chuyển động, 81 lượt đứng yên, 275 lượt chưa đủ căn cứ. [Biên bản chấm tổng hợp](evidence/tip65/m3c-boreas-real-score.json).

| Chỉ số | M3 RGB | M3C có pose |
|---|---:|---:|
| Báo đúng đang chuyển động | 3/315 | 0/315 |
| Bỏ sót | 312/315 | 315/315 |
| Báo nhầm đã ghép với vật đứng yên | 0/81 | 0/81 |
| Báo không ghép được trên khung có nhãn | 5 | 0 |
| Báo trên vật `unknown` | 1 | 0 |
| Báo ở khung không có nhãn | 11 | 0 |

M3C im trên cả 150 khung; không coi 0 báo nhầm là cải thiện. Lượt chạy lại với phép đo độ phủ detector cho kết quả A/B giống hệt. Không có đầu ra nào xuất số mét. Cả 81 lượt đứng yên tập trung ở một đoạn có camera gần đứng yên, nên phép thử **chưa đủ để kết luận** hiệu quả giảm báo nhầm khi camera di chuyển.

Ba kết quả giúp khoanh vùng lỗi:

1. **Nhận diện hoặc ghép nhãn:** YOLO có ít nhất một box cùng nhóm đủ chồng khớp ở 128/315 lượt động, riêng người là 53/152. Đây là trần độ phủ thô, không phải AP hay số thật về khả năng nhìn thấy, vì đối chứng là cuboid chiếu. Không thể quy tất cả lượt không khớp cho detector.
2. **Camera gần đứng yên:** 49 cặp bị M3C loại vì camera dịch <2,5 cm giữa hai khung; không phải lỗi đồng bộ. Đoạn này có 28 lượt động ghép được YOLO nhưng không lượt nào qua cổng pose. Cần thử chính sách tích lũy trên nhiều khung, nhất là nhánh giới hạn gần quay tại chỗ, có kiểm chứng bằng nền ảnh và không tự suy chuyển động khi thiếu bằng chứng.
3. **Camera chạy:** 75/98 cặp qua kiểm hình học/nền. Riêng đoạn tốc độ cao, 42/44 lượt xe động có box khớp, 33 ở khung qua cổng pose, vẫn 0 báo. Tăng detector hay bỏ cổng pose một mình không giải quyết được đoạn này. Cần phân biệt đứt track với chuyển động gần dọc đường epipolar, một trường hợp mà hình học này ít nhạy.

Hai lần replay trên Mac: p95 YOLO khoảng 60–134 ms/ảnh (lượt hai chạy đồng thời với tác vụ đọc lát cắt); xử lý A 20–25 ms, B 73–81 ms, đo riêng từng khâu. Không cộng các p95 thành p95 đầu-cuối và không ngoại suy sang kính/điện thoại.

## Verify · PandaSet

123 ảnh camera trước, 41 ảnh đầu tiên ở mỗi chuỗi `001`, `002`, `011` được chốt trước kết quả. Trích theo byte-range, không tải ZIP 44,5 GB: 258 thành viên, khoảng 32 MB dữ liệu nguồn. Bộ chuyển giải mã bảng cuboid bằng allowlist trong sandbox, xuất JSON tối thiểu. Giấy phép trong ba chuỗi trùng nhau, SHA-256 `b198d2cb6ce184a0cc586ffd4513dd7e9060b0e10686b94768c845f8b94cdcf7`. Ghi công: *PandaSet: Advanced Sensor Suite Dataset for Autonomous Driving*, Scale AI và Hesai, [Xiao et al.](https://arxiv.org/abs/2112.12610).

Chỉ dùng cuboid đơn, bỏ 2.817 cặp cuboid kép không có mốc riêng cho phép chiếu theo đúng thời điểm. Độ lệch RGB–LiDAR khoảng 50 ms (tối đa 49.879 µs), không khẳng định vị trí vật trùng tuyệt đối. Theo devkit, dùng nhãn chuyển động từng khung khi có; `stationary` là nhãn đứng yên cả đoạn, không biến `false` thành `moving`. Kết quả chỉ có nhãn động/tĩnh đã chiếu đủ điều kiện ở nhóm xe. Lát cắt này phù hợp hơn để kiểm báo nhầm trên xe đứng yên khi camera dịch chuyển: quãng đường theo pose trong ba đoạn lần lượt khoảng 37,8 m, 2,7 m và 34,9 m. Đây là thông tin đối chứng, không phải output khoảng cách của app. 41 lượt động đều từ một chuỗi và không lượt nào có box cùng nhóm đủ IoU, nên không thể dùng lát cắt này để tách lỗi detector khỏi lỗi chiếu hoặc đánh giá độ nhạy riêng của cổng pose.

| Chỉ số | M3 RGB | M3C có pose |
|---|---:|---:|
| Bỏ sót | 41/41 | 41/41 |
| Báo nhầm đã ghép với vật đứng yên | 6/3.573 | 0/3.573 |
| Báo không ghép được trên khung có nhãn | 71 | 8 |

Không có số mét trong toàn bộ 546 đầu ra A/B của hai bộ. Kết quả PandaSet có [biên bản chấm tổng hợp](evidence/tip65/m3c-pandaset-real-score.json). Không cộng thành tỷ lệ an toàn chung: phân bố độ khó, mốc thời gian và cách gán trạng thái của hai bộ khác nhau.

## Việc nên kiểm trước phiên bản tiếp theo

1. Khóa một tập mới, có ca đứng yên khi camera dịch chuyển, người/xe thật đang đến gần và đi ngang, cùng ca khuất một phần. Kiểm một tập con bằng hộp 2D đã được xác minh. Đo cả theo sự kiện, theo target-keyframe và báo không ghép được; không nhận 0 báo nhầm với 0 báo đúng là đạt.
2. Trên đúng track có hộp, chạy hai ablation nhỏ riêng: tích lũy pose nhiều khung cho camera gần tĩnh; chấm tiếp cận theo thay đổi kích thước/điểm cùng vật khi đường epipolar không phân biệt được. So với M3 chưa đổi, giữ nguyên đường im lặng khi thiếu dữ kiện và không xuất khoảng cách.
3. Chỉ sau khi có bao phủ đối chứng rõ mới thử detector khác trên cùng ảnh. Đo độ phủ và độ trễ riêng với khâu chuyển động; không đưa VLM vào vòng báo nhanh.

## Tái chạy

Tái dùng venv, SceneQA và Core ML cục bộ. Không cần iPhone, không upload dữ liệu. Đầu ra phải là đường dẫn mới; lưu lát cắt và receipt chi tiết trong build cache đã được Git bỏ qua. Mỗi lượt runner tự xóa ảnh JPEG trung gian. Không thêm môi trường hay mô hình.

```sh
qa="$PWD/native/ios/.build-xcode/scene-qa"
export PYTHONDONTWRITEBYTECODE=1
py="$qa/venv/bin/python"
yolo="$PWD/native/ios/.build-xcode/Build/Products/Release-iphoneos/AssistiveDepthProbe.app/YOLOv3FP16.mlmodelc"
"$py" scripts/fetch-assist-scene-boreas-slice.py --output "$qa/boreas-slice"
"$py" scripts/assist_scene_boreas_import.py --dataset-root "$qa/boreas-slice" \
  --clip-manifest "$qa/boreas-slice/clips.json" --output-dir "$qa/boreas-m3c"
"$py" scripts/assist_scene_motion_m3c.py --input "$qa/boreas-m3c/input.json" \
  --sceneqa "$qa/sceneqa" --yolo "$yolo" --output "$qa/boreas-receipt.json"
"$py" scripts/score-assist-scene-motion-m3c.py --input "$qa/boreas-m3c/input.json" \
  --truth "$qa/boreas-m3c/truth.json" --receipt "$qa/boreas-receipt.json"
"$py" -m unittest discover -s tests -p 'test_assist_scene_*.py'
```

PandaSet chỉ tái chạy sau khi xác nhận quyền nội bộ. Trích chọn file với `fetch-assist-scene-pandaset-slice.py --terms-accepted --output ... --sequence 001 --sequence 002 --sequence 011 --frames 41`, chạy `convert-assist-scene-pandaset-labels.py <slice>` trong sandbox rồi `assist_scene_pandaset_import.py --dataset-root <slice> --output-dir <manifests> --license-verified --clip 001:0:40 --clip 002:0:40 --clip 011:0:40`. Chạy detector và scorer giống Boreas. Không dùng kho không rõ quyền, không bung ZIP vào `/tmp`.

Verify theo Vibecode Kit: 88/88 kiểm thử Python liên quan đạt; `git diff --check` sạch. Hai lần Boreas xác nhận sai số chấm giống nhau; PandaSet chạy một lần với input đã được hash, giữ nguyên input khi trình nhập bổ sung dấu `-` làm sentinel cho nhãn đơn. Không dùng nuScenes, iPhone hay API bên ngoài để inference; không commit/push/deploy. Lát cắt giữ local, không có thư mục JPEG tạm còn lại sau runner.

Ghi công: *Boreas: A Multi-Season Autonomous Driving Dataset*, Autonomous Space Robotics Laboratory, University of Toronto Institute for Aerospace Studies và các đồng tác giả, [bài công bố](https://arxiv.org/abs/2203.10168), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Dữ liệu đối chứng đã được chọn theo lát thời gian, ảnh thu nhỏ để inference, cuboid chiếu sang ảnh để chấm; không ngụ ý sự chứng thực từ tác giả.
