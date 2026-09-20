# TIP-50R-D4 — Local road/lane test UI

## Header / context

- Project: DriveSense; dependency: D3; priority: P0.
- Working directory: `roboeye-live`; reuse D3 vectorizer, ONNX Runtime worker,
  DriveSense video/canvas contain transform and floating dock.
- Scan: D3 exists only in benchmark scripts. The video UI cannot show it.

## Contractor decision / task

User explicitly requests UI integration. This authorizes an **experimental local
visualization**, superseding D3's no-HUD restriction only for this test surface.
The result must not change distance, risk corridor, audio or driving decisions.
No new interview: the user's request supplies scope. Alternate Contractor →
Builder → verification within this task; no public deployment or model redistribution.

Add an explicit Test lanes entry and dock toggle. Process the displayed file or
camera frame, single-flight in a worker; skip frames under load, never build a
queue. Lane-only file testing bypasses expensive vehicle/depth pre-analysis.
Completed vehicle replay remains usable with the overlay. Reuse pinned real
local model; serve it only in Vite development from an ignored research cache.

## Requirements / acceptance

1. R1: Given a local video, Test lanes shows real segmentation/path results
   without waiting for vehicle/depth analysis; play, pause and seek work.
2. R2: Overlay uses the video's contain transform, with lane toggle, optional
   surface mask, concise visible state, details and downloadable diagnostic JSON.
3. R3: Empty/ambiguous evidence draws no fabricated lane; stale/future samples,
   seeking, source changes and disabled mode cannot retain old geometry.
4. R4: Loading, model unavailable/hash mismatch, runtime failure and retry are
   visible; stop/toggle frees worker resources; no inference backlog.
5. R5: No experimental geometry enters range/risk policy. Synthetic demo is
   explicitly unsupported. Production build never bundles the research weights.
6. R6: Unit tests, actual-model browser video smoke, mobile layout and build pass;
   measured latency is reported, not represented as validated realtime performance.

## Design

Keep the camera/video as the main surface. Existing Inter typography, cabin
#10222c, text #e3eef4, cyan #66dcff (left), violet #bd9aff (right), amber #ebbf72
(curb pixels). One dock control and a compact upper-left state; technical detail
stays in the existing analysis drawer. No new modal/card dashboard or flashing.

## Constraints / report

Do not retrain/tune D3 on reviewed clips, claim safe drivable space, label
curbs as confirmed medians/guardrails, or claim metric accuracy. Produce completion
and quantified verification report; preserve unrelated working-tree changes.
