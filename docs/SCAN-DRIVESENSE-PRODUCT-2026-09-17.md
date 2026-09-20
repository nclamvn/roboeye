# SCAN REPORT — DriveSense product phase

Date: 2026-09-17. Scope: read-only scan of the current local `roboeye-live` checkout. This is evidence for the product PRD, not a road-readiness certificate.

## TECH_STACK

- Language/runtime: strict TypeScript, Vite 7, Node 20.19+, browser Web Workers.
- Perception: pinned RT-DETRv2 R18; DriveSense-specific focal decoder and vehicle-only candidate policy; WebGPU detector with clean WASM fallback.
- Range: camera-profile ground-plane geometry; DA2 Metric Outdoor worker for **analysed file video**, not live camera range.
- State: tab-local; no product backend, authentication, fleet database or telemetry service.
- Release: static GitHub Pages workflow; local model preparation is separate from tracked source.

## EXISTING_MODULES / REUSE

| Module | Current capability | Evidence |
|---|---|---|
| DriveSense shell | Camera/file/demo sources, overlay, shadow-risk HUD, opt-in sound, JSON report v5 | `drive.html`, `src/drive/app.ts`, `src/drive/hud.ts` |
| Detection and tracking | Vehicle boxes, strong-evidence confirmation, stable IDs, optical TTC | `src/worker/drive-detect-worker.ts`, `src/drive/detector-decode.ts`, `src/drive/tracking.ts` |
| Distance | Geometry with profile; learned optical-axis Z only on offline sampled replay | `src/drive/geometry.ts`, `src/drive/learned-range.ts`, `src/drive/replay.ts` |
| Risk | Perspective corridor, one primary target, TTC agreement/conflict and abstention | `src/drive/risk.ts` |
| Benchmark | Optional reference matching by track ID/time, MAE/coverage and detector-request P95 | `src/drive/benchmark.ts` |
| Research | Model/license/latency research and earlier approved PoC blueprint | `docs/research/`, `docs/BLUEPRINT-DRIVESENSE.md` |

## PATTERNS / CODE HEALTH

- 22 `src/drive/` files (21 TS + CSS); about 1,629 TS lines; 13 Drive/metric unit-test files. No Drive-specific TODO/FIXME/debugger/console logging found in the scan.
- `npm run test:unit` on this working tree: 157/157 pass. `npm run security:audit`: pass, zero high/critical advisories in its report. `npm run typecheck` did not complete after several minutes and was interrupted; **not a pass**. Production build/browser E2E were not rerun for this scan.
- Working tree already contains unrelated RoboHand and research edits/untracked files. Product work must not reset, stage or overwrite them.
- Historic completion report TIP-46 says the browser is a controlled shadow-risk demonstrator, **not** public-road FCW. The camera live path does not attach learned metric range; local file video is 5 Hz analyse-then-replay. No independent synchronized field truth or event false-alert data exists.

## GAPS DETECTED — ORDERED

1. **P0 evidence:** no journey/device-split corpus of independently measured gap/vehicle boxes/events. Existing `benchmark.ts` matches truth to prediction using model track IDs supplied by the evaluator; a serious field benchmark needs independent object association.
2. **P0 realtime:** no complete capture-to-audible/visible-alert measurement, bounded queue age, sustained thermal measurement or live learned range. A live worker result older than one second is dropped, which is not a suitable product latency target.
3. **P0 safety:** current range semantics are optical-axis/ground-forward Z, not validated bumper clearance; corridor is perspective heuristic, not lane geometry. Driver speed is manually entered in the demo.
4. **P0 operating product:** no automotive-rated power/compute/camera package, connectivity policy, OTA, device health or fleet operations.
5. **P1 connected intelligence:** no licensed traffic-data adapters, source provenance/TTL, route-direction matching, billing guardrails or legal/retention policy.

## ASSESSMENT

The approved 2026-09-13 PoC blueprint already authorizes a reproducible ground-truth/benchmark step; TIP-46 explicitly recommends it as TIP-47. A *commercial* edge-plus-connected-data architecture is new and remains a draft until homeowner approval. First safe build slice: create a fail-closed, synthetic-tested validation corpus contract and scorer without claiming field accuracy.
