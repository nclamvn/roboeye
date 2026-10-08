# TIP-61-DEPLOY — Phát hành HTTPS cho test iPhone

08/10/2026 · P0 · phụ thuộc TIP-61 local đã core-verify.
Chủ nhà yêu cầu: “deploy lại để tôi test trên iphone”. Đây là quyền deploy
project Vercel hiện có, không phải nghiệm thu mobile hoặc quyền đổi thuật toán.

## Contractor → Builder

Working directory: checkout `DriveSense-Mobile-Recovery-2026-10-06/roboeye`,
branch `codex/tip61-mobile-reliability`. Tái dùng Vite build, `vercel.json`,
release fingerprints, self-hosted pinned models và session journal. Không push
GitHub hoặc tạo project/domain mới vì không cần cho deployment này.

## Requirements / acceptance

- DEP-01: typecheck, unit, production build, security audit/release verifier;
  không thay model/ROI/deadline/cadence để làm đẹp kết quả trên điện thoại.
- DEP-02: resolve đúng tài khoản/project `roboeye-drivesense` và deploy tới HTTPS
  hiện có. Không đổi owner, billing, access protection hoặc project khác.
- DEP-03: live `release.json` và JS running source fingerprint khớp build local;
  các worker/runtime/model cần thiết trả HTTP thành công với size/hash phù hợp.
  Check CSP + camera permission; không gọi kết quả desktop là iPhone PASS.
- DEP-04: cung cấp link cache-busting, chỉ dẫn test clip tại chỗ và xuất phiên
  chẩn đoán đã lưu; giữ explicit “PoC, không dùng để phanh/lái”.

## Decisions / boundaries

Rút gọn SCAN → TIP → BUILD/DEPLOY → VERIFY vì chỉ phát hành bản đã có. Approval
ship có trong yêu cầu hiện tại; chưa hoàn thành các performance/accuracy gates
được giữ nguyên và công bố là deferred. Không đầu tư phần cứng, không yêu cầu
lái xe để tái hiện, không bật thu pixel/GPS/upload diagnostic tự động.
Completion Report ghi cả deployment URL/identity, checks thực chạy và các giới
hạn còn chưa kiểm trên thiết bị vật lý.

Contractor adjustment: audit 08/10 phát hiện advisory mới của source-map-js và
sharp/lib­rsvg. Cho phép pin bản vá transitive tối thiểu (source-map-js 1.2.2,
sharp 0.35.5) rồi chạy lại toàn bộ gate liên quan. Không thêm accepted-risk mới,
không nâng major Transformers/ORT/Vite và không thay weights hoặc thuật toán.
Nguồn: GitHub Advisories GHSA-68fv-2mgg-jv7q và GHSA-wq5f-xc86-pv6w.
