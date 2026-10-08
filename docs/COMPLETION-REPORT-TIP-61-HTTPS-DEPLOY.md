# Completion Report — TIP-61 HTTPS/iPhone test release

08/10/2026 · Contractor/Builder release verification · **DEP-01–04 complete**.
Đây là hoàn tất phát hành bản test, không phải nghiệm thu đo khoảng cách mobile.

## Kết quả phát hành

- Project hiện có: `nclamvn-gmailcoms-projects/roboeye-drivesense`.
- Deployment: `dpl_2xdNgvTnzA3VK5gukp39BQVhe4Kw`, production **READY**;
  CLI inspect canonical domain xác nhận alias tới đúng deployment này.
- Canonical: https://roboeye-drivesense.vercel.app
- Link test: https://roboeye-drivesense.vercel.app/drive.html?v=tip61-8f1650d04912
- Deployment URL: https://roboeye-drivesense-du9gcfml0-nclamvn-gmailcoms-projects.vercel.app
- Release version `1.5.0`, build fingerprint `8f1650d04912`.
- Source SHA256 `79dd54fe6d497c1b99f0e4f7cad328413d1c6876cc71713841719a6ddc936407`.
- Runtime fingerprint `e1fda66b8d99`; baseline commit `8219b578cb4e`.

Bản deploy gồm thay đổi TIP-61 local chưa commit. Baseline commit không đại diện
cho toàn bộ thay đổi; source fingerprint trong JS và SHA của assets là nhận dạng
bản chạy. Không commit/push GitHub, không tạo project/domain hay đổi billing.

## Verification / requirements trace

| Requirement | Bằng chứng thực chạy | Kết quả |
| --- | --- | --- |
| DEP-01 | Strict typecheck; unit 296/296; production build; pinned model prebuild; release verifier 5/5; security audit | PASS |
| DEP-02 | Vercel link project đã có, local prebuilt build, production deploy + inspect canonical alias | PASS |
| DEP-03 | Public canonical HTTPS: release identity, HTML/JS/CSS, 3 workers, ORT JS/WASM, 3 ONNX weights, detector config/processor; streaming size/SHA comparison; CSP/camera permission | 17/17 PASS |
| DEP-04 | Link mới + hướng dẫn clip tại chỗ/xuất phiên đã lưu; giới hạn PoC giữ nguyên trong UI và handoff | PASS — physical phone acceptance deferred |

Regression rerun sau patch dependency: mobile-live E2E **6/6**, metric-lifecycle
recovery E2E **3/3**. Đây là real app với fake camera/mocked workers, chứng minh
orchestration/lifecycle; không chứng minh độ chính xác hoặc latency iPhone.

Desktop Chromium HTTPS UI smoke ở viewport **430×932**: trang load 200,
camera entry visible/enabled; Analysis mở/đóng; fixture input/loop, journal
import/export hiện diện, IndexedDB khởi tạo; **0 page JS errors**. Không mở camera
thật, không gọi test này là Chrome/iOS acceptance.

Machine evidence và ảnh:

- `docs/evidence/tip61/https-deploy-verification.json`
- `docs/evidence/tip61/https-ui-smoke.json`
- `docs/evidence/tip61/https-phone-viewport.png`
- Re-run: `node tests/drive-tip61-https-verify.mjs https://roboeye-drivesense.vercel.app`
- UI smoke: `node tests/drive-tip61-https-ui-smoke.mjs`

Toàn bộ model được GET từ public production và hash theo stream, không chỉ HEAD
hay đối chiếu local. Model depth **99,159,817 bytes**, WebGPU detector **81,033,458
bytes**, WASM q8 detector **20,991,219 bytes**; tất cả SHA256 khớp bản pin.
Camera permissions `camera=(self)`, CSP worker self/blob + script self/WASM;
không yêu cầu microphone/GPS. Prebuilt static file scan: không có private
env/auth/.git file. OIDC/env Vercel nằm trong file ignored, không đưa vào static
output/evidence. Cấu hình cross-origin isolation/threading không thay đổi.

## Contractor adjustment: security gate

Audit đầu phiên gặp advisory mới nên không bỏ qua gate. Pin transitive
`source-map-js=1.2.2`, `sharp=0.35.5`, cập nhật lock bằng npm và rerun tests/build.
Không nâng Transformers/ORT/Vite, không thay model, ROI, cadence hay TTL.
Audit sau patch: **0 high, 0 critical**, còn **4 moderate**; không tuyên bố zero
vulnerabilities. Native sharp không xuất hiện trong browser export/bundle.

Nguồn patch:
[source-map-js advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q),
[sharp/librsvg advisory](https://github.com/advisories/GHSA-wq5f-xc86-pv6w).

## Handoff / deferred acceptance

1. Mở link mới trên iPhone, dùng Wi-Fi cho lần tải model đầu; HTTPS app không cần
   máy tính làm server. Chưa đo latency/download trên thiết bị vật lý.
2. Ưu tiên **Phân tích → Nguồn local → Test realtime bằng video** với clip có sẵn,
   tại chỗ; đây là wall-clock live hot path, khác Mở video/offline analyse.
3. Có thể mở camera và cấp quyền tại chỗ. Không yêu cầu lên cao tốc để tái hiện;
   không vừa lái vừa thao tác, không dùng PoC để quyết định phanh/lái.
4. Sau test: **Phân tích → Phiên chẩn đoán đã lưu → Xuất phiên đã lưu**. Journal
   checkpoint mỗi 2 giây, không pixel/GPS/upload; storage best effort có thể bị
   hệ điều hành/browser thu hồi. Không xoá dữ liệu trang trước khi xuất JSON.

Độ phủ mét liên tục, thermal soak/latency thực iPhone và metric ground truth vẫn
**chưa nghiệm thu**. TTL 1200 ms và fail-closed range admission giữ nguyên. Bản này
đưa diagnostic ledger/journal và bounded depth recovery lên HTTPS, chưa hoàn tất
mọi TIP-61A–F và chưa có chứng cứ bảo đảm đã giải quyết incident 30 phút.
