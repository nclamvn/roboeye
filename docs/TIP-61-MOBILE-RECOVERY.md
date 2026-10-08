# TIP-61 — Mobile Range Recovery

Ngày 06/10/2026. Chủ nhà phê duyệt triển khai bằng “vậy triển khai ngay”.
Baseline: `8219b578cb4e3a35c105ee9d6e7580d8cd9c5efb`, branch local
`codex/tip61-mobile-reliability`. Checkout cũ không còn trên host; đã clone riêng,
không ghi đè thư mục hay thay đổi của người dùng. Không phát hành production trong TIP này.

## Hợp đồng Contractor → Builder

Triển khai tuần tự, xác minh output trước khi sửa phần tiếp theo. Bắt đầu bằng
61A/61B: evidence bền vững và tái hiện cùng hot path, không thay model, cadence,
ROI, deadline 1200 ms, distance definition hay ngưỡng cảnh báo. Kế hoạch đầy đủ
đã phê duyệt tại `../TIP-61-IMPLEMENTATION-PACK.md` trong thư mục hồ sơ cha;
file này đóng băng phạm vi và acceptance của lát triển khai đầu tiên.

| ID | Phạm vi | Output kiểm được |
|---|---|---|
| MR-01 | Build/session/model/backend identity | Compiler-injected source hash, commit, SHA weights, backend thực tế, camera dimensions, browser UA không suy đoán iOS |
| MR-02 | Durable bounded storage | IndexedDB v1, checksum SHA-256, sequence, checkpoint 2 giây, 10 phiên / 7 ngày / 10 MiB, export/import/reopen |
| MR-03 | Stage/outcome accounting | capture → dispatch → result → join → ROI → binding → publication, mỗi attempt terminal một lần, first failure giữ riêng |
| MR-08 | Realtime video harness | Video local chạy wall-clock qua sendFrame/worker/join/tracker/HUD giống camera; không pause để chờ inference |
| MR-09/10 | Đo continuity/latency, không tự tuyên bố đạt | Time-weighted availability, blackout và fresh accepted count; eligibility chưa gán thì null |
| MR-12 | Không làm rời rạc chức năng | Hồi quy camera, range/lane toggles, typecheck, unit, build và model runtime |

61A AC: reopen sau >1 phút; deny/quota/corrupt không dừng AI; stale/reset
accounting đúng; build identity đổi theo source; fixture không giả camera;
bounded state và đo overhead (≤5% là target, chưa đo đủ thì ghi pending).

61B AC: detector 1691 ms vẫn có thể hiện box nhưng không công bố metre stale;
join 950 ms chỉ còn 250 ms lifespan, không gọi render FPS là measurement rate;
3 success rồi infer error tái hiện depth stop; wrong order/epoch/ID/weak/missing
không đổi xe; edge/tiny/conflict abstain; 30 phút real-clock bounded report.
Mock và model thật phải tách. Chưa có clip highway cũ trên máy: không giả là có.
Fixture tổng hợp có hash và nguồn original code; không dùng làm distance truth.

## Scan / hypotheses / decisions

1. **STATE/DATA confirmed:** báo cáo RAM mất khi đóng tab. Thay bằng journal
   best-effort, không hứa cứu dữ liệu đã mất hoặc storage bị browser eviction.
2. **LOGIC confirmed:** WASM cadence 1200–2500 ms đối chọi freshness 1200 ms.
   Inference lâu làm thời gian label rất ngắn. Không sửa bằng tăng TTL.
3. **RUNTIME confirmed in code, phone cause not established:** infer error dừng
   metric worker; detector tiếp tục. Harness tái hiện trước khi sửa recovery.
4. GPU/thermal/ROI là hypotheses cho incident iPhone, không phải kết luận khi
   không có log thiết bị. Desktop model smoke không chứng minh phone throughput.

## Build boundary / rollback

Không thêm API, server, phần cứng, native app, model mới, external upload hoặc
GPS. Các nút chẩn đoán nằm trong Phân tích; không làm dày driving HUD. Mode test
hiện rõ `TEST REALTIME`. Source fingerprint xác định source + dependency lock
+ runtime bytes trong JS đang chạy; không giả là hash toàn binary bundle.
Checksum là integrity, không phải authenticity, encryption hay metric accuracy.
Rollback bằng revert thay đổi TIP trên branch riêng; không reset checkout người dùng.

## Bước sau

Sau khi baseline lỗi dừng được tái hiện, đã triển khai lát 61C cho **depth**:
bounded worker recovery (2 lần/60 giây, backoff 1/3 giây), instance/generation
guard, stop cancellation, pixel-free lifecycle trace. Flag baseline
`?depth-recovery=0` chỉ có tác dụng trong development. Không tự fallback inference
sang model/backend khác; chỉ giữ fallback khởi tạo WASM đã có và đã smoke-test.
Phần detector lifecycle tổng thể, device-lost/hang thực, resource soak còn pending;
không gọi toàn bộ 61C hoặc các quality gates đã hoàn tất.

61D: cạnh tranh detector/depth và scheduler. 61E: bake-off
model phù hợp mobile nếu timing không đạt. 61F: soak/phone at-rest/QA HTTPS,
ground truth độc lập trước bất kỳ tuyên bố an toàn ngoài đường.
