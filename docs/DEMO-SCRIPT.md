# Kịch bản demo RoboEye · 6 phút show-off

Viết cho buổi Mentor Duty, share screen Zoom, khán giả là 10 team G16. Toàn bộ thao tác chỉ dùng 5 phím và chuột: 1 2 3 4, F, click. Lời thoại in nghiêng là gợi ý, nói theo giọng của mình tự nhiên hơn đọc.

## Chuẩn bị trước buổi (5 phút, làm một lần)

Cắm sạc và tắt Low Power Mode để render đạt khung hình tối đa. Mở Terminal chạy `npm run dev` trong thư mục roboeye rồi mở Chrome vào localhost:5173, bấm Mở camera. Làm việc này TRƯỚC khi share screen Zoom để quyền camera đã cấp sẵn và model đã nằm trong cache. Kiểm tra hai badge góc trái đều hiện WEBGPU. Chọn chỗ ngồi sao cho sau lưng có chiều sâu: bàn ghế, lối đi, người qua lại. Một căn phòng có tầng lớp cho demo đẹp hơn một bức tường phẳng.

Đặt sẵn Inference size ở 336. Máy chạy 14 tới 15 fps ở mức này, dư cho demo mượt.

## Beat 1 · RGB · 30 giây

Mở ở chế độ RGB. Đây là điểm neo của cả câu chuyện.

*Đây là toàn bộ những gì robot của các bạn có: một dòng ảnh phẳng 2D từ một camera vài trăm nghìn đồng. Không lidar, không depth sensor. Câu hỏi của cả buổi hôm nay là từng này thông tin thì máy hiểu được không gian đến đâu.*

## Beat 2 · Depth · 60 giây

Bấm phím 2. Đưa bàn tay từ từ lại gần camera rồi lùi ra.

*Một mạng neural 25 triệu tham số đang đoán khoảng cách cho từng pixel, ngay trên GPU của máy này, không có server nào cả. Gần thì sáng, xa thì tối. Để ý tay tôi đổi độ sáng theo khoảng cách theo thời gian thực.*

Chỉ vào đồng hồ INFERENCE ở sidebar. *Con số này là fps thật của mạng neural, khoảng 15 lần mỗi giây. Và lưu ý dòng chữ dưới cùng: đây là depth tương đối, máy biết vật nào gần hơn vật nào chứ chưa biết chính xác bao nhiêu mét. Trung thực với giới hạn là một phần của bài.*

## Beat 3 · Point Cloud · 90 giây · khoảnh khắc chính thứ nhất

Bấm phím 3. Chờ một nhịp cho khán giả nhận ra hình. Rồi kéo chuột chầm chậm sang một bên.

*Mỗi pixel kèm depth được chiếu ngược qua mô hình pinhole camera thành một điểm trong không gian. Một trăm năm mươi nghìn điểm đang được dựng lại mỗi giây. Và bây giờ tôi làm điều mà camera thật không bao giờ làm được: rời khỏi vị trí của chính nó.*

Kéo orbit ra xa để thấy mình thành khối 3D nổi khỏi nền. Đây là lúc khán giả ồ. Sau đó bấm F.

*Tôi vừa đóng băng một khoảnh khắc. Cả căn phòng thành một khối tĩnh và ta bay quanh nó.* Bay một vòng rồi bấm F lần nữa để chạy tiếp.

## Beat 4 · BEV + robot ảo · 2 phút · khoảnh khắc chính thứ hai

Bấm phím 4. Giải thích ngắn trước khi làm bất cứ gì.

*Đám mây điểm vừa rồi được ép xuống sàn thành lưới ô vuông nhìn từ trên cao. Ô trắng là có vật cản. Đây chính xác là cấu trúc dữ liệu mà mọi robot di động dùng để tránh vật cản, gọi là occupancy grid.*

Click một điểm xa trên grid. Robot ảo bắt đầu chạy theo đường A*.

*Chấm tròn này là một robot ảo. Nó vừa chạy thuật toán A* tìm đường tới đích tôi click, tự né các ô trắng.*

Giờ là cú chốt. Đứng dậy, bước ra chắn ngang đường đi của robot. Con đường trên màn bẻ cong vòng qua cụm ô trắng vừa mọc lên là chính mình.

*Tôi vừa trở thành vật cản. Robot replan mười lăm lần mỗi giây và tìm đường vòng qua tôi, ngay lúc này. Còn cái chip góc phải trên là tầng an toàn: vật gì lọt vào vùng gần camera là nó báo.*

Bước qua lại vài lần cho đường đổi theo. Đây là hình ảnh khán giả sẽ nhớ nhất.

## Beat 5 · Kết · 30 giây

Quay về phím 1 cho màn hình sạch.

*Tóm lại các bạn vừa xem trọn một pipeline robotics: perception, mapping và planning. Toàn bộ chạy trong một tab trình duyệt, không cài đặt, không server, hình ảnh camera không rời khỏi máy. Team 112 lấy được tầng BEV, team 011 lấy được planner, team 078 thấy là không cần ROS với CUDA vẫn dựng được perception, team 057 và 136 lấy được frame kèm depth. Repo mở cho mọi người, về mở link lên là nghịch được ngay.*

## Đạn cho phần hỏi đáp

Hỏi về stack: transformers.js chạy Depth Anything V2 Small bản ONNX trong Web Worker qua WebGPU, three.js WebGPURenderer với TSL cho point cloud, A* tự viết trên grid 96 nhân 96. Model 50MB tải lần đầu rồi cache.

Hỏi sao không ra mét thật: model trả relative depth theo thiết kế. Muốn metric cần calibration hoặc model metric, đó là hướng mở rộng chứ không phải lỗi.

Hỏi có SLAM không: chưa. Mỗi frame dựng độc lập, chưa ghép bản đồ qua thời gian. Cũng là hướng mở rộng tự nhiên.

Hỏi máy yếu chạy được không: có hai tầng lùi. Không WebGPU thì render rơi về WebGL2 còn inference rơi về WASM, app tự hạ độ phân giải và badge nói thật đang chạy gì. Muốn chứng minh ngay trong buổi thì mở thêm tab `localhost:5173/?webgl=1&wasm=1` cho khán giả xem bản chạy chậm nhưng vẫn sống.

## Sự cố nhanh

Camera không lên trong Zoom: đóng app khác đang giữ camera, refresh tab. Fps tụt sâu giữa buổi: kiểm tra lại sạc và Low Power Mode, hoặc kéo Inference size về 252. Robot báo KHÔNG CÓ ĐƯỜNG: đích đang nằm trong hoặc sau vật cản, click đích khác là xong. Trang trắng: nhìn Terminal xem dev server còn sống không, `npm run dev` chạy lại là lên.
