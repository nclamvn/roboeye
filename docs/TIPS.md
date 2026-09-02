# TIP-01 → TIP-04 · RoboEye

Chủ thầu phát cho Thợ 01/08/2026, sau khi Chủ nhà approve PRD v1.0 bằng chỉ thị build trực tiếp.
Nguyên liệu gốc: registry fact F01–F11 trong PRD mục 4. Bốn TIP tương ứng bốn milestone M1–M4.

## TIP-01 · M1: Nền tảng + Depth mode

- **Dependencies:** không. **Priority:** P0.
- **Context:** project trống, tạo mới tại `roboeye/`. Stack chốt trong Blueprint (PRD mục 7): Vite + TypeScript, DOM thuần, three r182+ qua `three/webgpu`, `@huggingface/transformers` v3.x.
- **Task:** scaffold app, webcam qua getUserMedia (chọn camera, R1), Web Worker chạy pipeline depth-estimation `onnx-community/depth-anything-v2-small` device webgpu dtype fp16 fallback wasm (F01, F04), vòng inference latest-frame-wins tách khỏi vòng render (R2), chế độ Depth grayscale gần sáng xa tối, hai đồng hồ fps riêng, badge backend thật (R8), progress bar tải model.
- **Acceptance:** mở app, cho phép camera, thấy depth map sống; badge đúng backend; không xếp hàng frame khi inference chậm.
- **Constraints:** không React; không server; model Small vì license apache-2.0 (F03).

## TIP-02 · M2: Point Cloud

- **Dependencies:** TIP-01. **Priority:** P0 (xương sống demo, không bỏ).
- **Task:** chế độ Point Cloud ≥100k điểm (F08) qua sprite instanced + TSL, positionNode sample depth texture ngay vertex stage nên buffer tĩnh; unproject pinhole FOV giả định 60° có slider tinh chỉnh; màu lấy từ RGB frame cùng độ phân giải inference để depth và màu khớp orientation; nội suy vị trí giữa 2 depth frame (uMix) cho chuyển động mềm; OrbitControls; freeze/resume (R6); fallback WebGL giảm còn ~30k điểm.
- **Acceptance:** kéo camera ra khỏi vị trí webcam thấy khối phòng nhận ra được; freeze giữ nguyên khối để bay quanh.

## TIP-03 · M3: BEV + shell HIVE

- **Dependencies:** TIP-02. **Priority:** P1.
- **Task:** BEV occupancy grid 96×96 bin trên CPU mỗi depth frame, ước lượng sàn qua percentile y, band vật cản, EMA + hysteresis chống nhấp nháy (rủi ro R3 PRD), quạt FOV + marker camera, monochrome; shell HIVE theo skill lam-nguyen-style bản dark plate: sidebar đen 192px, Noto Serif brand, Inter UI, 4 nút chế độ phím 1-4, slider inference size 140–504 và point size (R7), 2 fps meter, 2 badge, ghi chú relative depth cố định (R8, F11).
- **Acceptance:** lật BEV thấy vật gần thành ô occupied; đi lại trước camera grid đổi theo; đủ 4 chế độ chuyển bằng phím.

## TIP-04 · M4: Panel + polish + fallback

- **Dependencies:** TIP-03. **Priority:** P2 (bỏ đầu tiên nếu thiếu giờ).
- **Task:** panel giải thích tiếng Việt trượt từ phải, phím ?, mỗi chế độ một đoạn cho người không chuyên (R9), FOV slider trong panel; switch fallback tường minh `?webgl=1` `?wasm=1` để demo "tắt WebGPU vẫn sống"; README kèm demo script 5 phút và mục ghi số đo F10; smoke test E2E fake webcam.
- **Acceptance:** chạy trọn kịch bản demo PRD mục 5 không vấp; làn fallback render được point cloud và inference WASM tự hạ 140px, badge nói thật.

## TIP-05 · Obstacle alert (phase 2)

- **Task:** từ BEV grid tính vật cản gần nhất trong quạt FOV, dưới ngưỡng 1.15 đơn vị thì hiện chip cảnh báo dashed góc phải trên ở mọi chế độ, kèm khoảng cách tương đối. Monochrome, không màu đỏ (HIVE: status không phụ thuộc màu).
- **Acceptance:** người bước lại gần camera thì chip hiện kèm số, lùi ra thì tắt.

## TIP-06 · Robot ảo A* trên BEV (phase 2, nối đề tài 011)

- **Task:** A* 8 hướng có binary heap trên grid 96×96, occupied inflate 1 ô thành blocked, ngoài FOV là unknown đi được với phạt nhẹ, chặn lách chéo qua khe. Robot ảo xuất phát tại camera, click lên grid đặt đích, di chuyển mượt theo render frame (1.5 đv/s), replan mỗi depth frame nên người thật bước vào là đường tự vòng qua. HUD chữ mono ghi số bước hoặc KHÔNG CÓ ĐƯỜNG. Đích mặc định tự chọn ô free xa nhất giữa FOV.
- **Acceptance:** click đặt đích thấy đường và robot chạy; đứng chắn đường thấy path bẻ cong theo thời gian thực.

## TIP-12 · Production hardening

- **Dependencies:** TIP-09, TIP-10. **Priority:** P0.
- **Task:** CI quality + real-depth lanes; CSP/Permissions-Policy; versioned service worker; local-only bounded diagnostics; explicit depth load/inference recovery.
- **Acceptance:** 7/7 REQ-P implemented; app shell assets work with the static server stopped; load retry and infer recovery are machine-tested.
- **Detail:** `docs/TIP-12-PRODUCTION-HARDENING.md`.

## TIP-13 · Product packaging and release 1.2

- **Dependencies:** TIP-12. **Priority:** P0.
- **Task:** 60-second Camera → Depth → Point Cloud → BEV tour; responsive instrument shell; version metadata; verified offline q8 build; GitHub Pages/tag release workflow.
- **Acceptance:** 7/7 REQ-R implemented; release E2E covers 375/768/1440, diagnostics export and offline cold tab; normal/offline artifacts pass verifier.
- **Detail:** `docs/TIP-13-RELEASE-PACKAGING.md`.

## TIP-14 · Detection quality and speed benchmark

- **Dependencies:** TIP-10, TIP-13. **Priority:** P0 observability.
- **Task:** regression corpus có checksum/ground truth; class-aware precision/recall/F1 tại IoU 0,5; model-ready time và inference p50/p95 trên production worker; JSON artifact theo môi trường; CI tuần/thủ công.
- **Acceptance:** 8/8 REQ-B implemented; metric unit tests, fixture integrity và real browser/WASM benchmark PASS; báo rõ corpus nhỏ không phải representative mAP.
- **Detail:** `docs/TIP-14-DETECTION-BENCHMARK.md`.

## TIP-15 · Detection post-processing and OWL-ViT query tuning

- **Dependencies:** TIP-14. **Priority:** P0 quality.
- **Task:** class-aware NMS + containment suppression cho RT-DETR; prompt template, canonical label, threshold tuning và 4 query preset cho OWL-ViT; benchmark before/after trên cùng corpus.
- **Acceptance:** RT FP 2→0 không mất TP; OWL F1 0,400→0,833 trên regression corpus; unit, E2E và real benchmark PASS.
- **Detail:** `docs/TIP-15-DETECTION-TUNING.md`.

## TIP-16 · AirSketch — Vẽ · Đoán · Nói

- **Dependencies:** TIP-13, TIP-14, TIP-15. **Priority:** P0 demo/product.
- **Task:** MediaPipe hand tracking + pinch air ink; QuickDraw top-3; reserved responsive sidecar; phrase composition and Vietnamese TTS; deterministic/real-model benchmark.
- **Acceptance:** 8/8 AIR requirements; 10/10 browser contract; pinned models load; hand p95 <80 ms trên test host kiểm soát. Shared CI dùng smoke ceiling 250 ms để bắt treo/hồi quy lớn và luôn xuất p50/p95 thực đo.
- **Detail:** `docs/TIP-16-AIRSKETCH.md`.

## TIP-17 · AirSketch recognition hardening

- **Dependencies:** TIP-16. **Priority:** P0 quality/safety.
- **Task:** replace the failing sketch classifier path; reproduce official 28×28 rasterization; cover all 345 labels in Vietnamese; add top-5, uncertainty and explicit confirmation; gate CI/release on a real official-data benchmark.
- **Acceptance:** vector pipeline top-1 ≥75% and top-3 ≥90% on the locked 20-sample corpus; 345/345 Vietnamese labels; no unconfirmed TTS; mock E2E and real-model smoke PASS.
- **Detail:** `docs/TIP-17-AIRSKETCH-RECOGNITION.md`.

## TIP-18 · AirSketch manipulation

- **Dependencies:** TIP-16, TIP-17. **Priority:** P0 demo interaction.
- **Task:** deliberate double-flick arming; index-only drawing; open-palm manipulation; pinch grab/release; bounded palm-span scaling and 2.5D scene objects.
- **Acceptance:** `idle → armed → drawing → manipulating → grabbing` is covered by unit tests; completed strokes can be selected, moved, scaled and placed without breaking classifier or pointer fallback.
- **Detail:** `docs/TIP-18-AIRSKETCH-MANIPULATION.md`.

## TIP-19 · AirSketch pen bridge regression repair

- **Dependencies:** TIP-18. **Priority:** P0 correctness.
- **Task:** restore the hand-landmark-to-ink bridge removed during T18, and guard the real worker → main thread → canvas path with browser E2E.
- **Acceptance:** deterministic pinch landmarks create one visible completed stroke; no recognition, threshold, or gesture-contract tuning is included.
- **Detail:** `docs/TIP-19-AIRSKETCH-PEN-BRIDGE.md`.

## TIP-20 · AirSketch manipulation smoothness

- **Dependencies:** TIP-18, TIP-19. **Priority:** P0 demo interaction.
- **Task:** stabilize pinch with hysteresis, adaptively filter cursor/palm span and add a bounded pickup halo for small objects.
- **Acceptance:** controlled jitter/fast-motion/hit-area unit contracts plus the existing browser path pass without changing model or gesture semantics.
- **Detail:** `docs/TIP-20-AIRSKETCH-MANIPULATION-SMOOTHNESS.md`.

## TIP-21 · AirSketch neutral hand loop and continuous composition

- **Dependencies:** TIP-18, TIP-19, TIP-20. **Priority:** P0 interaction safety.
- **Task:** make fist the explicit pen-up/transport state; require a fresh two-flick arm after every fist; preserve unlimited sequential drawings; interpolate sparse hand samples for smoother ink.
- **Acceptance:** state, multi-stroke and worker-to-canvas browser contracts pass without restoring implicit pinch drawing.
- **Detail:** `docs/TIP-21-AIRSKETCH-NEUTRAL-LOOP.md`.

## TIP-22 · AirSketch idle-to-grab entry repair

- **Dependencies:** TIP-21. **Priority:** P0 interaction correctness.
- **Task:** permit explicit open-palm entry from idle to manipulation so previously placed objects can be picked up again.
- **Acceptance:** controller and browser draw → idle → grab → place contracts pass.
- **Detail:** `docs/TIP-22-AIRSKETCH-IDLE-GRAB-ENTRY.md`.

## TIP-23 · AirSketch static-clutch grammar

- **Dependencies:** TIP-22. **Priority:** P0 interaction correctness.
- **Task:** replace double-flick arming with thumb–index pinch drawing; use fist as safe transport; require a 350 ms open-palm dwell before manipulation; retain pinch-to-grab, release-to-drop, scaling and unlimited sequential objects.
- **Acceptance:** hover never inks; pinch creates/continues a stroke; fist ends a stroke; open-palm dwell enters manipulation; grab/place contracts pass in deterministic unit and browser tests.
- **Detail:** `docs/TIP-23-AIRSKETCH-STATIC-CLUTCH.md`.

## TIP-24 · Detection lock frames and label badges

- **Dependencies:** TIP-15. **Priority:** P1 demo legibility.
- **Task:** render each live detection as an explicit mirrored rectangular lock frame with a confidence badge attached to the frame's top edge; retain selected-object emphasis and top-edge clipping safety.
- **Acceptance:** deterministic detection E2E observes one badge and one label for every lock frame, with no regression to panel or depth-source contracts.
- **Detail:** `docs/TIP-24-DETECTION-LOCK-BADGES.md`.

## TIP-26 · Motion-aware detection tracking

- **Dependencies:** TIP-14, TIP-15, TIP-24. **Priority:** P0 visual correctness.
- **Task:** carry camera capture time across the worker boundary; predict and
  latency-compensate live detection boxes before render; keep confidence-aware
  confirmation/persistence; restore T14 benchmark-locked thresholds and patch
  the available `nanoid` advisory.
- **Acceptance:** a delayed result is corrected to current display time, fast
  same-label motion remains one track, one-frame low-confidence noise is not
  rendered, and audit/benchmark preflight are green.
- **Detail:** `docs/TIP-26-MOTION-AWARE-DETECTION-TRACKING.md`.

## TIP-27 · Real-time perception recovery

- **Dependencies:** TIP-23, TIP-26. **Priority:** P0 demo reliability.
- **Task:** make detection WebGPU-first with clean WASM retry; pause depth while
  RGB detection/AirSketch need the interactive budget; propagate hand-frame
  timestamps for bounded cursor prediction; run latest-frame hand capture at
  30 fps; align visual instructions with the static-clutch grammar and expose
  detector backend/latency/cadence.
- **Acceptance:** default worker tries GPU then retries CPU if necessary;
  worker-to-ink timestamp compensation is unit-covered; deterministic browser
  contracts cover drawing, grab/place and detection locks; no stale double-flick
  instruction remains.
- **Detail:** `docs/TIP-27-REALTIME-PERCEPTION-RECOVERY.md`.

## TIP-28 · AirSketch direct-manipulation recovery

- **Dependencies:** TIP-23, TIP-27. **Priority:** P0 interaction correctness.
- **Task:** remove the coordinate discontinuity caused by changing from index
  tip to thumb-index midpoint on pinch; separate predicted ink/display from
  stable object hit-test/move coordinates; permit a natural open-hand pinch
  after deliberate manipulation entry; tolerate a brief tracking miss; and
  expose full capture-to-main pipeline latency alongside worker inference.
- **Acceptance:** pinch starts without a cursor jump; open-palm → open-pinch
  grabs an existing object; one missing landmark result does not split a
  stroke; unit/E2E contracts and build pass; benchmark exports p50/p95 for
  the complete hand pipeline.
- **Detail:** `docs/TIP-28-AIRSKETCH-DIRECT-MANIPULATION.md`.

## TIP-29 · AirSketch continuity and visible-cursor pickup

- **Dependencies:** TIP-28. **Priority:** P0 interaction correctness.
- **Task:** preserve an active draw while thumb–index remains pinched despite
  noisy classifications of the other fingers; centralize bounded tracking-loss
  release; and align object hit-testing with the cursor the user can see while
  retaining a stable motion anchor.
- **Acceptance:** a transient open-palm classification does not split a
  pinched stroke; 180 ms tracking loss is held while 240 ms releases; selecting
  via the visible cursor does not teleport the object on its first stable move.
- **Detail:** `docs/TIP-29-AIRSKETCH-CONTINUITY-PICKUP.md`.

## TIP-30 · AirDesk direct content manipulation

- **Dependencies:** TIP-29. **Priority:** P0 demo interaction.
- **Task:** expose all five fingertips as visible yellow affordances; create a
  separate pinch-driven desk for moving, scaling, rotating, flipping and
  annotating an image, plus selecting and editing an internal text note.
- **Acceptance:** five landmarks render while a hand is detected, extended
  fingers have a halo, pinch acts as press/drag, image actions and text
  copy/cut/delete/spelling proposal work without entering AirSketch.
- **Detail:** `docs/TIP-30-AIRDESK-DIRECT-MANIPULATION.md`.

## TIP-31 · Zero-lag hand interaction pipeline

- **Dependencies:** TIP-29, TIP-30. **Priority:** P0 product viability.
- **Task:** schedule capture on real video frames; measure honest capture and
  source-frame age; use GPU-first MediaPipe with CPU fallback; apply a
  timestamp-aware 1€ filter; enlarge noisy hand target acquisition; eliminate
  redundant canvas/DOM/SVG work; and allow direct spatial pinch-to-grab.
- **Acceptance:** unit contracts cover filtering, prediction, targeting and
  direct pickup; real-model smoke gates capture/hand/pipeline p95; full release
  verification remains green.
- **Detail:** `docs/TIP-31-ZERO-LAG-HAND-INTERACTION.md`.
