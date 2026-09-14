# DriveSense — hướng dẫn baseline D1/D2

## HUD tối giản

Giao diện là một khung camera chiếm toàn bộ cửa sổ, không có nội dung rơi xuống
bên dưới. Video giữ nguyên tỷ lệ nguồn, không kéo méo/cắt; nếu tỷ lệ cửa sổ khác
nguồn thì có phần nền dư. Canvas dùng đúng cùng phép căn video nên khung xe
không lệch vì thay đổi giao diện. Khung xe màu theo ID và số mét lớn. Nhãn không đọc tên xe/ID hay TTC;
mục tiêu cần chú ý có khung góc vàng. Khi risk engine chấp nhận nguy cơ cao,
khung xe chuyển đỏ và tô đỏ trong suốt nhẹ (không phải segmentation thân xe).
Dòng **Quá gần** hiện khi có mét và khoảng cách dưới ngưỡng nguy cơ theo tốc độ;
chỉ có tín hiệu tiến gần thì ghi **Nguy cơ cao**. Chữ đỏ sáng–dịu nhẹ theo chu kỳ
4 giây, chỉ đổi độ sáng 12%, không biến mất; viền/ảnh xe không nhấp nháy. Thiết bị bật
giảm chuyển động sẽ hiển thị chữ tĩnh. Chưa đủ range thì hiện
**Chưa đo**, không chuyển thành thời gian hay ước lượng giả.

Màn mở đầu căn giữa: chọn **Mở video**, **Camera** hoặc **Xem mẫu dựng**; đồ họa
đường/xe nét mảnh chỉ là minh họa, không phải kết quả AI.
Thanh điều khiển nhỏ nổi ngay bên trong cạnh dưới video, nền tối bán trong suốt:
icon mở video, camera, phát/tạm dừng, thanh tua, âm thanh, dừng nguồn và
toàn màn hình. Play/tua chỉ hiện cho file video; màn mở đầu không có một hàng
điều khiển vô hiệu dài. Icon có tên hỗ trợ truy cập, tooltip và trạng thái thật; bật âm
không làm mất icon, play đổi theo trạng thái video. Toàn màn hình vẫn giữ cả
overlay/cảnh báo và điều khiển, không cắt nguồn; trình duyệt không hỗ trợ thì
nút này vô hiệu. Trên màn hình nhỏ, thanh tua chuyển xuống hàng thứ hai.
Không dùng blur nền hoặc hiệu ứng động ở thanh nút để tránh thêm chi phí xử lý
video. Âm mặc định tắt, là tiếng báo ngắn chứ không đọc số mét liên tục.
Nhãn **Mẫu dựng · không phải AI**, **Phát lại đã phân tích** hoặc **Camera · chưa
đo mét** luôn phân biệt nguồn và chế độ. Cảnh báo PoC không dùng để phanh/lái
vẫn hiển thị; giao diện tối giản không đồng nghĩa với FCW đã kiểm định.

Mở **Phân tích** ở góc trên bên phải (icon thanh chỉnh trên mobile) khi dừng hoặc kiểm tra demo để xem policy, nguồn khoảng cách,
bằng chứng, sự kiện, danh sách ID, cấu hình tốc độ, profile camera và xuất báo
cáo. Bảng mặc định đóng, mở thành panel bên trong khung video và có cuộn riêng;
không làm dài trang. Nút đóng hoặc Escape đóng panel và trả focus về nút mở.
Toàn màn hình giữ luôn panel. Hành lang phối cảnh chỉ được vẽ khi bảng này mở.

Khi phát lại bản đã phân tích, độ tin cậy của mẫu được giữ trong khoảng nội suy
200 ms thay vì suy giảm mỗi frame hiển thị rồi bật đỏ lại ở mẫu tiếp theo. Mẫu
dựng dùng cùng nguyên tắc với chu kỳ 100 ms riêng và vẫn ghi rõ không phải AI.
Đây không phải phép đo mới; tuổi số mét hiển thị không bị sửa. Camera thật vẫn
giữ nguyên kiểm tra độ trễ/dữ liệu cũ; mất track, dữ liệu yếu hoặc mâu thuẫn vẫn
không được tự nâng cảnh báo đỏ. Báo cáo risk ghi `evidenceMode` để phân biệt.

Khung nội suy chỉ dùng mức tin cậy không cao hơn hai đầu mẫu. Nếu mẫu kế tiếp
yếu hoặc tín hiệu chuyển động bị reset, khung không được mượn tín hiệu mạnh cũ;
nếu mất depth thì xóa cả mét và xu hướng suy từ mét. Tín hiệu tiến gần quang học
độc lập vẫn có thể cho **Nguy cơ cao**, nhưng không được gọi là **Quá gần** khi
chưa đo mét. Cuối bản replay, khung chỉ được giữ tối đa 80 ms, tuổi dữ liệu vẫn
tăng đúng theo thời gian; tua video không sửa cache hoặc tạo phép đo tương lai.

## Shadow Risk HUD — TIP46

TIP46 bổ sung một tầng đánh giá nguy cơ giải thích được, vẫn chạy camera-only và
không điều khiển xe. Mở `drive.html`, chọn **Xem mẫu dựng** để kiểm tra nhanh
toàn bộ luồng hoặc mở camera/video thật. Với camera trực tiếp, bật camera sẽ tự
khởi động detector khi cần.

1. Đặt **Tốc độ thử** theo tốc độ tình huống. Đây là dữ liệu người vận hành nhập,
   không phải tốc độ phần mềm tự đo. Bảng tham chiếu khoảng cách cố định chỉ hiện
   trong dải 60–120 km/h theo TT38/2024.
2. Bật **Đường trơn / mưa** chỉ để xem biên thử nghiệm cộng 25%. Hệ số này không
   phải con số pháp lý và không thay thế việc lái theo điều kiện thực tế.
3. Quan sát hành lang phối cảnh, một mục tiêu chính, khoảng cách xe, mốc khoảng
   cách theo tốc độ và chất lượng bằng chứng. Xe ngoài hành lang bị ghi rõ thay vì
   tranh vị trí cảnh báo với xe phía trước.
   Mỗi ID xe có màu riêng. Màu đỏ tạm ưu tiên ở mọi khung nguy cơ cao đã được
   chấp nhận; khi nguy cơ giảm, khung trở lại màu ID ban đầu. ID/màu gốc trong
   Phân tích vẫn giữ nguyên. Cảnh báo chữ chỉ theo mục tiêu ưu tiên, không nâng
   tín hiệu mâu thuẫn, bằng chứng yếu hoặc track cũ thành cảnh báo đỏ.
4. Âm cảnh báo mặc định tắt, chỉ phát sau khi bấm **Bật âm cảnh báo** và được giới
   hạn tần suất. Báo cáo JSON v5 chứa cấu hình rủi ro, nhật ký sự kiện hữu hạn và
   snapshot mới nhất để tái kiểm tra buổi demo.

TTC quang học vẫn được suy từ tốc độ tăng diện tích bbox qua nhiều quan sát mạnh,
nhưng chỉ là tín hiệu nội bộ của risk engine. Giao diện không hiển thị giây và
không dùng TTC thay cho khoảng cách: mọi số đo công bố đều là mét; chưa đủ range
thì ghi **Chưa đo**. Sau một frame mất hoặc chỉ còn quan sát yếu, tín hiệu chuyển
động bị xóa thay vì tiếp tục dùng dữ liệu cũ. Hai nguồn mâu thuẫn thì hệ thống
không cho tín hiệu đó tự nâng lên cảnh báo đỏ.

Mẫu toán học là kịch bản dựng để chứng minh plumbing: xe chính tiến gần, xe tải ở
bên cạnh bị loại khỏi hành lang. Nó không đo độ chính xác của detector. Camera
trực tiếp có detector + TTC quang học; số mét learned/geometric realtime vẫn chưa
được bật. Video tải từ máy vẫn phân tích trước rồi phát lại như mô tả bên dưới.

## PoC khoảng cách desktop — TIP45

DriveSense hiện có hai phép đo tách biệt:

1. **AI metric (mặc định cho video đã phân tích):** Depth Anything V2 Metric
   Outdoor Small, export ONNX landscape 392×224. Không cần profile camera. Kết quả
   là Z quang học ước lượng tới bề mặt xe, mang provenance `learned-unverified`.
2. **Hình học profile (ưu tiên khi đã áp dụng):** tia–mặt đường từ intrinsics, chiều cao và góc
   gá do người dùng đo. Kết quả là khoảng cách dọc tới điểm chân xe.

Hai đại lượng không được coi là cùng ground truth và không phải khoảng hở cản xe.
Profile đã áp dụng sẽ thay thế nhánh AI, kể cả khi phép đo hình học bị từ chối;
không tự trộn hai loại mét trong cùng bộ lọc track.
AI metric làm PoC hiện số mét chạy được ngay; nó không biến monocular RGB thành
cảm biến khoảng cách đã chứng nhận. Muốn đánh giá sai số phải nhập đối chứng cùng
định nghĩa khoảng cách, đúng timestamp và đúng track.

Trước khi chạy local lần đầu:

```sh
python3 -m venv tests/.metric-venv
tests/.metric-venv/bin/pip install -r tests/metric-requirements.txt
npm run fixtures:drive-metric:export
npm run fixtures:drive-metric
npm run fixtures:detection-benchmark
npm run fixtures:drive-detector:export
npm run fixtures:drive-detector
npm run dev -- --host 127.0.0.1 --port 4192 --strictPort
```

Lệnh export dùng source weights đã pin revision/hash trong cache TIP44; lệnh stage
kiểm byte-size + SHA-256 rồi chép model vào `public/models/drive-metric/`. Model
95 MB và thư mục runtime đều bị git-ignore. Không có model hoặc model sai hash thì
distance worker dừng, nhưng detector vẫn hoàn tất và UI không bịa số mét.
Detector GPU cũng cần graph đã stage tại `public/models/drive-detector/`;
worker kiểm size/hash trước khi chạy. Graph RT-DETR FP32 cố định 640×640 có
ba thay đổi AveragePool đã chứng minh tương đương tại shape này, không giảm
độ phân giải hoặc bỏ lớp model. Nếu thiếu/không tương thích, detector thử WASM
trong worker sạch một lần; depth còn chạy GPU được thì vẫn giữ GPU.

Mỗi frame mẫu video được seek một lần (codec có thể phải giải mã các frame trung
gian). Detector và depth xử lý cùng ảnh đã chụp tại timestamp mẫu. Sau khi chụp
ảnh depth, seek/detector mẫu kế tiếp được gối đầu với depth mẫu trước. Chỉ có
một request mỗi worker; kết quả commit đúng thứ tự. Frame không có ứng viên xe
mạnh sẽ bỏ qua depth. Đây không phải hạ mức lấy mẫu 5 Hz hay phân tích realtime.
Ảnh metric được letterbox, không kéo méo sang 392×224. Với mỗi box, hệ thống lấy
median ở vùng thân xe phía dưới–giữa, loại ROI quá nhỏ/thưa/phân tán; chỉ lưu range
theo box chứ không giữ depth map, rồi lọc theo track và phát lại nội suy ở 60 fps.
Trên Chromium/WebGPU của máy phát triển, gate 21 lần trên fixture bus đạt khoảng
P50 48,9 ms và P95 50,5 ms cho riêng depth sau warm-up. Con số này không bao gồm
detector, seek video, tải model hay sensor-to-display.

## PoC video — cập nhật xử lý clip dài

Mở video từ 0,1 giây đến **5 phút** sẽ **tự tải AI và phân tích toàn clip** ở
5 mẫu/giây. Video 3 phút có 901 mẫu kể cả đuôi clip; giới hạn bộ nhớ là 1.501
mẫu box/khoảng cách, không giữ toàn bộ các frame video đã giải mã.
Ứng dụng kiểm tra thời lượng trước khi khởi tạo AI. Ngay trong khung video có
trạng thái **Đang đọc video → Đang tải AI → Đang phân tích …%**, số mẫu đã xử lý
và thời gian còn lại ước tính từ tốc độ thực. Model chạy chậm có thể khiến bước
này lâu hơn thời lượng video. Có thể **Hủy**, **Chạy lại** hoặc **Phát video**
khi hoàn tất. Lỗi thời lượng/định dạng/tải AI hiện tại đây, không phải mở bảng
Phân tích mới thấy. Clip vượt 5 phút cần cắt lại; file không đọc được metadata
sau 15 giây sẽ báo lỗi rõ ràng.
Nếu nạp backend mặc định lỗi, ứng dụng thử WASM một lần trong worker mới, không
lặp vô hạn. Chưa xong phân tích thì chưa có bản replay hoàn chỉnh.

Khi hiện **Đã phân tích … frame**, bấm **Phát / tạm dừng**. Video phát bình
thường cùng bounding box/ID đã tính. Tua tới/lùi dùng kết quả trong bộ nhớ, không
chạy AI lại. Giữa hai mẫu liền kề, chỉ nội suy bbox của cùng ID; không nối qua
mẫu mất xe. Đây là **phát lại đã phân tích**, không phải AI realtime. Khoảng cách
nếu có là phép đo của mẫu trước đó, không phải phép đo mới cho mỗi frame hiển thị.

Bộ kiểm thử chuỗi mẫu → tracker → replay → risk → HUD mô phỏng bước hiển thị
60 FPS để kiểm tra tính ổn định và xử lý mất bằng chứng. Đây không phải kết quả
đo FPS thực tế, tốc độ detector, sai số khoảng cách hay độ trễ camera.

Không cần profile để khoanh xe hoặc nhận số mét AI metric. Khung xanh và nhãn
`chưa đo` vẫn là trạng thái hợp lệ khi detection yếu, xe quá nhỏ hoặc ROI depth
không đạt. Profile bật phép đo hình học độc lập và được ưu tiên hơn AI. Áp dụng/hủy profile sau phân
tích sẽ tính lại range từ kết quả nhận diện sẵn có; không nhập thông
số synthetic cho clip đường thật.

Xuất JSON chứa các frame AI thật, latency, backend, thời gian phân tích và cờ
`mode: analysed-replay`. Box nội suy khi phát không được tính thành mẫu nhận diện
thật. Đổi nguồn hoặc tải lại trang xóa cache; video/report không tự lưu lên server.
Camera trực tiếp vẫn là thử nghiệm có giới hạn trễ, không được nâng thành FCW.

Các bước baseline bên dưới là tham chiếu calibration; luồng bật AI thủ công chỉ
còn cần khi tự dừng AI hoặc thử lại sau lỗi cuối cùng. Tua bản replay hoàn chỉnh
không còn xóa kết quả/đối chứng; đổi nguồn vẫn xóa.

## Chạy và thử

Chạy `npm run dev -- --host 127.0.0.1 --port 4190 --strictPort`, mở
`http://127.0.0.1:4190/drive.html`. Với bản build: `npm run build`, rồi
`npm run preview -- --host 127.0.0.1 --port 4191 --strictPort` và `/drive.html`.

1. **Xem mẫu toán học** kiểm tra giao diện và phép chiếu. Hai hình chữ nhật trong
   mẫu là dữ liệu dựng, tuyệt đối không dùng để đánh giá model nhận diện.
2. **Mở video trên máy**, chờ tự phân tích, rồi **Phát / tạm dừng**.
   Video không tải lên máy chủ. Graph GPU/depth đã stage được đọc local;
   detector WASM dự phòng có thể tải weights Hugging Face lần đầu, cần mạng.
   Giữ tab phân tích ở phía trước khi đo hiệu năng: Chrome có thể làm inference
   GPU ở tab nền chậm rõ rệt.
   Thử WASM nếu GPU không tương thích. Camera sau chỉ mở khi bấm và cấp quyền.
3. Chưa có profile: AI metric vẫn có thể gán mét và phải ghi “chưa kiểm chứng”.
   Muốn đối chứng hình học, nhập calibration đúng lens, độ phân giải, crop và gá
   camera. Xác nhận rồi áp dụng. Đổi nguồn sẽ xóa cache, calibration và đối chứng;
   tua bản replay đã hoàn tất không làm mất cache.
4. Xuất báo cáo JSON trước khi đổi nguồn hoặc tải lại trang. Nhập đối chứng đúng timestamp và
   ID của phiên hiện tại để tính MAE, bias, P95, coverage. Nếu không có đối chứng,
   các chỉ số chính xác là null, không phải 0% lỗi.

## Phép đo có ý nghĩa gì?

### Xe vượt, zoom và xe xa

Số mét là **Z dọc phía trước tính từ camera**, không phải khoảng cách ngang giữa
hai xe hay khoảng hở nhỏ nhất giữa thân/cản xe. Xe cạnh làn cách ngang 1–3 m vẫn
có thể có Z phía trước lớn hơn; không dùng Z để gọi là khoảng hở bên cạnh.
Xe bị cắt ở biên sẽ không nhận mét learned.

Trong **Phân tích**, khai báo **Zoom/crop video** theo cấu hình quay thật. Mặc
định 1× không có nghĩa phần mềm đã biết lens. Với zoom khác 1×, AI không nhận
tham số tiêu cự nên bị chặn công bố mét; không chia/nhân đầu ra neural theo zoom.
Muốn đo hình học cần profile đúng ảnh đầu ra. Nếu biết FOV ngang **trước zoom**,
có thể dùng nút điền tiêu cự để hỗ trợ nhập pinhole/crop giữa ảnh; đây không phải
hiệu chuẩn tự động, không xử lý méo/fisheye/EIS hoặc tự biết chiều cao gá.

Xe nhỏ dưới 10 pixel mỗi chiều trên depth map và cặp xe cùng lớp/căn dọc có depth
xa–gần mâu thuẫn nghiêm trọng với phối cảnh sẽ bị từ chối. Gate phối cảnh là
heuristic bỏ phép đo không đáng tin, không tự sửa thành cự ly đúng, không phải
lane detection. Model outdoor bị giới hạn 80 m; không ngoại suy xe xa hơn từ
khoảng trống nhìn bằng mắt hoặc cộng khoảng B–C chưa được đo.

Báo cáo v5 giữ các lý do từ chối, zoom, policy, graph GPU hash, seek/inference,
số request depth và tốc độ xử lý toàn clip. Chỉ số sai số mét vẫn là `null` khi
chưa có đối chứng độc lập.

Đầu vào: RT-DETRv2 R18, chỉ ô tô/xe tải/xe buýt. Giữ ID bằng ghép Hungarian
hai ngưỡng điểm, lấy cảm hứng từ ByteTrack, không phải toàn bộ upstream ByteTrack.

Lấy giữa cạnh dưới bbox làm **xấp xỉ điểm tiếp xúc mặt đường**, khử méo
Brown–Conrady, tạo tia từ intrinsics, quay theo pitch/roll, giao tia với mặt phẳng
đất. Với camera ngang, không méo: `Z = heightM * fy / (v - cy)`.
`Z` là khoảng cách dọc hướng nhìn trên mặt đất từ camera, không phải khoảng
hở cản xe, khoảng cách Euclid hay khoảng cách lidar.

Kalman giảm rung theo thời gian; innovation gate từ chối ngoại lai. Mép ảnh bị
cắt, box quá nhỏ, gần chân trời, calibration không khớp, phép đo mất/quá cũ hoặc
độ nhạy quá lớn sẽ cho **chưa đủ dữ liệu**. Dải sai số là sensitivity heuristic,
chưa được hiệu chuẩn thành khoảng tin cậy thống kê.

Hạn chế quan trọng: chưa biết chân xe thật, chưa bù pitch động khi phanh/xóc,
chưa mô hình đường dốc/cong và hành lang hiện là heuristic phối cảnh chứ chưa phải
lane segmentation. TIP46 đã có shadow TTC/risk HUD nhưng chưa phải FCW được kiểm
định. Không tự phát hiện được mọi trường hợp giả định đường phẳng sai. Màu trạng
thái chỉ phục vụ thử nghiệm, không có nghĩa xanh là an toàn hoặc đỏ cần phanh.

## Schema calibration

Các số dưới đây **chỉ cho mẫu synthetic 1280×720**, không nhập cho camera thật.

```json
{
  "version": 1, "name": "SYNTHETIC ONLY",
  "width": 1280, "height": 720,
  "fx": 900, "fy": 900, "cx": 640, "cy": 360,
  "distortion": [0, 0, 0, 0, 0],
  "heightM": 1.4, "pitchDeg": 0, "rollDeg": 0,
  "pixelSigma": 3, "heightSigmaM": 0.02,
  "pitchSigmaDeg": 0.1, "focalSigmaFraction": 0.01,
  "minM": 5, "maxM": 50
}
```

fx/fy/cx/cy theo pixel ảnh gốc, không theo canvas hiển thị. Pitch dương chúc
xuống. Hệ số méo theo OpenCV `[k1,k2,p1,p2,k3]`, không hỗ trợ model fisheye.
Camera thật cần calibration nội tại độc lập; nhập zero không làm lens hết méo.
Giữ nguyên EIS/crop/lens/focus theo cấu hình đã đo.

Tinh chỉnh gá: array `{ "u": pixelX, "v": pixelY, "zM": groundForwardM,
"split": "fit" }` và các hàng `split: "check"`. Tối thiểu 6 fit trải ≥8 m,
2 check độc lập. Huber + Gauss–Newton chỉ chỉnh height/pitch, không fx/fy/lens.
Holdout lỗi >max(2m,20%) bị từ chối; đạt ngưỡng này không chứng nhận sản phẩm.

Đối chứng: array `{ "timeMs": 1000, "trackId": 1, "distanceM": 20 }`.
Đo độc lập ngoài phần mềm, cùng định nghĩa Z, khớp ID đúng xe. Ghép thời gian
trong 80 ms, mỗi quan sát chỉ dùng một lần; unknown làm giảm coverage. Report
giữ 20.000 quan sát và 5.000 thời gian xử lý mới nhất. Latency từ đọc video frame
đến nhận kết quả, **không** phải sensor-to-display và không gồm trễ video có sẵn.

## Điều kiện trước giai đoạn tiếp

Thu video và ground truth tại bãi có kiểm soát, nhiều cự ly/loại xe/ánh sáng;
tách fit/validation/test theo chuyến và camera. D3 sẽ so sánh model depth metric,
detector và fusion trên cùng dữ liệu, giấy phép checkpoint và thiết bị mục tiêu.
Chỉ sau gate chất lượng, coverage, tracking và latency mới triển khai D4 cảnh
báo theo chuyển động. Không sử dụng baseline này để quyết định phanh/lái.

Nguồn nền tảng: [OpenCV calibration](https://docs.opencv.org/4.13.0/d9/d0c/group__calib3d.html),
[RT-DETR](https://github.com/lyuwenyu/RT-DETR),
[ByteTrack](https://github.com/FoundationVision/ByteTrack).
# TIP43 — sửa cách đọc đầu ra model (2026-09-13)

DriveSense dùng decoder riêng đúng RT-DETRv2 focal-loss: sigmoid + top-K, không
dùng softmax/background của DETR cũ. Khung gần như trùng nhau giữa car/bus/truck
được hợp nhất trước khi gán ID. Đây không phải thay model hay nâng ngưỡng để che
lỗi. Sau kiểm thử thực tế, thêm xác nhận track: 2 mẫu mạnh liên tiếp (≥0,65),
hoặc 1 mẫu rất mạnh (≥0,85); mẫu yếu chỉ giữ ID/khung tối đa 400ms và không được
đo mét. Ngưỡng ứng viên 0,15 vẫn giữ để nối ID khi che khuất. Đây là chính sách
PoC thận trọng, có thể bỏ sót xe nhỏ/xa, chưa phải ngưỡng tối ưu đã nghiệm thu.

Phải phân tích lại video sau cập nhật này. Báo cáo mới ghi
`rtdetr-focal-sigmoid-topk-v1` và `vehicle-exclusive-confirmed-v2` trong `model`.
Điểm/báo cáo cũ không chuyển ngược được thành điểm mới vì không lưu logits.
Không dùng số lượng box/ID giảm để tuyên bố độ chính xác; cần đối chứng từng vật.

Về khoảng cách: file video không tự cung cấp chiều cao gá camera, tiêu cự theo
pixel hay góc chúc. TIP45 không giả vờ suy ra các số đó; nó bổ sung một nhánh
learned metric để có ước lượng ngay, đồng thời giữ profile làm phương pháp đối
chứng. Hệ thống vẫn chưa tự hiệu chuẩn và chưa có sai số thực địa. Không nhập
profile mẫu cho clip thật. Nhận diện đúng xe và đo khoảng cách đúng là hai phép
nghiệm thu riêng; phát lại mượt không thay thế được chúng.
