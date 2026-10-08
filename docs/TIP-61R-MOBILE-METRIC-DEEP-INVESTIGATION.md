# TIP-61R — Điều tra độc lập và nghiên cứu mobile metric

08/10/2026 · P0 · phụ thuộc bản production TIP-61 `8f1650d04912`.
Owner: xe dừng đèn đỏ trên iPhone vẫn có box nhưng chỉ “chưa đo”.

## Contractor → Builder

Dừng quick fix. Lần này chỉ điều tra/tái hiện/nghiên cứu/đề xuất, không sửa `src/`,
model, runtime lock, TTL, UI hoặc deploy. Builder được tạo diagnostic tests và
evidence/docs; không dùng kết quả mock/desktop làm chứng cứ lỗi thiết bị thật.
RRI rút gọn: đã rõ iPhone Chrome, camera tại chỗ cũng fail, mục tiêu metric hữu
ích/có độ phủ và bounded latency, không đầu tư phần cứng/không yêu cầu ra đường.

## Requirements / acceptance

- R-01: trace từ capture đến HUD với line references; phân biệt load/runtime,
  deadline/scheduler, ROI/binding/publication và hình học/scale.
- R-02: tái hiện stationary boxes bằng implementation thật của join/tracker/ROI,
  quét latency/cadence; ghi time-weighted coverage, không suy luận phone timing.
- R-03: kiểm tra kiểm thử hiện tại đã chứng minh gì/chưa chứng minh gì; model
  smoke độc lập không được coi là combined realtime acceptance.
- R-04: research primary sources rộng: runtime, compact metric/relative models,
  calibrated geometry, temporal propagation và native escape hatch; có license,
  snapshot/SHA/evidence span. Không dùng marketing GPU FPS như iPhone FPS.
- R-05: refinery registry/auditor/bites chạy từ nguồn đóng băng; no iPhone
  benchmark thì honest-null, relative depth không đổi nhãn thành mét.
- R-06: kiến trúc đề xuất + task graph + định nghĩa accuracy/availability/latency
  gates + rollback/risks, phân biệt confirmed mechanism và incident hypothesis.

## Investigation hypotheses

H1: join 1200ms/cadence và contention làm mất metric trong khi box 2500ms còn.
H2: depth FP32/session bị fail/load/degraded, detector fallback vẫn chạy.
H3: ROI/zoom/ground-contact consistency/binding abstain, kể cả ảnh đứng yên.
Không hypothesis nào tự trở thành root cause iPhone khi chưa có journal device.

## Boundaries / decisions

Vibecode Debug Protocol được kích hoạt vì failure lặp lại. SCAN → evidence TIP
→ diagnostic/research → VERIFY REPORT, không đến FIX/SHIP trong task này.
Refinery chỉ cho public web facts, không “tinh lọc” lời owner như fact bên ngoài.
Không xin JSON cũ đã mất, không xin test lái xe; JSON phiên mới nếu còn là bổ sung
không chặn nghiên cứu. Không tự thay bằng server/API/native app/hardware.
Approval kiến trúc mới trước implementation; không tăng TTL để tạo cảm giác đo.

Output: report điều tra + research registry + diagnostic evidence + Completion
Report. Product acceptance luôn NOT READY cho continuous iPhone range đến khi
physical-device và metric truth gates thật đạt.
