# TIP-64B3-I — Cài bản QA đạt lên iPhone

2026-10-11 · Vibecode-kit v6.2 · depends on TIP-64B3 final QA.

Nguồn yêu cầu: người dùng cho phép cài bản tốt mới và sạch nhất lên iPhone để
chủ động test. Đây là bàn giao operational, không đổi application code/model.
Gộp scan/blueprint/checkpoint: đã có QA và người dùng trực tiếp duyệt cài;
không cần một vòng thiết kế mới. Contractor thực hiện build/install/verify,
không cần Builder sửa code. Jev OFF.

## Contract

| REQ | Acceptance |
|---|---|
| I01 | Có iPhone thật kết nối; xác minh source vẫn khớp final QA B3 |
| I02 | Signed Release build 0.2.1/build4, bundle/Team/license/model giữ nguyên |
| I03 | Cập nhật đúng app trên đúng thiết bị; không uninstall/xóa dữ liệu khác |
| I04 | Đọc lại phiên bản/build từ installed-app inventory; mở app mặc định nếu máy cho phép |
| I05 | Lưu receipt đã bỏ identifiers, báo rõ camera/accuracy/30 phút chưa kiểm trong lượt cài |

## Constraints

Reuse checkout và `native/ios/.build-xcode`; disk>=20 GiB trước build. Không
reset git, regenerate project, đổi tài khoản/chứng chỉ/trust, cài app khác,
commit/push/deploy web. Không thêm dependencies/models hay copy project ra tmp.
Không truyền `--qa-live-camera`, không tự bật camera/ghi metadata. Default launch
chỉ đưa app tới màn hình chờ để người dùng bấm Mở camera. Nếu iPhone khóa, giữ
receipt cài và yêu cầu người dùng mở khóa; không vượt cơ chế khóa.

## Verify

Source fingerprint before/after signed build, build exit, codesign strict,
offline model/license, installed0.2.1(4), default launch exit/process, quantitative
5 requirements và deferred physical gates trong completion report riêng. Không
ghi đè receipt software QA hoặc báo cáo lịch sử.
