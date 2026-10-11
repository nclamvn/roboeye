# TIP-64B2 — Completion / Verify

Ngày: 2026-10-11. Bản: **RoboEye Assist 0.2.0, build 3**.

## Kết luận và phạm vi

**READY FOR CONTROLLED IPHONE TEST. 12/12 requirements đã triển khai; QA cuối
đạt, Signed Release đã cài và smoke camera thật có nhận diện + số đo LiDAR.**
Không dùng kết quả simulator, ảnh thử hoặc smoke ngắn để khẳng định độ chính xác,
recall toàn bộ hay độ bền 30 phút trên iPhone.

Nguyên nhân app cũ không nhận diện: bản 0.1.x chỉ có đo vùng thủ công, chưa có
object detector. Bản này bổ sung đủ chuỗi nhận diện → tracking → bounding box,
nhãn tiếng Việt → ước lượng LiDAR theo từng vật. Đây là prototype nhận diện và
đo bề mặt có giới hạn, chưa phải sản phẩm dẫn đường cho người khiếm thị.

## Các phần đã triển khai

| REQ | Kết quả / bằng chứng |
|---|---|
| R01 | Chế độ Tự động chạy detector khi mở camera, không cần chọn điểm. |
| R02 | 80 nhóm COCO, tối đa 12 tracks, nhãn tiếng Việt và màu riêng theo ID. |
| R03 | Lấy tối đa 64 supports/vật từ sceneDepth cùng ARFrame; intrinsics gốc; Z clustering rồi quy về khoảng cách camera-tới-bề-mặt. |
| R04 | Detection tối đa 5 Hz, Vision tracking trung gian tối đa nhịp submit 15 Hz; số đo dùng depth hiện tại, không chuyển mét giữa ID. Đây là giới hạn lịch chạy, không phải FPS đã đo trên phone. |
| R05 | Ghép một-một theo lớp/vị trí; tình huống khó phân biệt tạo ID mới, không kéo số cũ sang vật khác. |
| R06 | Hết hạn 300 ms, thiếu/trộn supports, kính rõ, ngoài 0,5–5 m, pose yếu → chưa đo; không suy đoán để ép hiện mét. |
| R07 | Vision input xoay theo Presentation đã kiểm chứng từ SDK; inverse-map về raw RGB để lấy depth; display cùng affine. Test đủ bốn góc xoay. |
| R08 | Camera toàn màn hình; controls gọn, diagnostics thu gọn; landscape hai hàng với font thường, large-type có scroll; giữ Đo điểm. |
| R09 | Một worker job, không xếp hàng frame; generation bỏ kết quả cũ; stop/background/rotation xoá output; heat/memory guards. |
| R10 | Model offline đóng gói, có SHA/source/license; không upload camera, không API inference. |
| R11 | Giữ v1 contract: 8 nhãn đóng, ≤128 supports tổng, bbox-only provenance. Projection có test và được runtime dùng chung; không giảm 64 samples/vật của phép đo live. Giữ manual recorder/truth/export. |
| R12 | Signed Release/codesign PASS; devicectl cài và đối chiếu RoboEye Assist 0.2.0 (3) trên iPhone; chạy camera thật không debugger. Team/bundle ID giữ nguyên. |

`bbox-only` vẫn phải trả unknown trong reference range của lab v1: bản xuất không
giả nhận segmentation-confirmed foreground để vượt gate cũ. Mét live là ước lượng
bề mặt có supports trong box, chưa phải phép đo foreground được nghiệm thu.

## Kiểm chứng

- Swift portable: **62/62 PASS**, gồm 25 baseline + 37 object/geometry/tracking/range/export tests.
- Swift → TypeScript: **7/7 PASS**. Hai fixtures tự động gọi đúng helper runtime:
  12 vật ×64 live samples →120 export samples, nhãn/indices/checksum hợp lệ;
  trường hợp không depth giữ null/empty indices. Không nới contract.
- TypeScript unit: **353/353 PASS**; `npm run typecheck` PASS.
- Actual Core ML inference trên ba ảnh thật: chim, người, và ảnh tủ lạnh do người
  dùng cung cấp; không dùng fixture UI thay inference. Score được kiểm đúng
  `classificationConfidence × observationConfidence`. Pixels riêng không copy
  vào repo hay upload. Đây là smoke test nhận diện, không phải benchmark recall.
- Gate native cuối: **PASS**, gồm integrity, actual model, Release bundle/model/
  license, static analysis và **11/11 UI, 0 failure**. Native source fingerprint
  không đổi trong QA và được kiểm lại sau signed build:
  `df538f7244d2378c670205b9f04b778c48ba937dddb74d9bb8ab3c7a8336be98`.
- Contractor trực tiếp xem ảnh UI automatic hai box và manual landscape cuối;
  số đo/controls đọc được, có watermark Mô phỏng, không gọi ảnh này là camera thật.

### Lỗi được tìm và sửa trong QA

Lần UI đầu: 10/11 PASS; assertion đo điểm sau landscape không đọc được nhãn
range vì vị trí cuộn cũ và footer thấp. Đây là lỗi layout thật. Đã sửa adaptive
landscape/scroll reset, giữ assertion fresh confirmation và thêm kiểm tra nhãn,
nút thật sự nằm trong panel. Không bỏ assertion để lấy xanh. Collector sysdiagnose
sau lỗi bị kẹt; dừng đúng tiến trình QA/collector đã tạo, bảo toàn stdout lỗi.
QA sau dùng `-collect-test-diagnostics never`, vẫn giữ failure/xcresult và timeout.

Receipt cũ bị source drift khi hoàn thiện projection, không dùng như pass:
`evidence/tip64b2/summary-before-export-layout-fixes.json`.
Lỗi UI gốc: `evidence/tip64b2/first-ui-failure/report.json`.
Gate cuối: `evidence/tip64b2/summary.json`.
Interop: `evidence/tip64b2/automatic-export-interop.json`.

## Thiết bị và khoảng trống nghiệm thu

iPhone 16 Pro Max / iOS 27.0.1 được kết nối qua USB; Developer Mode bật,
người dùng đã mở khoá và cấu hình Team. Không đăng nhập tài khoản thay người dùng,
không đổi Team/bundle ID và không regenerate project đã signing.

- Signed Release / codesign: **PASS**. Kiểm chữ ký với quyền truy cập trust/keychain
  hệ thống; không thay certificate hoặc nới trust để lấy xanh.
- Installed 0.2.0 (3): **PASS**, đọc lại đúng app trên iPhone sau cài.
- Real camera/model/surface range smoke: **PASS giới hạn**. Một aggregate thật
  sau ≥15 giây: modelLoaded=1, detectorCalls=63, trackerCalls=109,
  objectCount=1 và metricCount=1. Detector inference max quan sát **67,4 ms**,
  thermal nominal tại thời điểm log. Không ghi pixels, không bật consent tự động.
  Counts vật/số đo là snapshot cuối, không phải coverage/recall của cả phiên;
  max inference không phải latency end-to-end/P95 hoặc bảo đảm realtime.
- Console bridge kết thúc với timeout 45 giây vì chờ app thoát, không phải crash
  hay lỗi model. Thử mở lại default sau smoke bị iOS từ chối vì máy đã khoá;
  app đã cài/chạy thành công trước đó. Người dùng mở khoá → mở RoboEye Assist
  → Mở camera; không cần signing/trust lại. Không tìm cách vượt khoá thiết bị.
- Physical distance accuracy, detection recall, end-to-end latency P95,
  moving-object accuracy và thermal 30 phút: **NOT TESTED**.
- Android, phone không sceneDepth/LiDAR, giọng nói/haptic, arbitrary-object
  open-vocabulary, obstacle-free route/navigation: **NOT IMPLEMENTED trong TIP này**.

Receipt đã bỏ mã thiết bị và scene details:
`evidence/tip64b2/physical-device.json`. Raw installer metadata giữ trong cache
build ignored, không đưa vào report phát hành. Ảnh QA UI nằm ở
`evidence/tip64b2/ui-final/`, chỉ là simulator.

## Thử một lượt trên iPhone

1. Mở **RoboEye Assist**, kiểm tra header 0.2.0, chọn **Tự động → Mở camera**.
2. Trong nhà đủ sáng, hướng tới người hoặc tủ lạnh/ghế/tivi/sách tại 1–3 m;
   di chuyển camera nhẹ lúc đầu để ARKit định vị. Khung/tên xuất hiện tự động,
   `≈… m` chỉ xuất hiện khi depth đủ hỗ trợ. Quạt chưa thuộc 80 nhóm COCO.
3. Cho người đi ngang, xoay dọc/ngang, dừng/mở và ra/vào app. Không giữ số cũ
   khi mất depth; camera trở lại từ background cần bấm mở lại.
4. Nếu chưa đo, xem lý do và timing trong **Chẩn đoán**. Không suy luận rằng
   phía trước an toàn. Muốn đối soát vật lý phải dùng thước tới cùng bề mặt;
   không lấy số app làm ground truth.

Không dùng prototype này để dẫn đường độc lập, lái xe hoặc quyết định an toàn.

## Asset / pháp lý / vệ sinh

Apple YOLOv3 FP16: 124.207.764 bytes,
SHA-256 `276afae53da362e25ad21c827f8a929a8512254b1343433d970e725a0de57d8f`.
Apple model card khai MIT; metadata dẫn về original Darknet public-domain notice.
Giữ cả hai nguồn và notice trong bundle; không đánh đồng với Ultralytics AGPL.
Đây là baseline tích hợp đã kiểm chứng, không tuyên bố model tiên tiến nhất.
Review quyền phân phối/use thương mại là gate riêng.

Không copy project ra /tmp, không cài venv/dependency ngoài repo, không tạo build
folder theo từng task. Tái sử dụng `.build` và `.build-xcode`; model/raw QA cache
được ignore. Simulator trở lại trạng thái Shutdown; không còn child build/QA
đang chạy. Đĩa còn khoảng 56 GiB. Không tạo scratch project/venv ngoài repo,
không có thư mục ngoài repo cần xoá. Không xóa dữ liệu người dùng. Không commit/push/cloud deploy trong
yêu cầu này. Đã áp dụng **vibecode-kit v6.2** (thầu/chốt contract, thợ thi công,
verify độc lập) và **frontend-design** (full-camera, controls gọn/adaptive).
