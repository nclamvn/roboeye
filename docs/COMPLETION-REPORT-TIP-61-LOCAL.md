# Completion Report — TIP-61 local recovery foundations

06/10/2026 · Contractor/Builder luân phiên cùng phiên làm việc.

**Status: IMPLEMENTED + CORE VERIFIED, NOT MOBILE-ACCEPTED / NOT RELEASED.**
Phạm vi hoàn tất ở mức code: TIP-61A/B foundations và lát 61C cho depth worker.
Không tuyên bố hoàn thành toàn bộ kế hoạch 61A–61F hoặc sửa xong incident iPhone.

## Output

- IndexedDB journal v1: checkpoint 2 giây, SHA-256 integrity, sequence, reopen,
  export/import, 10 phiên / 7 ngày / 10 MiB, giữ summary active, lỗi storage không
  dừng inference. Checkpoint đang ghi + tối đa một bản mới nhất/phiên, không queue
  mọi frame. Không lưu pixel, video, GPS, camera label, device/group ID hoặc path.
- Build/source fingerprint compiler-injected, commit fallback Vercel/Git,
  weight/processor SHA, policy và backend resolved. UA được ghi theo API thực,
  không tự đoán phiên bản iOS hoặc cấu hình phần cứng.
- Stage ledger bounded 128 details / 8 inflight, cumulative counters + first
  failure, không đếm đôi stale rồi late result, không gọi watchdog là inference time.
  Publication stage là **validated HUD admission**, không phải sensor exposure
  hoặc display scanout. Availability là time-weighted HUD state; eligibility
  chưa được annotate thì null, không tự loại cửa sổ model thất bại.
- UI Phân tích: “Test realtime bằng video”, lặp clip với epoch mới; cùng
  sendFrame/worker/join/tracker/HUD như camera, clock thật, không preanalyse.
  Provenance `fixture-live-replay`, hash clip (≤100 MiB; lớn hơn ghi unavailable),
  không suy ra quyền khai thác dataset từ việc người dùng chọn file.
- Depth recovery: state machine, tối đa 2 retry/60 giây, backoff 1/3 giây,
  hủy trên stop/toggle/source/visibility/reset, một worker active và bỏ callback
  worker cũ. Sau budget → DEGRADED, detector không bị tắt theo. Không fallback
  inference sang một model mới; giữ fallback startup WASM đã có.
- Không đổi cadence, weights, letterbox, ROI, near/far invariant, ID binding,
  deadline số mét 1200 ms hoặc cảnh báo. Không sửa các tính năng bàn tay khác.

## Evidence → hypothesis → verify → fix

| Vấn đề | Bằng chứng độc lập trong phiên | Quyết định |
|---|---|---|
| Báo cáo RAM mất khi đóng trang | Scan app/export/pagehide; test reload thật sau >1 phút | Journal local bounded, không hứa khôi phục JSON lịch sử |
| Box sống nhưng metre không hiện | Fault detector 1691 ms; join stale, ledger không accepted metre | Giữ abstention; vấn đề throughput còn phải xử lý |
| Depth dừng, box vẫn chạy | Mock 3 success → infer error → 4 attempts rồi đứng | Reproduce baseline bằng flag development, sau đó sửa bounded recovery |
| WASM vượt deadline | Model thật trên host Chrome: detector P50 1688,6 ms, P95 1696,2 ms | Baseline runtime không đạt ngân sách 1200 ms; không tăng TTL |
| GPU nhanh hơn trên host này | WebGPU detector P50 56,2/P95 56,8 ms; depth P50 39,6/P95 43,5 ms | Chứng minh tiềm năng backend, không suy ra iPhone có/đạt WebGPU |

Depth WASM riêng trên cùng host: P50 821,7/P95 839,9 ms. Detector đo 3 lượt
sau 1 warmup; depth WASM 3/GPU 21 lượt. Các worker đo riêng, không phải concurrent
camera soak, không có distance ground truth. Model nhận bus, metre là output
chưa kiểm chứng; không dùng số đó để chứng minh accuracy. Xem `evidence/tip61/`.

## Verification

| Gate | Kết quả / giới hạn |
|---|---|
| TypeScript strict | PASS |
| Unit toàn repo | **296/296 PASS** (15 test mới, baseline 281) |
| Build | PASS; weights và processor size/SHA đã pin được verify |
| Journal/realtime fixture E2E | **4/4 PASS**: >1 phút rồi reload, stale 1691 ms, 3 success rồi stop, storage denied nhưng AI tiếp tục |
| Depth recovery E2E | **3/3 PASS**: một lỗi hồi phục, lỗi lặp chạm budget, stop trong backoff; max active metric worker = 1, callback worker cũ bị bỏ |
| Live camera regression | **6/6 PASS**, camera giả / workers mock |
| Range/lane toggle regression | PASS, 7 checks desktop/mobile viewport; không phải phone hardware |
| Real model runtime | PASS WASM + WebGPU, external browser requests bị chặn; weights self-hosted |
| Integrity/retention/quota/corrupt | Unit PASS; actual Chromium IndexedDB reopen + deny PASS |
| Long bounded accounting | Unit 72.000 attempts / synthetic 2-hour timeline PASS; **không gọi là 2 giờ soak clock thật** |
| Storage overhead ≤5% | **PENDING**, chưa có A/B capture/render benchmark đủ điều kiện |
| 30-minute real-clock fixture / 2-hour soak | **PENDING** |
| Mobile + physical metres | **UNVERIFIED / UNVALIDATED** |

Test vận hành đã phát hiện và sửa hai lỗi của **test harness**, không phải ngụy
trang lỗi sản phẩm: chờ script smoke cài handler trước khi click; mở panel
Phân tích trước khi chọn phiên sau reload. Test stop-backoff phải chờ error đã
được nhận, không chỉ chờ dispatch frame lỗi. Chrome automation cần quyền chạy
ngoài sandbox trên host; chỉ camera giả/video tổng hợp được dùng.

## Coverage / pending acceptance

61A: AC 1–5 có core evidence; AC 6 bounded-state có evidence nhưng overhead còn
pending. 61B: AC 1/3 có browser evidence; lifespan 950→1200 được unit đo, wrong
order/epoch/ID/weak/missing và ROI/conflict có tests hiện hữu; corpus highway thật
≥3 phút/multi-scene/occlusion có independent labels và AC 6 soak còn pending.
61C: chỉ lát depth lifecycle được triển khai/kiểm; device-lost/hang thật, resource
soak và detector recovery tổng thể chưa được nghiệm thu. Không tô toàn TIP xanh.

Continuity target ≥95%, fresh accepted ≥5 Hz, capture→publication P95 ≤300 ms
là **engineering targets chưa đạt/đủ evidence**, không phải chuẩn an toàn.
Cadence cũ tối đa 2 Hz và WASM interval 1200–2500 ms vẫn tồn tại, nên không thể
tuyên bố mobile realtime đạt mục tiêu chỉ vì recovery test PASS.

## Handoff và bước đúng tiếp theo

UI local: `http://127.0.0.1:4192/drive.html?v=tip61-recovery`.
Trong Phân tích → Nguồn local → **Test realtime bằng video**, chọn clip cũ.
Phiên tự lưu; reload rồi xuất qua **Phiên chẩn đoán đã lưu**. Nút Mở video thường
vẫn là offline analyse/replay, không bị thay bằng test mode. Không cần lên ô tô,
không mua/setup phần cứng, không thao tác app khi đang lái.

Tiếp theo: đóng các soak/overhead gates, rồi TIP-61D/61E benchmark cạnh tranh
CPU/GPU và bake-off cấu hình nhẹ trên cùng corpus. Sau đó QA HTTPS để chạy clip
trên điện thoại **đứng yên**, thu report và xem lý do không đo. Không có log cũ
nên chưa thể kết luận GPU, thermal hoặc ROI là nguyên nhân chính của buổi iPhone.

Code nằm ở checkout mới có branch riêng; không cần git apply patch vào checkout
cũ. Chưa commit/push/deploy production trong request này. Rollback từng lát bằng
revert thay đổi của branch; không reset dữ liệu người dùng. Flag baseline
`depth-recovery=0` chỉ development, không phải công tắc bỏ safety gate.
