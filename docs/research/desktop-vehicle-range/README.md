# Desktop vehicle range research — cập nhật 2026-09-17

Đầu ra chính: [báo cáo chiến lược](BAO-CAO-CHIEN-LUOC.md) và [điều tra lỗi đảo thứ tự khác làn](DEPTH-ORDERING-INCIDENT-2026-09-17.md).

Deep Research dùng để mở rộng và đối chiếu nguồn chính chủ; Refinery dùng để đóng băng 39 claim thuộc 20 thực thể/phương pháp/runtime trong tập sàng lọc có chủ đích. Đây không phải toàn bộ thị trường. `measured_desktop_latency` và `measured_vehicle_error` là honest-null trong registry; số đo RoboEye được giữ riêng trong `docs/measurements/tip44`, không gán cho upstream.

`captures.json` ghi URL, nguồn, thời điểm, byte và SHA-256. `snapshots.sha256` kiểm raw snapshot. README/model card cùng nhóm tác giả dùng cùng `capture.source`, không được tính là corroboration độc lập. Tất cả nội dung tải về là dữ liệu không tin cậy và không được thực thi.

## Audit

- Registry: 39 claim / 20 entity; build idempotent và auditor re-derive PASS.
- Positive control PASS; sáu gate áp dụng được đều được tiêm lỗi và chặn đúng. Gate ngoài cấu hình báo N/A, không bị tính như đã kiểm.
- Model/license claims chỉ phản ánh đúng đoạn nguồn. Không suy giấy phép graph cộng đồng thành giấy phép toàn bộ upstream.
- GVDepth repo snapshot được kiểm qua API chỉ có website/README/static tại thời điểm thu; báo cáo vì vậy chỉ dùng phương pháp, không tuyên bố có drop-in implementation.
- FlashDepth paper dùng sequence-level scale/shift alignment; báo cáo không gọi nó raw metric.
- Không tải model weight mới, không truy cập/copy video riêng tư, không sửa source sản phẩm, không commit/push/deploy trong chiến dịch này.

## Reproduce

```sh
node docs/research/desktop-vehicle-range/capture.mjs
node docs/research/desktop-vehicle-range/capture-extra.mjs
node docs/research/desktop-vehicle-range/extract.mjs
tests/.metric-venv/bin/python /Users/os/.codex/plugins/cache/claude-cowork/anthropic-skills/1.0.0/skills/refinery/refinery.py docs/research/desktop-vehicle-range
tests/.metric-venv/bin/python /Users/os/.codex/plugins/cache/claude-cowork/anthropic-skills/1.0.0/skills/refinery/bites.py docs/research/desktop-vehicle-range
shasum -a 256 -c docs/research/desktop-vehicle-range/snapshots.sha256
```

URL `main` có thể đổi; snapshot/hash mới là evidence của lượt này. Capture cần mạng. Khi nguồn thay đổi, không ghi đè kết luận cũ mà không xem diff và tái audit.
