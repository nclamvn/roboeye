# TIP-60C — Software regression verified; mobile acceptance pending

Date: 2026-10-04 · Sequential Contractor/Builder/Contractor under Vibecode Kit.

## Outcome

Fixed the reproducible capture/result join defect and startup failure paths.
This is **not** a claim that real-time metres now work on every phone.

The baseline regression returned `0` applied measurements after a newer
unknown detector observation, despite same-frame depth being valid. It now
passes with an immutable originating-track binding. New detector observations
no longer block depth merely by advancing an unknown range's timestamp.
Detector and depth start together instead of adding their latency.

The Android/Brave-specific cause remains unconfirmed without its exported
runtime report. Two relevant failure paths were repaired: module crashes retry
a clean WASM worker, and the pinned q8 detector/processor deploy on the app
origin instead of requiring a third-party model request.

## Requirement verification

| Requirement | Evidence |
|---|---|
| REQ-01 same-frame, either completion order, bounded join | Pure join tests and live UI timings |
| REQ-02 immutable identity and stale/weak/missing/moved rejection | Tracker tests; binding captured at detector observation |
| REQ-03 boxes separate from warning freshness | Slow-detector test; risk/HUD use original capture/range ages |
| REQ-04 startup and first-party CPU model | Capability tests, module-crash UI case, real WASM with external requests blocked |
| REQ-05 visible errors/progress/retry/reasons and telemetry | Browser load failure case; expired-outcome timing test |
| REQ-06 verification gates | Results below; physical-phone gate remains pending |

## Verification

- Full unit suite: **281/281 pass**; final focused tracker/telemetry set: 15/15.
- TypeScript and production build: pass.
- Live UI: six cases pass (depth first, depth after newer detector, module crash
  to WASM, stale depth, slow boxes/no false warning, visible load retry).
- Layout: seven video-anchor cases; feature toggle/mobile layout pass.
- Real pinned models: WASM q8 + metric depth and WebGPU detector + metric depth
  execute on desktop Chrome with **zero external browser requests**.
- Security: pass, 0 critical; two pre-existing reviewed `sharp` high advisories;
  no `sharp` browser/source exposure.
- Sources were mirrored into a clean `/private/tmp` checkout for gates:
  iCloud dataless reads blocked original runners. No iCloud setting changed.
  Clean dependencies came from the existing lock.

See `evidence/TIP-60C-RUNTIME-2026-10-04.json` for recorded values. The old bus
smoke ROI itself touched the 1% edge-rejection boundary. Its probe is now an
explicit interior runtime ROI, **not** ground-truth detection or physical
distance. Production ROI policy was not weakened.

## Material limitation discovered

On this desktop, WASM detection P50 was about **1691 ms** (3 measured calls),
metric depth **826 ms** (3 calls). WebGPU was about **63 ms** detection (3 calls)
and **40 ms** depth (21 calls). This is indicative smoke evidence, not an
isolated or statistically strong phone benchmark.

The current CPU detector alone can exceed the 1200 ms same-frame metre deadline.
A CPU-only phone may correctly continue saying “Chưa đo” after the join fix.
We did **not** enlarge the deadline, invent calibration, or label a 1.7-second-
old range as current. Visual boxes may survive bounded 1000–2500 ms processing,
but cannot become fresh danger-warning evidence on publication.

## Next acceptance gate

1. Parked/passenger-operated phone smoke on the new HTTPS build; record actual
   AI/depth backends, timings, errors and rejection reasons via Phân tích →
   Xuất báo cáo JSON. No driver screen interaction or braking use.
2. For CPU-only devices, run the mobile detector/input-size bake-off against
   Common Evidence Plane before promoting a smaller graph/model.
3. Physical distance truth, thermal soak and road safety remain separate gates.
   This TIP does not promote DriveSense to a driving aid.
