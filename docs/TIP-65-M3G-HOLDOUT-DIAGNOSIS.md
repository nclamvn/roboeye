# TIP-65 M3G: chẩn đoán hậu kiểm holdout thật

## Kết luận

Chưa đạt mục tiêu phát hiện vật tiến gần. Trên 10 **target-checkpoint dương tính**
được giữ nguyên nhãn, B (LK cumulative) đạt 0/10, D (DIS cumulative) đạt 1/10.
Đây không phải 10 episode độc lập: một vật có thể xuất hiện ở nhiều checkpoint.
Kết quả không được đổi thành thành công chỉ vì không phát cảnh báo sai trên
8 target-checkpoint âm tính đã xét. Các báo cáo ngoài checkpoint có nhãn vẫn
chưa được phân xử, không được coi mặc định là đúng hoặc sai.

Toàn bộ 10 checkpoint dương tính có detection gốc cùng họ đối tượng với IoU
đạt ngưỡng scorer 0,35. Camera gate ở chính checkpoint đều `valid` cho B/D.
Vì thế, thiếu detection hiện tại hay camera gate hiện tại không giải thích
10 ca này. Các khoảng trống detection và mất liên kết trong lịch sử vẫn có thể
làm khởi động lại cửa sổ; không được suy rộng kết luận hiện tại ra toàn clip.

## Đối chiếu từng checkpoint

`traffic` và `low-speed` là hai clip thật mới; instance dùng tiền tố để đọc gọn.
Các số điểm bên dưới là điểm ảnh có bằng chứng flow, không phải khoảng cách.

| Clip / index / instance | B: nguyên nhân quan sát | D: nguyên nhân quan sát |
|---|---|---|
| traffic / 13 / f436e2c7 | Chỉ 18/27 điểm qua flow, dưới 70%; reset còn 1 frame | 22/24 điểm hiện tại tốt, nhưng dưới 60% của 47 điểm khởi đầu; reset |
| traffic / 13 / 52dee4d3 | Mới 4 frame / 242 ms sau reset | TP: 5 frame / 323 ms, 38 điểm; các gate cửa sổ đạt |
| traffic / 21 / 52dee4d3 | 11 frame / 800 ms; net tăng 0,665 nhưng MAD 0,03394 > 0,025 | Mới 2 frame / 79 ms; frame 20 vừa mất cohort gốc |
| traffic / 28 / 52dee4d3 | 53 điểm qua flow nhưng chỉ 28 điểm fit đồng nhất, dưới 70%; reset | 38/39 điểm hiện tại tốt nhưng dưới 60% của 64 điểm khởi đầu; reset |
| traffic / 36 / d9aab771 | Mới 2 frame / 82 ms; frame 35 vừa mất support | Mới 3 frame / 161 ms; frame 34 vừa mất cohort gốc |
| traffic / 44 / b5042fc9 | Mới 4 frame / 240 ms; frame 41 vừa mâu thuẫn scale box/point | 37/43 điểm hiện tại tốt nhưng dưới 60% của 64 điểm khởi đầu; reset |
| low-speed / 13 / 62114b50 | 11 frame, 9 điểm; MAD 0,12228, net < 3 MAD, point/box trend lệch 0,14005 | 37/40 điểm hiện tại tốt nhưng dưới 60% của 64 điểm khởi đầu; reset |
| low-speed / 20 / 62114b50 | Chỉ 14/53 điểm qua flow; reset | 20/29 điểm, sát nhưng dưới 70%; reset |
| low-speed / 28 / 62114b50 | Chỉ 23/62 điểm qua flow; reset | Mới 2 frame / 79 ms sau localized-flow reset ở frame 27 |
| low-speed / 36 / 62114b50 | Chỉ 8/31 điểm qua flow; reset | Frame trước không đủ seed; không có flow cohort hợp lệ để nối |

## Nguyên nhân cấu trúc đã xác nhận

1. **Cohort điểm bị hao hụt không thể phục hồi trong cùng identity.** B/D
   cumulative chỉ giữ các điểm sống sót từ cohort ban đầu. Gate vừa đòi tỷ lệ
   trên cặp hiện tại, vừa đòi ít nhất 60% tổng seed gốc. Trong 4/6 ca D bị
   `insufficient-object-flow`, cặp hiện tại còn 86–97% điểm nhưng vẫn bị veto vì
   cohort gốc hao hụt. Điều này xảy ra đúng như code, không phải GPU chậm.
2. **Mất bằng chứng đồng thời làm mất identity và cửa sổ thời gian.** Validator
   thất bại dẫn tới tube/ID mới và lịch sử 1 frame. B cần lại ít nhất 5 frame
   và 320 ms; 3 ca warm của B và 3 ca warm của D chưa tích lũy đủ sau reset.
   Chỉ thay LK bằng DIS không tháo được ràng buộc kiến trúc này.
3. **Một phần ca không có mô hình bề mặt đủ đồng nhất.** B có một ca inlier
   fit thấp và hai ca cửa sổ mâu thuẫn dù có trend tăng. Với ca MAD cao, replay
   chứng minh gate từ chối, nhưng chưa phân biệt được biến dạng/viewpoint thật,
   sai correspondence hay drift. Không được hạ gate rồi coi là đã chứng minh.
4. **Nhãn và đại lượng tính toán không đồng nhất hoàn toàn.** GT là relative
   range tới tâm vật trong 3D; thuật toán là angular expansion của một tập điểm
   dưới giả thiết bề mặt/viewpoint phù hợp. Tiến gần vật lý không bảo đảm mọi
   tập điểm tạo một similarity expansion sạch. Giữ nguyên 10 nhãn để đánh giá,
   không loại ca khó để cải thiện tỷ lệ.

## Bằng chứng và giới hạn

Chạy lại nhân quả cả 100 frame cho B/D từ pixels gốc, JPEG staging giống runner,
detections đã đóng băng và RNG seed giống runner. Không chạy detector/model mới,
không thay policy, không sửa nhãn. Đối chiếu 200 lane-frame cho status, events,
trackReasons: **0 mismatch**. Nhãn chỉ được mở sau khi replay xong.

Artifact máy: `docs/evidence/tip65/m3g-holdout-attribution.json`; có hash nguồn,
receipt, truth, script, code và lịch sử thật của tube. Chuỗi IoU đi ngược 12
frame chỉ là association để chẩn đoán, không phải GT identity được kiểm độc lập.
Lịch sử bên trong tube là trạng thái thực của thuật toán.

Khuyến nghị sau vòng này là thiết kế tách identity khỏi measurement-validity,
giữ và tái xác minh các bề mặt/tracklet theo cửa sổ mà không ghép sai điểm mới
vào đường cũ. Phải chứng minh bằng ca che khuất, đổi viewpoint, vật cạnh nhau,
camera chuyển động và cả báo nhầm/bỏ sót trên holdout mới. Đây là hướng cần
nghiên cứu, **không phải bản vá đã đạt**, và không được coast cảnh báo qua frame
thiếu bằng chứng. Khoảng cách mét vẫn tách riêng; không suy ra mét từ looming.

3 kiểm thử mới chỉ kiểm arithmetic của bản chẩn đoán. Không có kiểm thử iPhone,
không có chứng nhận real-time, an toàn dẫn đường hay sẵn sàng demo thương mại.
