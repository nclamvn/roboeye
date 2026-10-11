# TIP-64B3 — Một lượt thử iPhone có đối soát

Ngày 2026-10-11. Áp dụng **RoboEye Assist 0.2.1 / build 4**, không phải trang web.
Đây là kế hoạch thử, **chưa phải kết quả đã đạt**. Không cần mua phần cứng mới.

## Trước khi thử

- Chỉ cài sau khi gate phần mềm cuối đạt và người dùng cho phép. Giữ Team,
  bundle ID và cấu hình trust hiện có; không cần tạo project mới.
- iPhone có LiDAR, đủ sáng, trong nhà; đứng hoặc ngồi tại chỗ. Không dùng app
  để tự đi lại, lái xe hay suy ra phía trước an toàn.
- Kiểm tra header **0.2.1**, chọn **Tự động → Mở camera**. Model đóng gói local;
  có thể ngắt Internet để kiểm tra không phụ thuộc API.
- Không bật ghi metadata tự động. App không cần lưu hay tải pixel camera.
  Chế độ **Chẩn đoán** cung cấp thống kê runtime, không phải mock hiệu năng.

## Lượt kiểm tra chức năng 3–5 phút

| Tình huống | Quan sát bắt buộc | Nếu lỗi |
|---|---|---|
| Người, ghế, tủ lạnh, sách hoặc điện thoại ở khoảng 1–3 m | Khung và nhãn tiếng Việt xuất hiện; mét chỉ có khi đủ depth cùng frame | Ghi thời điểm, nhãn và lý do trong Chẩn đoán; không ép hiện số |
| Giữ máy yên rồi dịch chậm | Khung ít rung, nhãn không bị nét khung khác đè lên; phản hồi theo chuyển động | Tách lỗi bám ID, lỗi detector và lỗi render |
| Hai người hoặc hai vật cùng lớp đi ngang/cắt nhau | Không chuyển số mét cũ sang vật mới; không có khung ma lâu dài | Có thể đổi ID khi mơ hồ; không coi đổi ID an toàn là nhận diện người |
| Dọc/ngang, mở/đóng Chẩn đoán, chữ lớn | Nút sử dụng được; nhãn tránh panel và mép màn hình | Cảnh quá đông có thể ẩn badge; outline và accessibility vẫn tồn tại |
| Dừng/mở camera, đưa app ra nền rồi quay lại | Khung/số cũ mất; ra nền không tự mở lại camera | Không chấp nhận số cũ tồn tại như số đo hiện tại |
| Kính, mép vật, ngoài 0,5–5 m hoặc ARKit chưa định vị | Có thể “chưa đo” kèm lý do, không có trạng thái “an toàn” | Unknown không phải bằng chứng không có vật cản |

Quạt và đồ vật ngoài 80 lớp COCO chưa được detector hiện hành hỗ trợ. Một vài
vật nhận tốt không chứng minh recall của mọi lớp. Trong cảnh đông, không yêu cầu
đặt đủ 12 nhãn lên màn hình bằng cách cho chúng chồng lên nhau.

## Đối soát số đo

Đo bằng thước tới **cùng điểm/bề mặt nhìn thấy**, từ camera, không lấy số của app
làm ground truth. Với Đo điểm: chọn vùng, xác nhận rồi ghi mốc độc lập theo quy
trình hiện có. Bản tự động vẫn là `bbox-only`; chưa giả thành
`foreground-associated` để bật gắn ground truth hay vượt contract v1.

Thử các mốc 0,5 / 1 / 2 / 3 / 5 m nếu bố trí được, thêm vật nghiêng và vật bị che.
Báo cáo cả sai số của mẫu được chấp nhận **và tỷ lệ bị từ chối**. Không đánh giá
chỉ trên các lần hiển thị đẹp. Không suy từ một số trên vật nền rằng số đó thuộc
vật thể được gán nhãn; đây là gate còn mở trước nâng cấp instance mask.

## Lượt độ bền 30 phút sau smoke

Trên cùng thiết bị/bản cài: theo dõi inference P50/P95, work và capture→ready
P95, số busy drops, retry skips, lỗi, mức nhiệt và bộ nhớ bằng công cụ thiết bị
phù hợp. Những chỉ số runtime hiện có **không đo photon→screen, frame pacing
hay toàn bộ memory/thermal history**; cần instrument riêng cho các mục đó.

Không giữ debugger như mặc định của demo. Thử nền/foreground và memory/heat
guards; camera phải dừng rõ ràng thay vì crash hoặc dùng output cũ. Nếu giới hạn
300 ms làm số thường xuyên mất, phải tìm bottleneck/đồng bộ/frame quality;
không kéo dài TTL chỉ để tăng tỷ lệ có số.

## Gate phát hành vẫn mở

1. Cài đúng 0.2.1 và smoke camera thật của B3.
2. Độ trễ/frame pacing/bộ nhớ/nhiệt dài phiên trên iPhone đích.
3. Holdout precision/recall, ID switches và thời gian mất vật.
4. Sai số bề mặt + refusal coverage, đặc biệt che khuất/nghiêng/nền.
5. VoiceOver và thử có giám sát với người dùng hỗ trợ thị giác.

Simulator, ảnh smoke và test unit không đóng các gate này. Chưa phát hành như
thiết bị dẫn đường độc lập hay hệ thống cảnh báo va chạm được chứng nhận.
