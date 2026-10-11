# TIP-64B3-I — Cài iPhone / Completion & VERIFY

2026-10-11 · Vibecode-kit v6.2 · **DONE, READY cho người dùng test có kiểm soát**.

Đã cập nhật trực tiếp **RoboEye Assist0.2.0(3) →0.2.1(4)** trên iPhone16ProMax /
iOS27.0.1 được kết nối thật. Không uninstall, không đổi Team/bundle/chứng chỉ,
không regenerate project, không cài thêm model/dependency. Đọc lại installed-app
inventory xác nhận đúng0.2.1/build4; default launch thành công không debugger,
cùng tiến trình được quan sát sau ít nhất5 giây chờ tường minh.

## VERIFY

Requirement coverage: **5/5 =100%** phạm vi cài; scenario **5 PASS,0 FAIL**.

| REQ | Kết quả |
|---|---|
| I01 | PASS: iPhone physical connected, Developer Mode enabled; source trước/sau signed build khớp final QA |
| I02 | PASS: Signed Release exit0; codesign deep/strict exit0; đúng Team/bundle0.2.1(4), compiled model/license giữ nguyên |
| I03 | PASS: install exit0, cập nhật cùng app, không uninstall hay xóa dữ liệu người dùng |
| I04 | PASS: đọc lại0.2.1/build4, launch success, đúng executable/process còn chạy ở kiểm tra ngắn |
| I05 | PASS: receipt đã bỏ identifiers, không tự yêu cầu camera/ghi metadata, giới hạn được nêu rõ |

Technical health: **1/1 Signed Release build PASS**,0 compile errors;
**1/1 codesign PASS**,1/1 installed readback PASS,1/1 default launch PASS,
1/1 short process check PASS. Chỉ signed build và kiểm thiết bị được chạy trong
lượt operational này; không tuyên bố đã rerun unit/UI. Final QA trước đó vẫn
khớp nguồn:94/94 Swift,16/16 UI,7/7 interop,3/3 actual model smoke.

Source fingerprint:
`cf755b7ee07b2b55bf3d96ef0233e80b62a02fd8262aa70290717ef2a8271f04`.
Không application-source/config change; bằng chứng B1/B2 không đổi.

Receipt: [phone-install-2026-10-11.json](evidence/tip64b3/phone-install-2026-10-11.json).
TIP: [TIP-64B3-I-PHONE-INSTALL.md](TIP-64B3-I-PHONE-INSTALL.md).

## Người dùng test

App đã mở ở trạng thái mặc định. Kiểm tra header0.2.1, chọn **Tự động → Mở camera**.
Thử trong nhà đủ sáng với người, ghế, tủ lạnh hoặc sách ở1–3 m; số `≈… m` chỉ
hiện khi depth hợp lệ. Quạt chưa có lớp trong model hiện hành. Model chạy offline,
không cần Mac sau khi cài. Không dùng app dẫn đường độc lập hay lái xe.

Nếu thiếu khung/số, mở **Chẩn đoán** và ghi lại lý do/timing cho ca cụ thể.
Kế hoạch: [TEST-PLAN-TIP-64B3-DEVICE.md](TEST-PLAN-TIP-64B3-DEVICE.md).

## Deferred / giới hạn

Short idle process check không chứng minh không crash/lag dài phiên, camera
recall, foreground đúng vật, sai số mét hoặc độ bền nhiệt30 phút. **4 nhóm gate
chất lượng vật lý vẫn UNTESTED**: performance/endurance, precision/recall/ID,
range+refusal coverage, VoiceOver/user trial. Gate cài/launch đã đóng; các gate
P0 của dẫn đường không được đóng bằng kết quả cài app.

Không tự truyền `--qa-live-camera`, bật camera, ghi metadata hoặc tải pixel lên
mạng. Người dùng chủ động bấm Mở camera. Không commit/push/deploy web.
Reuse `.build-xcode`, không tạo tmp/project copy/build tree ngoài repo; disk53GiB
free trước build. Chỉ thêm TIP, receipt sanitized và report này; raw device-tool
metadata để trong cache ignored, không đưa vào receipt công bố.
