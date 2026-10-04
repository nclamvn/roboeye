# TIP-60C — Mobile live join and reliable backend startup

Status: ACCEPTED / BUILDING · 2026-10-04

## Contractor scan

User evidence: iPhone (Chrome) draws vehicles but says “Chưa đo”; Android
(Brave) draws no boxes. No phone runtime report is available yet.

Code evidence (not a claim about either phone's exact runtime):

1. Depth captures the detector frame but starts only after detection finishes.
   Their latencies add together under a 1200 ms freshness deadline.
2. Tracker rejects depth after 600 ms of media advancement and also compares
   its timestamp to `rangeAt`, which newer **unknown** ranges advance. Thus a
   correct same-frame depth result can be rejected merely because detection
   has continued.
3. Detector results over 1000 ms are discarded, including boxes. Visual
   continuity and safety freshness are conflated.
4. Module-worker crashes do not perform the clean WASM retry used for normal
   load-error messages. GPU availability is not checked before large downloads.
5. The WASM detector still fetches its model from a third party, while the
   production static-model staging covers only GPU detection and metric depth.

Runtime binary hashes match installed ORT and Transformers; a JS/WASM mismatch
is not supported by the inspected evidence. Brave-specific browser blocking is
a hypothesis, not a confirmed cause.

## Builder contract

- REQ-01: Start detector and depth on the same capture, join either result order
  in bounded memory, and invalidate joins on source/profile/geometry changes.
- REQ-02: Bind depth to the originating track IDs; reject disappeared, replaced,
  moved, weak, stale, or older measurements. Keep 1200 ms capture-to-result
  ceiling. Do not change ROI/order/zoom abstention rules.
- REQ-03: Separate bounded visual retention from capture-age freshness. Old
  boxes must not become fresh danger-warning evidence on publication.
- REQ-04: Probe the worker's GPU capability before model download; retry load
  and module errors once in a clean WASM worker. Prefer pinned same-origin
  detector assets for WASM. Retain quantized detector on CPU.
- REQ-05: Show model download/startup and concrete abstention/error reasons,
  with a retry action and pixel-free report diagnostics.
- REQ-06: Reproduce regression before changes; unit, browser orchestration,
  real-model runtime, typecheck/build and release checks after changes.

No model accuracy, zero-latency, highway-safety, or physical-phone acceptance
claim. Existing offline video flow and learned-unverified labelling remain.

## Verification scenarios

Depth before detector; depth after a newer detector frame; known vehicle with
700–1000 ms CPU inference; vanished/replaced/crossing vehicles; >1200 ms depth;
reset/resize; module failure and GPU unavailable; model 404; mobile controls.

Workflow: sequential Contractor → Builder → Contractor verification under
Vibecode Kit. Existing product architecture retained; no new hardware phase.
