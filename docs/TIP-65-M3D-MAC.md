# TIP-65 M3D · Theo dõi tiến gần qua nhiều khung

## TIP / phạm vi

- Chạy replay Mac, dùng chung ảnh và detection YOLOv3/Core ML. A: M3 RGB; B: M3C pose từng cặp; C: pose qua cửa sổ thời gian dài hơn; D: bằng chứng co giãn vùng vật thể. C và D được kiểm riêng. “Vật đang chuyển động trong hệ thế giới” và “vật/camera đang tiến lại gần nhau” là hai đầu ra khác nhau, không cộng lẫn.
- D chỉ xác nhận thay đổi kích thước khi cùng vật, ảnh không mất và có đối chứng chất lượng camera. Không suy vật tự chạy, va chạm, thời gian va chạm hay số mét. C im lặng khi không xác minh được pose và ghép điểm; D im lặng khi zoom, che khuất hay mất track làm bằng chứng mơ hồ.
- Bộ chấm riêng: ba cửa sổ Boreas khác lần M3C, start UTC µs `1598986289111738`, `1598989277032742`, `1598989992068558`. Chọn trước khi chạy mô hình; đổi ứng viên `1598988939059928` chỉ vì cadence 25 Hz không khớp quy cách replay đã chọn (~12,5 Hz). Hộp 3D chỉ làm đề xuất/căn cứ hình học; ô được đưa vào bộ chấm lõi phải kiểm bằng mắt trên khung RGB trước kết quả. LiDAR chỉ dùng để phân biệt nhãn tiến gần tương đối và nhãn tự chuyển động trong bộ chấm. Giữ ngay cả trường hợp detector không bám. Đo báo không ghép được và ô không rõ riêng, không coi là đúng.
- Đối chứng riêng cho D: chỉ nhìn độ tăng hai chiều của bbox trong một track, không dùng điểm ảnh. Đối chứng mô hình ngôn ngữ trực tiếp chưa đo vì không cung cấp cùng track/điểm ảnh/pose có ràng buộc và không nằm trong vòng cảnh báo nhanh này. Không lấy benchmark nhỏ làm chứng nhận. Không cài iPhone, không phát hành, không dùng nuScenes.

## Verify

**Thử nghiệm Mac hoàn tất; thuật toán chưa đạt để bật cảnh báo.** Không nhánh mới nào phát báo trên 150 khung thật; không lấy 0 báo nhầm làm bằng chứng tiến bộ. Không thay code app hoặc chính sách cảnh báo mặc định.

| Đầu ra chấm riêng | Nhánh | Báo đúng | Bỏ sót | Báo nhầm có nhãn | Báo ở khung đã kiểm nhưng không ghép được |
|---|---|---:|---:|---:|---:|
| Vật tự chuyển động | A · M3 RGB | 2/32 | 30/32 | 0/1 | 0 |
| Vật tự chuyển động | B · M3C pose từng cặp | 0/32 | 32/32 | 0/1 | 0 |
| Vật tự chuyển động | C · pose tích lũy | 0/32 | 32/32 | 0/1 | 0 |
| Tiến gần tương đối | S · bbox đơn thuần | 7/25 | 18/25 | 0/8 | 9 |
| Tiến gần tương đối | D · bbox + luồng điểm + kiểm camera | 0/25 | 25/25 | 0/8 | 0 |

Đơn vị là **lượt đối tượng tại một khung**, không phải đối tượng hay sự kiện độc lập. 15 khung được kiểm mù với kết quả mô hình, 39/51 hộp xác nhận thuộc 21 ID; 12 bị loại do che, tối hoặc không nhận rõ. Hộp do các agent đối chiếu trực quan và chỉnh đến vùng thật, không có xác minh con người, không gán nhãn mọi vật. Chấm đúng nhóm người/xe, IoU ≥0,35, độ chênh khi có ứng viên thứ hai ≥0,08. Có sáu mẫu `unknown` mỗi loại đầu ra (không nhất thiết cùng đối tượng). 135 báo S và 20 báo A nằm ngoài 15 khung được kiểm, thêm một báo S ở đích `unknown`; **không** tự động tính là báo nhầm. 750 đầu ra trên cả năm nhánh đều không có mét, không có nguồn đo được đưa vào inference.

### Những gì số liệu thực sự bác bỏ

- **Tích lũy pose chưa thêm giá trị trên tập này.** C dùng một cặp dài 180–300 ms đã kiểm lại theo nền, cần hai khoảng tách nhau với dấu dịch chuyển nhất quán và còn bằng chứng ở khung hiện tại. Có 121/150 khung qua kiểm pose/cặp dài nhưng không tạo báo. Có 27/32 lượt động có hộp YOLO cùng nhóm chồng khớp. Các đoạn mới là camera hành trình đang đi, không đủ kiểm đúng ca camera rất chậm; tích lũy đủ baseline khi từng bước quá nhỏ đã chứng minh bằng fixture tổng hợp, chưa chứng minh trên clip thật khác.
- **Bằng chứng tiến gần hiện quá khắt khe.** 19/25 lượt tiến gần có box chồng khớp. Ở 9 lượt trong số đó, track ghép gần nhất nhận `small-or-truncated` (gồm cạnh hộp dưới 24 px sau resize hoặc chạm biên). Năm lượt mất ghép/cấp track mới, ba lượt thiếu hoặc không nhất quán luồng điểm, hai lượt có một bước giãn nhưng chưa đủ cả chuỗi. Sáu lượt không có hộp cùng nhóm đạt IoU. Vì vậy không quy mọi ca bỏ sót cho một ngưỡng hoặc cho riêng YOLO. D vẫn veto khi zoom, che/mất track hay nền bất nhất; không tự gán “đang đứng yên” nếu không có báo.
- **S dùng được làm đối chứng, không phải fallback phát cho người dùng.** S chỉ nhìn hai chiều bbox trên track liên kết IoU, không xác minh điểm ảnh hoặc camera. Tập này chỉ có 8 nhãn đối chứng “không tiến gần”, 1 nhãn “vật đứng yên”, cùng chuyến ghi. Không đủ để công bố tỷ lệ báo nhầm ngoài thực tế, kiểm cảnh cầm tay hay hiệu năng người đi bộ. Chưa có thước đo theo sự kiện hoàn chỉnh; cần nhãn liên tục trước khi đo chỉ số đó.

Độ trễ p95 từng phần trên Mac: YOLO 188 ms, M3C 54,9 ms, pose dài 88,8 ms, nhánh tiến gần 26,8 ms; chạy replay nhiều lane, không phải độ trễ đầu-cuối hoặc dự báo điện thoại. Mốc p50/p95 cùng chấm theo clip trong [receipt tổng hợp](evidence/tip65/m3d-boreas-2d-score.json). Không có phí API inference, chưa đo công người.

### Tái tạo và bước tiếp

Nguồn dữ liệu: *Boreas: A Multi-Season Autonomous Driving Dataset*, ASRL/UTIAS, [Burnett et al.](https://arxiv.org/abs/2203.10168), [CC BY 4.0 từ đơn vị phát hành](https://github.com/utiasASRL/pyboreas/blob/master/DATA_LICENSE.md). Lát cắt nguồn 599.273.588 byte; giữ ảnh và nhãn thô trong cache bỏ qua bởi Git. Đổi cỡ để inference/đối chiếu, hiệu chỉnh 2D, suy nhãn tiến gần từ giảm khoảng cách tâm tương đối ở hai khoảng ≥300 ms (chỉ bộ chấm dùng); không ngụ ý tác giả chứng thực. Lệch lớn nhất RGB/LiDAR 44.155 µs. Đầu ra tổng hợp liên kết SHA-256 đến [quyết định kiểm 2D](evidence/tip65/m3d-boreas-reviewed-2d.json), manifest đầu vào và receipt thực chạy.

```sh
qa="$PWD/native/ios/.build-xcode/scene-qa"
export PYTHONDONTWRITEBYTECODE=1
py="$qa/venv/bin/python"
src="$qa/boreas-m3d-slice"
dst="$qa/boreas-m3d"
rev="$qa/boreas-m3d-review"
yolo="$PWD/native/ios/.build-xcode/Build/Products/Release-iphoneos/AssistiveDepthProbe.app/YOLOv3FP16.mlmodelc"
"$py" scripts/fetch-assist-scene-boreas-slice.py --study m3d --output "$src"
"$py" scripts/assist_scene_boreas_import.py --dataset-root "$src" --clip-manifest "$src/clips.json" --output-dir "$dst"
"$py" scripts/assist_scene_boreas_review_2d.py build "$src" "$dst/input.json" "$dst/truth.json" "$rev"
"$py" scripts/assist_scene_boreas_review_2d.py bind "$rev/candidates.json" \
  docs/evidence/tip65/m3d-boreas-reviewed-2d.json "$dst/truth-reviewed.json"
"$py" scripts/assist_scene_m3d_study.py replay --input "$dst/input.json" --sceneqa "$qa/sceneqa" --yolo "$yolo" --output "$qa/boreas-m3d-receipt.json"
"$py" scripts/assist_scene_m3d_study.py score --input "$dst/input.json" --truth "$dst/truth-reviewed.json" --receipt "$qa/boreas-m3d-receipt.json" --output "$qa/boreas-m3d-score.json"
"$py" -m unittest discover -s tests -p 'test_assist_scene_*.py'
```

Verify Vibecode: đã triển khai và test cả hai nhánh, A/B độc lập theo hai ý nghĩa, giữ mẫu âm/unknown, không xuất mét; 115/115 kiểm thử liên quan và `git diff --check` đạt. Inference chạy cục bộ trên Mac; chưa nối app, cài iPhone hay deploy. **NOT READY** cho cảnh báo. Bước có giá trị nhất là lập tập đối chứng mới đủ ca gần tĩnh, đứng yên và zoom/lia/rung, rồi thử tăng độ phân giải riêng vùng box nhỏ, đo độ bám lại cùng vật và đối chiếu S trong cả ca tiến gần lẫn ca âm. Không nới ngưỡng trên tập đã xem để làm đẹp số.
