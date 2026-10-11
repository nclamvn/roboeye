# RoboEye Assist — app iPhone local (TIP-64B4)

## Bản 0.2.2 / build 5: màu badge theo loại vật thể

Bản nâng cấp thay chế độ đo điểm mặc định bằng **nhận diện vật thể tự động**:
camera toàn màn hình, khung bám theo từng vật, tên tiếng Việt và số mét LiDAR
xấp xỉ khi có hỗ trợ đủ tin cậy. Không cần chạm chọn từng vật trong chế độ tự động.
Các nút ghi mẫu/JSON nằm trong **Chẩn đoán**; chế độ đo điểm cũ vẫn được giữ riêng.

B4 dùng nền badge màu thật, ổn định theo lớp: người xanh dương, điện thoại tím,
điều khiển vàng đất, ghế xanh teal, sách xanh indigo, chai hồng berry và tủ lạnh
xanh petrol. Chữ trắng có tương phản tối thiểu 5,65:1; mất số đo không làm đổi màu
lớp. Tên và ID vẫn cần thiết vì các lớp khác chia sẻ nhóm màu. Màu không chỉ mức
an toàn. Sửa riêng khung ma điện thoại/điều khiển khi hai dự đoán mâu thuẫn có
IoU > 0,75; nhãn mới không thừa hưởng số mét. Sửa này **không chứng minh model
nhận đúng điện thoại**, và **chưa thêm nhận diện quạt**.

B3 ghép các detection toàn cục thay cho ghép tham lam, loại khung ma khi identity
mơ hồ và lọc jitter chỉ ở lớp trình bày. Nhãn có ID, một chữ số thập phân xấp xỉ,
tránh HUD/cạnh màn hình/chồng nhãn; khung có nét tối bên dưới để đọc được trên
cảnh sáng. Cảnh đông có thể ẩn nhãn không đủ chỗ, nhưng giữ khung và đối tượng
VoiceOver. Số mét cũ không được giữ lại bằng hiệu ứng đồ hoạ. Chẩn đoán bổ sung
P50/P95 inference, capture→ready và work, cửa sổ tối đa 64 mẫu; chưa phải độ trễ
photon-to-screen hoặc sai số vật lý.

1. Cài bản mới từ cùng project Xcode, cùng Team/bundle ID đã thiết lập. Xcode Run
   sẽ cập nhật app; không cần xoá app, chứng chỉ hay đăng nhập lại.
2. Mở app, kiểm tra phiên bản **0.2.2**, chọn chế độ tự động và **Mở camera**.
   Build mới là **5**; build thành công không có nghĩa đã cài lên iPhone.
3. Thử trong nhà đủ sáng với **người, ghế, tủ lạnh, tivi, sách hoặc chai đục** ở
   khoảng 1–3 m. Camera phải thấy đủ vật; di chuyển máy nhẹ lúc đầu để ARKit ổn định.
4. Khung và tên xuất hiện tự động; `≈… m` là khoảng cách camera tới bề mặt được
   lấy mẫu trong khung. Nếu chưa đo, xem lý do trong **Chẩn đoán**, không suy luận
   rằng vật không tồn tại hoặc phía trước an toàn.
5. Cho người đi chậm ngang camera; đổi dọc/ngang; dừng/mở và rời/quay lại app.
   Các số cũ phải mất khi hết hạn/không còn hỗ trợ. Camera không tự mở lại khi app
   trở về từ background; bấm **Mở camera** để tiếp tục.

### Phạm vi thực tế, không quảng bá vượt bằng chứng

- Model Apple YOLOv3 FP16 chạy local, hỗ trợ **80 nhóm COCO**, không phải mọi vật.
  **Quạt không có lớp riêng**; không được dùng quạt làm tiêu chí bắt buộc cho model này.
- Vùng đo đang thử **0,5–5 m**. Số hiển thị là **xấp xỉ bề mặt trong khung**, không
  phải độ sâu Z, tâm vật, khoảng trống để đi hoặc khả năng dẫn đường an toàn.
- Khung không phải mask segmentation. Depth trộn nền, thiếu điểm, quá cũ, kính/bóng,
  ngoài phạm vi hoặc pose chưa ổn định phải được từ chối; không lấp bằng số đoán.
- Không tải hình camera lên cloud, không dùng API inference trả phí. Model đóng
  gói trong app; `native/ios/Models/assets.json` ghi URL/hash/kích thước/giấy phép.
  Apple model card khai MIT, metadata dẫn về Darknet public domain; giữ cả hai
  nguồn, không suy diễn thành bản quyền của một nhà cung cấp YOLO khác.
- Fixture simulator chỉ là kiểm tra giao diện có watermark, không chứng minh
  người/vật được nhận diện live hay số mét chính xác. Kết quả thực phải thử trên
  iPhone; không dùng bản nghiên cứu này để lái xe/dẫn đường độc lập.

### Build / kiểm tra nguồn model

```sh
npm run assets:assistive-objects
npm run qa:assistive-objects
```

Downloader kiểm hash nguồn công khai, không cài SDK/Python hay copy project.
**Không chạy generator để ghi đè project đã có signing.** Các nguồn mới được thêm
vào project hiện hữu; generator phải từ chối ghi đè nếu không có lựa chọn rõ ràng.
Kết quả và khoảng trống nghiệm thu của bản mới nằm trong
`docs/COMPLETION-VERIFY-TIP-64B4.md` khi QA hoàn tất. Audit phương án model nằm
trong `docs/ARCHITECTURE-AUDIT-TIP-64B3.md`. `qa:assistive-ios` là alias gate hiện
hành; receipt B4 ghi riêng, không thay đổi bằng chứng B1/B2/B3. Khoảng trống
điện thoại/điều khiển và quạt được phân tích trong
`docs/RECOGNITION-SCAN-TIP-64B4.md`; chưa có benchmark recall cho các vật này.

## Tài liệu gốc 0.1.x: chế độ đo điểm / protocol dữ liệu

Các đoạn dưới mô tả nền đo điểm TIP-64B1, được giữ để tra protocol cũ, không phải
danh sách tính năng hiện tại của 0.2.2. App riêng, không thay DriveSense/web.
Không phải camera đo khoảng cách cao tốc; vùng kiểm chứng là 0,5–5 m trong không gian có kiểm soát.

## Cần cài gì?

**Trên iPhone: app native do Xcode build từ repo này.** Không tải app bên thứ ba,
không mua API, không cần TestFlight cho lần cài local. Link HTTPS trong Chrome/Safari
**không** chạy bản native này. Ngày 2026-10-11 đã xác minh iPhone 16 Pro Max kết nối,
Developer Mode bật, Team do người dùng thiết lập, và bản RoboEye Assist 0.2.0/build3
đã được cài ở phiên trước. Receipt cài bản 0.2.1 và 0.2.2 phải được kiểm chứng riêng,
không suy từ việc build thành công hoặc từ receipt phiên trước.

Nguồn Xcode: `native/ios/AssistiveDepthProbe.xcodeproj`. Không CocoaPods, npm native, Unity, XcodeGen hay package tải ngoài. Swift core cũng test độc lập trên Mac. iOS deployment target 17.0; build local bằng Xcode 27 SDK, không yêu cầu anh cập nhật iOS chỉ để thử app. Kiểm tra khả năng `.sceneDepth` lúc chạy; iPhone không có hỗ trợ hiện “chưa đo”, không đoán camera FOV hay bật model giả.

## Cài lên iPhone từ Mac

1. Kết nối iPhone bằng cáp USB, mở khoá và chọn **Trust/Tin cậy** khi điện thoại hỏi. Chọn thử trong nhà/bàn làm việc, không thao tác lúc lái xe.
2. Mở `AssistiveDepthProbe.xcodeproj` bằng Xcode. Chọn target **AssistiveDepthProbe → Signing & Capabilities → Team**. Anh tự đăng nhập Apple Account trong **Xcode → Settings → Accounts** nếu chưa có; không gửi mật khẩu/token cho agent. Có thể dùng Personal Team cho thử trên thiết bị của mình; Apple giới hạn thời hạn/quota của signing miễn phí.
3. Bật **Developer Mode** trong **Settings → Privacy & Security** trên iPhone nếu Xcode yêu cầu. Làm bước khởi động lại/xác nhận theo hướng dẫn của Apple. Nếu mục này chưa xuất hiện, kết nối/chọn iPhone trong Xcode trước. Không cần cài app để “bẻ” chế độ developer.
4. Chọn iPhone thật ở thanh run destination, scheme **AssistiveDepthProbe**, bấm **Run (⌘R)**. Xcode sẽ ký và cài app. Bundle ID mặc định `com.roboeye.assistive.depthprobe`; nếu Apple báo ID đã thuộc Team khác, đổi prefix thuộc Team của anh trong signing settings, không thay contract JSON.
5. Trên điện thoại mở **Depth Probe → Mở camera**, cấp quyền camera. Nếu quyền bị từ chối, mở Settings để cấp lại. Nếu permission dialog làm app mất trạng thái foreground thì bấm Mở camera lại; app không tự khởi động camera khi quay lại.

Build unsigned đã kiểm tra không đồng nghĩa IPA đã ký hay app đã cài được; signing/device-trust phải qua Xcode trên thiết bị thật. Chúng tôi không mua đăng ký Apple, thay chứng chỉ/provisioning hoặc đăng nhập tài khoản thay anh. TestFlight/phát hành thương mại là bước riêng.

Apple: [tài khoản / Personal Team](https://developer.apple.com/help/account/basics/about-your-developer-account), [Developer Mode](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device).

## Đo và ghi một ca kiểm chứng

1. Chọn vật đục, không bóng, đủ sáng (mặt sách/hộp/tường). Chạm điểm **ở giữa bề mặt**, tránh mép vật. App hiện tâm ngắm xanh. Giữ tâm ngắm đúng bề mặt rồi **Đo vùng này**. Xác nhận là lựa chọn thủ công, không phải AI segmentation.
2. App lấy vùng 5×5 pixel depth, confidence cao, quy về RGB/K gốc. Số hiển thị là trung vị khoảng cách camera-tới-các-điểm của vùng hỗ trợ; không phải chiều sâu Z, khoảng trống trước người hoặc khoảng cách tới tâm bounding box. Thước phải tới cùng điểm/bề mặt từ vị trí camera; không đo từ màn hình/mép trước người.
3. Dữ liệu trộn hai bề mặt, confidence thấp, thiếu depth, mất pose, quá 300 ms hoặc ngoài 0,5–5 m → `— m` cùng lý do. Không ép hiện mét bằng số cũ. Tâm ngắm **cố định trên màn hình**, không tự bám một vật khi xoay máy; anh phải giữ nó trên bề mặt đang kiểm tra. Đổi hướng/cỡ màn hình phải chọn lại.
4. Bật **Cho phép ghi metadata** rồi **Ghi mẫu**, quan sát vài giây và **Dừng ghi**. App chỉ giữ trong RAM ≤5 Hz, tối đa 600 frame/120 giây/2 MiB JSON; hiển thị lý do dừng khi chạm trần. Muốn phiên mới, Xoá dữ liệu trước. Không lưu ảnh/video/depth tensor, âm thanh, GPS hay ID phần cứng; pose tương đối vẫn có thể tiết lộ chuyển động, không gọi metadata là “ẩn danh”.
5. **Gắn số đo thực** chỉ sau khi dừng ghi. Thông báo ghi rõ frame cuối và target `probe-1`. Nhập số đo bằng **thước** từ camera tới điểm tương ứng. Chọn phát triển hoặc kiểm định độc lập; không dùng số app đo làm ground truth. Nhãn chỉ gắn vào frame đó, không lan ra tất cả frame chuyển động. Trước mắt UI nhập thước; schema vẫn hỗ trợ laser cho pipeline dữ liệu sau.
6. **Xuất JSON → Save to Files/AirDrop**; nhập file vào lab `/assist.html` trên Mac bằng nút Nhập JSON. Native dùng cùng schema/checksum v1. Không gửi lên cloud; file xuất được chia sẻ/lưu bởi hành động của anh. Có thể import vào web để replay metadata/evaluate, không có hình video trong JSON.
7. Xoá dữ liệu hoặc đưa app về background sẽ xoá RAM/consent và dừng camera khi background; không auto-resume. Xuất JSON chạy trên utility queue, tối đa một tác vụ; hủy/thu hồi sẽ chặn công bố và tạo file. Snapshot đang serialize có thể còn tạm trong worker cho đến khi tác vụ hữu hạn hoàn tất; không nói rằng mọi byte đã bị xoá tức thì. File đã Save/AirDrop phải tự xoá. File share tạm được dọn khi đóng sheet/background; app dọn đúng prefix của mình khi khởi động sau crash.

## Lịch sử hardening 0.1.1 (build 2) / kiểm tra trước buổi demo

Phần mềm đã có: camera/đo vùng thủ công, từ chối bằng chứng yếu/cũ, ghi metadata, nhãn thước gắn đúng phiên/frame/target, xuất replay. Chưa có: nhận diện mọi đồ vật, bounding box semantic, bám vật, lời nói/haptic, chỉ dẫn đường đi. **Chỉ trình bày như prototype đo một vùng, không phải sản phẩm “con mắt ảo” hoàn chỉnh.**

UI gộp cập nhật số đo hợp lệ tối đa 10 Hz, không smoothing che lỗi; lấy mẫu vùng nhỏ tối đa 15 Hz. Heartbeat độc lập giữ giới hạn ghi ngay cả khi camera không trả frame. Máy nóng mức serious giảm tải, critical/bộ nhớ thấp dừng camera và xoá phiên. Camera đang mở giữ màn hình sáng, khi dừng khôi phục cấu hình idle timer trước đó. Không có bằng chứng phần cứng thật về các con số hiệu năng này; đây là giới hạn lịch xử lý của app, không phải FPS/latency đã đo của cảm biến.

Kiểm tra chỉ đọc trước khi cài:

```sh
npm run preflight:assistive-ios
```

Script không cài app/đăng nhập/chỉnh chứng chỉ; báo có iPhone thật và Team cấu hình hay chưa, không lưu UDID. Nếu báo thiếu thiết bị, kết nối USB/unlock/Trust rồi chọn Team và Run theo hướng dẫn phía trên. Khi cài để demo, chọn **Edit Scheme → Run → Build Configuration → Release**, không cắm debugger để đánh giá nhiệt/độ mượt. Không phải TestFlight/IPA phát hành.

**Rehearsal bắt buộc trên chính iPhone sẽ demo:**

- Mở camera lần đầu/cấp quyền; nếu trạng thái foreground đổi trong permission dialog, bấm mở lại. Hủy mở, dừng/mở 10 lần; không có camera tự bật lại.
- Tường/hộp/sách đục tại 1 /2 /3 m: chạm giữa mặt, xác nhận, giữ đúng vùng; đối chiếu thước tới điểm từ camera. Ghi/xuất/nhập web một phiên thật. Không dùng số app làm nhãn.
- Quay trái/phải, đổi portrait/landscape, che camera, rời app/khóa máy, từ chối quyền: số đo phải biến mất khi không đủ bằng chứng; xoay màn hình phải chọn lại.
- Chạy 30 phút liên tục tại nơi đủ sáng, giám sát nhiệt, giật hình và crash; thử xuất lúc camera chạy, thu hồi/xoá lúc xuất, share sheet rồi background. Ghi lại lỗi/điều kiện và JSON thật; simulator không thay thế ca này.
- Đo latency/coverage/sai số với dữ liệu và mốc thời gian kiểm chứng độc lập trước khi quảng bá “mượt realtime”. Chỉ demo trong phạm vi đã thử; không dùng dẫn đường độc lập cho người khiếm thị hoặc khi lái xe.

Nếu chưa qua rehearsal thiết bị thật, trạng thái buổi demo là **chưa nghiệm thu**, dù build/tests đều xanh. Kết quả gate và khoảng trống chức năng nằm trong `docs/COMPLETION-VERIFY-TIP-64B1-H.md`.

## 24 vị trí / gate thực tế

Sáu khoảng đặt vật dự kiến 0,5 /1 /1,5 /2 /3 /5 m × bốn điều kiện: tâm-đứng yên, mép-đứng yên, vật-di chuyển, camera-di chuyển. Plan trong web vẫn **chưa thu**; số đặt dự kiến không phải số đo thực. Bắt đầu với tâm-đứng yên, ghi riêng từng khoảng và đo lại bằng thước. Các ca chuyển động chỉ gắn nhãn tại frame/vị trí được đo độc lập (mốc trên sàn/thước có thể kiểm chứng), không gán một số cố định cho cả clip.

Development/holdout đã chia trong plan; giữ holdout độc lập, không hiệu chuẩn theo nó. Đối chiếu coverage, MAE/P95 nếu có nhãn, blackout, lệch tâm/rotation, bề mặt đen/kính/bóng/mỏng, mất pose, latency từng bước và nhiệt 30 phút. Mục tiêu nghiên cứu ≤max(0,3 m,15%) và event-P95≤300 ms là **mục tiêu**, chưa phải kết quả. ARKit frame timestamp không chứng minh mọi frame có một LiDAR exposure mới; sceneDepth không có timestamp phần cứng riêng trong API này. `capture→ready` là timestamp SDK tới sau lấy mẫu của app, chưa phải photon-to-screen/audio latency.

Các gate đo bằng thước/nhiệt 30 phút của 0.1.x chưa vượt physical gate. Cần file
ghi thật và số thước để đánh giá sai số; không dùng kế hoạch thu làm kết quả. Theo
yêu cầu mới, TIP-64B2 ưu tiên nhận diện iPhone, còn Android/Xiaomi ARCore vẫn deferred.

## Kiểm thử trên Mac / source

```sh
npm run qa:assistive-ios
```

Script dùng repo/cache build cố định, không copy project; simulator UI có watermark **Mô phỏng** và không ghi/xuất dữ liệu native. Đường fixture chỉ compile trong Debug simulator, không có trong app iPhone thật. Xcode project được sinh xác định từ danh sách source bởi `scripts/generate-assistive-ios-project.mjs`; không chạy generator sau khi anh sửa signing Team nếu chưa lưu cấu hình riêng.

Tài liệu SDK đối chiếu: [sceneDepth và point cloud](https://developer.apple.com/documentation/arkit/displaying-a-point-cloud-using-scene-depth), [confidenceMap](https://developer.apple.com/documentation/arkit/ardepthdata/confidencemap), [displayTransform](https://developer.apple.com/documentation/arkit/arframe/displaytransform%28viewrotationangle%3Aviewportsize%3A%29). Dùng API/SDK của Apple, không chép asset/model thương mại.
