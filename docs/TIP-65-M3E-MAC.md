# TIP-65 M3E · Giữ chi tiết và nối lại vật sau một khung mất dấu

## TIP trước replay

- Chỉ chạy trên Mac. A là M3D `ScaleApproach` giữ nguyên; B giữ pixel gốc cho hộp nhỏ và nối lại khi detector hụt tối đa một khung. Hai ablation chỉ bật từng phần. Tất cả dùng cùng hộp YOLOv3/Core ML và cùng đồng hồ, pose, căn chỉnh và kiểm cảnh. Đối chứng chỉ dùng kích thước hộp S là chẩn đoán, không được bật trong app. Không dùng LLM trực tiếp cho A/B này: chưa đo một LLM có cùng hộp, pose và hợp đồng theo từng khung.
- B chỉ phát “tiến lại gần tương đối” nếu có bằng chứng mới ở khung hiện tại. Không suy ra mét, thời gian tới va chạm, vật tự chuyển động, hay chỉ dẫn di chuyển. Không phát báo trong khung mất dấu hoặc chính khung vừa nối. Không nới luật cho vật chạm mép, cắt cảnh, zoom hoặc liên kết mơ hồ. Tắt nhánh nếu thiếu dữ liệu đáng tin.
- Dữ liệu: hai đoạn mới của Boreas objects-v1, anchor `1598987772079070` (đang di chuyển và đổi hướng), `1598991312015344` (camera gần đứng yên), chọn theo cadence và pose, không trùng M3C/M3D. Mỗi đoạn khoảng 4 giây. Nhãn LiDAR/pose dùng ngoài runtime để đề xuất 2D và xác định tiến gần; kiểm trực quan chỉ ở checkpoint. Tập đối chứng riêng từ ảnh thật với phép biến đổi đã biết: đứng yên, zoom, lia, rung, tăng kích thước riêng mục tiêu, và hụt detector một khung có kiểm soát. Không gộp số thật với số dàn dựng.
- Chấm A/B theo lượt mục tiêu tại một khung; báo nhầm có nhãn, bỏ sót, báo không ghép được, báo ở khung chưa có nhãn tách riêng. Với clip đối chứng âm, ghi cả tổng báo ngoài mục tiêu: toàn cảnh được giữ tĩnh hoặc chỉ đổi góc/zoom. Đo khả năng nối lại đúng ID tại gián đoạn đã biết, không suy ID thật từ độ liên tục của ID dự đoán. Ghi p95 và kiểm mọi kết quả đều không có mét. Khóa cấu hình trước replay, không chỉnh tham số theo tập đã xem. Không nối app, cài iPhone hay triển khai.

## Verify

**Đã chạy A/B trên Mac; chưa đạt để bật cảnh báo.** B giữ được điểm ảnh gốc và đôi lúc giữ được ID qua một khung hụt, nhưng chưa giảm bỏ sót so với A. Không chỉnh ngưỡng sau khi xem kết quả; nhánh B chỉ tồn tại trong replay.

| Bằng chứng | A · M3D | B · ảnh gốc + nối lại | S · chỉ kích thước hộp |
|---|---:|---:|---:|
| Hai clip Boreas thật: phát hiện / 9 lượt tiến gần | 0/9 | 0/9 | 5/9 |
| Hai clip Boreas thật: bỏ sót / 9 lượt tiến gần | 9/9 | 9/9 | 4/9 |
| Hai clip Boreas thật: báo nhầm / 8 lượt không tiến gần | 0/8 | 0/8 | 0/8 |
| Đối chứng dựng: phát hiện / 13 lượt tiến gần | 0/13 | 0/13 | 2/13 |
| Đối chứng dựng: bỏ sót / 13 lượt tiến gần | 13/13 | 13/13 | 11/13 |
| Đối chứng dựng: báo nhầm / 144 lượt không tiến gần có nhãn | 0/144 | 0/144 | 23/144 |

- **Clip thật:** 100 khung, 10 mốc đối chiếu trực quan trước replay, giữ 22/28 hộp, 5 hộp giữ lại có trạng thái tiến gần chưa xác định; các mốc không phải sự kiện độc lập. A và B có cùng một báo ở khung thứ 7 của clip đổi hướng, ngoài tập đối chiếu nên không tính đúng/sai; S có 9 báo không ghép được ở mốc đã chấm và 125 báo ở mốc chưa chấm. Hai ablation cho cùng số đúng, sai và bỏ sót như A/B. Không dùng 0/8 để tuyên bố an toàn.
- **Đối chứng dựng:** 80 khung, từ một ảnh đường phố thật đã khóa hash. Có 4 clip âm toàn cảnh (đứng yên, zoom số toàn ảnh không báo đổi nội tham, lia, rung theo homography), một clip dương phóng riêng vùng xe nhỏ và bỏ toàn bộ hộp nhận diện đúng một khung ở đầu vào tracker. A/B im lặng trong toàn bộ 64 khung clip âm. S có 54 báo nhầm trong clip zoom: 23 khớp mục tiêu âm đã vẽ, 31 không ghép với hai hộp nhưng toàn cảnh vẫn là âm theo cách dựng. Hai clip lia/rung không phải quay tay thật; không suy rộng sang rolling shutter, lấy nét, EIS hoặc zoom quang thật.
- **Ảnh gốc:** B cho chạy 182 phép thử vùng nhỏ trên hai clip thật, có 4 cặp đủ bằng chứng giãn nở (không đồng nghĩa 4 lượt mục tiêu đã kiểm), chưa bù được các lỗi khác. Trong 9 lượt tiến gần thật đã kiểm, 8 có hộp YOLO cùng nhóm chồng khớp, nhưng 5/8 bị chặn vì ghép/che khuất không rõ hoặc hộp trước không đủ tin cậy, 2/8 do hộp bất đồng với luồng điểm và 1/8 do nền không đủ tin cậy. Trên mục tiêu nhỏ dựng, ở 6/13 lượt B vượt qua chặn kích thước để vào kiểm điểm ảnh nhưng không đủ điểm đáng tin; 5/13 không có hộp YOLO đạt IoU, 1/13 là khung bỏ detection có chủ đích, 1/13 là lượt vừa quay lại chưa ghép.
- **Giữ ID:** B không nối được xe nhỏ chính trong ca hụt 180 ms (ID 26 → 31; A: 34 → 42), và không nối thành công lần nào trên hai clip tự nhiên. B nối lại 3 track khác ở đối chứng dựng; đối chiếu thủ công sau chạy cho thấy một xe bạc rõ là cùng xe (B: 1 → 1; A: 1 → 38), một hộp xa không đủ rõ để xác minh, một hộp là nắp ca-pô xe camera bị YOLO gán nhãn xe. Không tính ba track này là ba lần nối đúng. Không có báo trong khung mất hoặc khung vừa nối.
- **Chi phí:** Mac arm64, OpenCV 5.0.0 và cùng YOLOv3 FP16/Core ML, không gọi API inference. Trên clip thật, p95 riêng nhánh A 27,67 ms, B 29,12 ms; p95 B cộng công giải mã lại PNG gốc là 95,77 ms, chưa gồm detector (p95 đo riêng 93,00 ms) hoặc chuẩn bị ảnh chung. Không cộng các p95 để suy ra độ trễ đầu-cuối. Nếu sau này có buffer ảnh gốc trực tiếp, phép đo hiện tại không dự báo được độ trễ iPhone.
- **Verify:** 124/124 kiểm thử Assist Scene, `git diff --check` đạt. Kiểm 900 đầu ra nhánh–khung, trường mét đều `null`, không có TTC. Không thay runtime app, không cài thiết bị hay deploy. Không có người dùng hoặc con người duyệt nhãn trong vòng này. **NOT READY** cho cảnh báo.

### Quyết định

Giữ thử nghiệm offline, không nới ngưỡng vùng ảnh hay liên kết để lấy điểm đẹp. Nếu tiếp tục, ưu tiên kiểm detector trên ROI ảnh gốc **trước** bước nối ID, và tách hộp nhầm ca-pô, hộp bị cắt, cặp xe cạnh nhau. Dùng ca thật có định danh liên tục và camera cầm tay, chấm đồng thời tỷ lệ nối sai/đúng và cảnh báo nhầm/bỏ sót; phần nối hiện tại không nên được coi là sửa được nhận diện.

### Bằng chứng và tái tạo

[Boreas objects-v1 / giấy phép của đơn vị phát hành](https://github.com/utiasASRL/pyboreas/blob/master/DATA_LICENSE.md), [bài báo Boreas](https://arxiv.org/abs/2203.10168); biến thể thử nghiệm lấy từ ảnh đã resize, crop/warp và ghi nhãn 2D, không ngụ ý tác giả chứng thực. Lát cắt gốc 330.351.126 byte, không tải cả archive; giữ raw và receipts trong cache cục bộ bỏ qua bởi Git. [OpenCV: Lucas–Kanade/điểm Shi–Tomasi](https://docs.opencv.org/4.x/d4/dee/tutorial_optical_flow.html) là mô tả thuật toán, không phải bằng chứng chất lượng dự án. Mã B khóa `3bfaac464710becaffa3590ffcf59ea8195f5e7ba2f57c874bd8138988fb3f2b`; A không đổi.

- [Kết quả clip thật](evidence/tip65/m3e-boreas-score.json) và [quyết định kiểm nhãn 2D](evidence/tip65/m3e-boreas-reviewed-2d.json).
- [Kết quả đối chứng](evidence/tip65/m3e-controls-score.json); hash hai đầu vào và receipt trong mỗi báo cáo.

```sh
qa="$PWD/native/ios/.build-xcode/scene-qa"
export PYTHONDONTWRITEBYTECODE=1
py="$qa/venv/bin/python"
src="$qa/boreas-m3e-slice"
dst="$qa/boreas-m3e"
rev="$qa/boreas-m3e-review"
ctrl="$qa/boreas-m3e-controls"
yolo="$PWD/native/ios/.build-xcode/Build/Products/Release-iphoneos/AssistiveDepthProbe.app/YOLOv3FP16.mlmodelc"
"$py" scripts/fetch-assist-scene-boreas-slice.py --study m3e --output "$src"
"$py" scripts/assist_scene_boreas_import.py --dataset-root "$src" --clip-manifest "$src/clips.json" --output-dir "$dst"
"$py" scripts/assist_scene_boreas_review_2d.py build "$src" "$dst/input.json" "$dst/truth.json" "$rev"
"$py" scripts/assist_scene_boreas_review_2d.py bind "$rev/candidates.json" docs/evidence/tip65/m3e-boreas-reviewed-2d.json "$dst/truth-reviewed.json"
"$py" scripts/assist_scene_m3e_controls.py --source-root "$src" --output "$ctrl"
"$py" scripts/assist_scene_m3e_study.py replay --input "$dst/input.json" --sceneqa "$qa/sceneqa" --yolo "$yolo" --output "$qa/boreas-m3e-receipt.json"
"$py" scripts/assist_scene_m3e_study.py score --input "$dst/input.json" --truth "$dst/truth-reviewed.json" --receipt "$qa/boreas-m3e-receipt.json" --output "$qa/m3e-real-score.json"
"$py" scripts/assist_scene_m3e_study.py replay --input "$ctrl/input.json" --sceneqa "$qa/sceneqa" --yolo "$yolo" --output "$qa/boreas-m3e-controls-receipt.json"
"$py" scripts/assist_scene_m3e_study.py score --input "$ctrl/input.json" --truth "$ctrl/truth.json" --receipt "$qa/boreas-m3e-controls-receipt.json" --output "$qa/m3e-controls-score.json"
"$py" -m unittest discover -s tests -p 'test_assist_scene_*.py'
```
