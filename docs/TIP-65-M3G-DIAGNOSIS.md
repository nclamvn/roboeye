# M3G: nguyên nhân 10/10 lượt tiến gần bị bỏ sót ở M3F

## Phạm vi và cách kiểm

Không chạy lại detector và không đổi tham số. Tái dựng đúng JPEG stage từ ảnh
nguồn đã khóa hash, chạy lại M3E với detection A/B đã ghi trong receipt M3F.
Đọc các biến số của helper khi hàm trả về, không sửa locals hoặc đầu ra.
Sau replay mới nối checkpoint chuẩn để điều tra. Cả 100 khung ở hai nhánh
tái hiện đúng status, events và trackReasons: **0 mismatch**. Đây là chẩn
đoán tập đã thất bại, không phải một phép thử holdout mới.

[Bằng chứng từng ca và lịch sử tối đa 13 khung](evidence/tip65/m3g-diagnosis.json).
Lịch sử IoU đi ngược chỉ là liên kết chẩn đoán, không là định danh ground
truth: khi hai xe cùng lớp ở sát nhau có thể nhảy ứng viên. Các ID và số
đổi ID phải đọc cùng cờ unique, không coi là tỷ lệ ID-switch chuẩn MOT.

## Veto hiện tại của nhánh B

Tất cả 10 lượt có camera status `valid`. Không có bằng chứng cho kết luận
“camera pose không đủ nên tất cả im lặng”.

| Clip / frame 0-based | Đối tượng chuẩn | Veto đầu tiên ở khung hiện tại | Chi tiết xác nhận |
|---|---|---|---|
| city / 13 | người `5b07…` | không có detection cùng nhóm đạt IoU | Không có track người giữ lại, không gọi đây là không có người |
| city / 21 | xe `8994…` | small-or-truncated | Xe đã ở mép hình; không nên lấy ca bị cắt để nới luật |
| city / 21 | người `5b07…` | native-tile-budget | Vùng cần 115 × 221 px, trần mỗi cạnh 192 px |
| city / 28 | người `5b07…` | native-tile-budget | Vùng cần 140 × 268 px |
| city / 36 | xe `4bdb…` | insufficient-object-flow | 16 seed, 16 forward giữ, chỉ 11 photometric/forward-back giữ: 68,75% < 75% |
| city / 44 | xe `e88b…` | object-scale-disagreement | 10/10 seed tốt; bbox log-width +0,055, log-height −0,026, luồng điểm +0,0259 |
| stop / 12 | xe `b8ad…` | native-tile-budget | Vùng cần 206 × 96 px |
| stop / 28 | xe `1559…` | association-ambiguous | Nhiều ứng viên cùng lớp; trước đó chỉ tích được tối đa 2 vote |
| stop / 36 | xe `1559…` | native-tile-budget | Vùng cần 207 × 112 px |
| stop / 43 | xe `1559…` | insufficient-object-flow | Chỉ 5 seed, thấp hơn sàn 9 |

Nhánh A có cùng nhóm lỗi, riêng city/28 là thiếu flow thay vì giới hạn tile:
3 native-tile, 3 thiếu flow, các loại còn lại mỗi loại một lần. Không thay
kết quả 0/10 của M3F bằng một định nghĩa dễ hơn sau khi biết điểm.

## Nguyên nhân gốc có thể kiểm chứng

1. **Biểu diễn crop không khớp hình dạng vật.** Nhánh native được chọn theo
   cạnh ngắn ở ảnh làm việc (<24 px), nhưng vùng hợp nhất cũ/mới bị giới hạn
   cả hai cạnh ≤192 px ở ảnh nguồn. Người cao hoặc xe rộng dễ vừa được chọn
   vào native vừa chắc chắn không lọt tile. Bốn ca trên có đủ ảnh nguồn,
   không phải “không còn chi tiết”. Đây là lỗi phân bổ vùng xử lý, không
   phải lý do phải tăng model hoặc giảm confidence.
2. **Không có chuỗi bằng chứng dài đủ tin cậy.** Phần nhiều trace chỉ có
   0–1 vote, tốt nhất 2 trong khi cần 3. Hễ bất đồng scale/flow thì cấp ID
   mới và xóa vote. Khi `no-current-expansion`, ID còn giữ nhưng history
   cũng bị thay bằng deque rỗng. Ở xe city/44 có một bước được chứng minh
   rồi bước gần phẳng xóa vote; không có cơ chế pooling subpixel qua một
   cửa sổ ổn định. Không giải được việc này chỉ bằng nhận diện ROI thêm hộp.
3. **Hai chiều hộp không phải phép đo scale ổn định.** Ca city/44 có toàn bộ
   điểm ảnh còn bám và fit scale dương, nhưng hộp detector rộng hơn đồng
   thời thấp hơn nên chặn. Nới shape threshold đơn lẻ sẽ tăng rủi ro nhận
   xoay/che khuất thành tiến gần; cần estimator tách deformation, detector
   jitter và scale có uncertainty qua nhiều khung.
4. **Flow không đủ thông tin phải vẫn được phép từ chối.** Hai ca thiếu
   điểm thật không chứng minh rằng bỏ kiểm flow là đúng. Cần so phương án
   chọn điểm/ảnh/cửa sổ khác và đo false positive trên zoom, lia, rung,
   vật biến dạng, cắt cảnh. Không lấy bbox tăng đơn thuần để lấp khoảng trống.

### Kiểm định nghĩa nhãn, không dùng để biện hộ bỏ sót

Nhãn chuẩn là giảm norm camera–tâm vật 3D; optical expansion gần inverse-Z
chỉ khi hình dạng/góc nhìn đủ ổn định. Hai đại lượng không tương đương ở ca
đi ngang và thay đổi viewpoint. Tuy nhiên **cả 10 ca này đều có optical Z
giảm qua cửa sổ đối chiếu**; không có ca range giảm nhưng Z giữ nguyên/tăng.
Vì vậy không thể lấy khác biệt định nghĩa làm lý do xóa các ca dương này.
Inverse-Z lý tưởng tăng 6,7%–65,9% theo cửa sổ LiDAR được chọn; đây chỉ là
giải thích hình học, không phải số mét hoặc scale dự đoán được cấp runtime.

Còn một mismatch về độ nhạy: nhãn dùng giảm range ít nhất 1,8% ở mỗi khoảng
≥300 ms (hoặc 0,22 m khi lớn hơn); thuật toán cần log-scale tổng ≥0,075
trong ≤900 ms và mỗi cặp liên tiếp ≥0,006. Ca nhẹ đạt chuẩn nhãn chưa chắc
đạt sàn quan sát đó. Mismatch này cần được công bố/thiết kế lại, không âm
thầm sửa nhãn hoặc nới sàn sau thử nghiệm.

## Đề xuất thiết kế để đối chiếu, chưa là kết quả chất lượng

- Tách **liên kết đúng vật** khỏi **bằng chứng vật tiến gần**, không cấp ID
  mới chỉ vì một cặp không có expansion; vẫn xóa bằng chứng cảnh báo khi
  occlusion, cut, camera hay identity mơ hồ.
- Xử lý vùng nguồn theo ngân sách pixel và aspect ratio, giữ khả năng phân
  biệt texture, không bắt mọi vật vào một hình vuông nhỏ. Kiểm cả tall/wide.
- So robust temporal angular-scale estimator qua cửa sổ cùng một vật với
  baseline bbox và phương án KLT/dense/template phù hợp. Dùng shape/flow
  disagreement làm uncertainty chứ không gộp mọi nguyên nhân vào một vote
  “có/không” mỗi 80 ms. Vẫn cần current evidence và camera/zoom controls.
- Chốt policy trước replay trên clip mới, đo đồng thời false alarm/miss,
  không coi 0 báo trên cả tập là “an toàn”. Giữ khoảng cách mét tách riêng.

## Tái tạo

```sh
qa="$PWD/native/ios/.build-xcode/scene-qa"
PYTHONDONTWRITEBYTECODE=1 "$qa/venv/bin/python" scripts/diagnose_assist_scene_approach.py \
  --input "$qa/boreas-m3f/input.json" --receipt "$qa/boreas-m3f-receipt.json" \
  --truth "$qa/boreas-m3f/truth-reviewed.json" --source "$qa/boreas-m3f-slice" \
  --output "$qa/m3g-diagnosis-rerun.json"
```

4/4 kiểm thử mới cho arithmetic/matching/trace-boundary đạt. Không chạy
model, không tạo bản sao project, không thay baseline hay app/iPhone.
