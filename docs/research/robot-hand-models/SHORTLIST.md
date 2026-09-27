# RoboHand Studio — shortlist thay mô hình bàn tay

Ngày rà soát: 2026-09-26

## Kết luận

**Ưu tiên 1: Sharpa Wave.** Đây là ứng viên phù hợp nhất với RoboHand Studio vì đồng thời có hình thái humanoid hiện đại, 5 ngón, 22 bậc tự do chủ động, asset tay trái/tay phải/dual-hand, giấy phép Apache-2.0 và pipeline retargeting webcam chính chủ dùng MediaPipe + hiệu chuẩn + IK.

**Ưu tiên 2: Shadow Hand E3M5.** Trưởng thành, 24 khớp, cấu trúc ngón/palm flex tốt và license rõ. Hình thức thiên về robot nghiên cứu/cơ khí hơn Sharpa.

**Lớp kiểm soát giải phẫu: NIMBLE.** Không dùng NIMBLE làm ngoại hình robot cuối cùng. Dùng nó làm reference để kiểm giới hạn sinh học, tỷ lệ đốt và pose regression; mesh robot vẫn là Sharpa.

## Ma trận quyết định

| Ứng viên | 5 ngón | Rig/DoF | Trái/phải | Quyền dùng | Khớp với Three.js | Quyết định |
|---|---:|---|---|---|---|---|
| Sharpa Wave | Có | 22 active DoF | Có + dual | Apache-2.0 | Tốt sau bước URDF/USD → GLB | **Chọn để prototype** |
| Shadow Hand E3M5 | Có | 24 joints / 20 actuated | Có | Apache-2.0 | Tốt sau DAE/OBJ → GLB | Phương án dự phòng |
| SCHUNK SVH | Có | 20 axes/DoF | Có sản phẩm L/R | CAD theo yêu cầu | Chưa rõ quyền phân phối | Chỉ tiếp tục nếu lấy được CAD/license |
| Aero Hand Open | Có | 7 DoF / 16 joints | Chưa phải lợi thế chính | CAD non-commercial | Khá | Không đủ vi chuyển động cho demo cao cấp |
| NIMBLE | Human | bones + muscles + skin | Human model | MIT repo; cần rà model data | Phải bake/export | Reference giải phẫu, không phải visual robot |
| MANO | Human | articulated parametric | Human model | Commercial license riêng | Phải bake/export | Không dùng mặc định cho sản phẩm thương mại |

## Vì sao thay mesh đơn thuần chưa đủ

Renderer hiện tại dựng từng đốt bằng hình học procedural và hướng chúng trực tiếp theo chuỗi điểm. Cách này làm từng segment trông như khối rời, còn sai số landmark có thể đổi trục xoay từng khớp. Model mới phải được điều khiển bằng **góc khớp có giới hạn**, không kéo giãn vertex/đốt theo landmark.

Pipeline đề xuất:

1. MediaPipe 21 landmarks giữ vai trò quan sát.
2. Hiệu chuẩn từng bàn tay để chuẩn hóa tỷ lệ lòng bàn tay và từng ngón.
3. IK/retargeting tối ưu mục tiêu đầu ngón + hướng lòng bàn tay.
4. Joint limits theo đúng URDF; tách MCP flex/abduction, PIP, DIP và thumb CMC opposition.
5. Coupling PIP–DIP và collision/self-penetration guard.
6. Xuất asset thành GLB với hierarchy khớp và rigid-link mesh đúng URDF; chỉ dùng `SkinnedMesh` nếu bổ sung lớp vỏ mềm. Mỗi tay dùng skeleton riêng, không mirror bằng negative scale.
7. Giữ physics/contact riêng cho điện thoại, sách và vật thể cầm nắm.

## Link duyệt

- Sharpa Wave product: https://www.sharpa.com/pages/wave
- Sharpa official assets: https://github.com/sharpa-robotics/sharpa-urdf-usd-xml
- Sharpa official webcam retargeting: https://github.com/sharpa-robotics/sharpa-vision-retargeting-sdk
- Shadow Hand product: https://shadowrobot.com/dexterous-hand-series/
- Shadow E3M5 assets: https://github.com/google-deepmind/mujoco_menagerie/tree/main/shadow_hand
- SCHUNK SVH: https://schunk.com/us/en/gripping-systems/special-gripper/svh/svh-rechte-hand/p/000000000001545592
- NIMBLE: https://github.com/reyuwei/NIMBLE_model
- MANO license: https://mano.is.tue.mpg.de/license.html

## Ảnh preview chính thức

### Sharpa Wave

![Sharpa Wave](https://raw.githubusercontent.com/google-deepmind/mujoco_menagerie/main/sharpa_wave/sharpa_wave.png)

### Shadow Hand E3M5

![Shadow Hand E3M5](https://raw.githubusercontent.com/google-deepmind/mujoco_menagerie/main/shadow_hand/shadow_hand.png)

### Aero Hand Open

![Aero Hand Open](https://raw.githubusercontent.com/google-deepmind/mujoco_menagerie/main/tetheria_aero_hand_open/aero_hand_open.png)

### NIMBLE — reference giải phẫu

![NIMBLE anatomy model](https://liyuwei.cc/proj/img/nimble_teaser.jpg)
