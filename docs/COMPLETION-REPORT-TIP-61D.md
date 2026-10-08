# Completion report — TIP-61D

Date: 2026-10-08. Method: Vibecode Kit v6.2, Contractor specification → Builder implementation → evidence-based QA.

**Status: local implementation verified; product/mobile acceptance PARTIAL. No commit, push or deployment in this task.**

## What changed

| Gap | Implemented | Evidence / boundary |
|---|---|---|
| Aggregate “ROI rejected” concealed the actual failure | Ledger v2 records per-object box/ID, probe dimensions/sample counts/quantiles/connected support, raw → policy → filtered → published metres, terminal stage/code; bounded detail plus cumulative counters | UI mock-stream test confirms accepted/clipped/tiny causes in one frame; old journal schema/import and persistence tests pass. No pixels/GPS/device IDs |
| Portrait camera used a landscape tensor with 68% padding | Separate **224×392 native ONNX export**, same pinned outdoor metric weights; actual output/hash/byte count locked; source geometry selects graph, rotation resets generation/in-flight range, offline source switches select the new graph | Source 720×1280 now uses 98.44% rather than 32.14% tensor area. Minimum ROI dimensions/coverage thresholds are unchanged |
| A rectangular patch could mix unrelated depth surfaces | Require a dominant contiguous depth surface supported by the ROI centre; retain original spread, density, clipping, zoom and ordinal abstentions | Mixed depth and minority centre occlusion regressions pass. **Depth support is not semantic segmentation, tyre contact or verified surface truth** |
| Filter reset above 800 ms admitted a large jump | Variable-dt continuity, conservative bootstrap velocity variance and 3σ innovation gate; rejection does not erase filter identity/history; long gaps require two new consistent observations | 26→64 m at 1050 ms is now unknown, including repeated outliers through the tracker. These priors remain uncalibrated, not physical motion bounds; abrupt valid motion can also abstain |
| Same-frame timing missed an entire detector slot | Scheduler uses detector/depth workloads and observed terminal age including stale attempts; bounded dual-GPU phase alignment ≤80 ms, no CPU/hung-worker alignment; no added queue | Constant-depth virtual-time control improves coverage, but actual contention/thermal effects still require device evidence |
| Internal application counts could overstate HUD success | Accepted counts and soak outcomes now require final publication, not only filter application; schema-10 report distinguishes stages, cache status unknown, GPU kernel placement unprofiled | Terminal accounting/publishing tests pass; capture age is never refreshed by painting/prediction |

The **1200 ms capture expiry**, same-frame immutable binding and strong observation threshold remain intact. Invalid/stale/ambiguous numbers still cannot become metre-based warnings.

## Model/export proof

- Portrait: `102c3b87a5610f57b7c337e0e7364d774b4648d5d6e2fb2cba6ed11fe60b6710`, 99,159,816 bytes.
- Landscape unchanged: `dc868d88c5b97570f59863641092f7a517b85ef567de883a988d7df0e8b7250f`, 99,159,817 bytes.
- Source weights unchanged: `ad065c77a7421ca55159a1f0db9433397a607690f2d76bb8a6fc54b1be7a3124`.
- Native export max absolute difference: portrait **0.0000315 m**, landscape **0.0000591 m**, on the recorded synthetic RGB fixture. This is numerical implementation parity, **not physical metre accuracy**.
- Actual Chrome workers: all four orientation/backend combinations pass native-reference comparison and reject wrong shapes. Maximum observed difference **0.0000554 m**.
- A **10,111-byte verified binary-delta recipe** reconstructs the independently exported portrait graph from the immutable landscape artifact at build time. Exact reconstructed SHA is checked. This is packaging, not guessed graph reshaping; clean builds need Node, not a Python training environment or an invented GitHub release URL.

## Before/after mechanism experiment

Identical constant 24 m map and stationary synthetic car, identical injected timings, identical 1200 ms TTL. Original TIP-61R baseline is preserved.

| Injected timing | Before metre visibility | After |
|---|---:|---:|
| GPU 100/100 ms | 100% | 100% |
| WASM detector/depth 600/500 ms | 34.23% | 50.83% |
| WASM 1100/1000 ms | 3.47% | 4.95% |
| GPU 616/647 ms (owner P50 only) | 45.60% | 86.20% |
| Either model 1690 ms | 0% | 0% — correctly stale |

**Do not substitute these simulations for the owner's measured 12.83% session coverage. No new iPhone after-session exists.** Slow models still cannot meet realtime requirements by changing scheduling alone.

## QA results

- Typecheck PASS; **305/305** unit tests; production build PASS; release verifier **5/5**.
- Real-model desktop smoke: detector and depth on WASM/WebGPU pass, no external requests or JavaScript errors; tests are separate workers, not simultaneous traffic throughput.
- Native/browser aspect parity **4/4**; orientation/per-object UI checks **6/6**; mobile live orchestration **6/6**; bounded recovery **3/3**; journal/reopen/denied-storage **4/4**.
- Feature toggle and video-anchor/layout regressions PASS, including **7** video-anchor cases.
- Security audit: **0 high, 0 critical**; no native Sharp code in application/browser bundles. This does not claim zero moderate advisories.
- Evidence: `docs/evidence/tip61d/`; native parity, anonymized mock-attempt examples, model hashes, exact build fingerprint and simulator scope are separate files.

## Still open — not hidden by successful software tests

1. **Road-plane/contact applicability:** conservative bottom-of-box ordering remains an abstention heuristic. A verified local plane/contact estimator has NOT been promoted. No licence/accuracy-reviewed semantic contact model or independently validated plane evidence exists in this incident input. Removing this guard merely to increase displayed numbers would revive the known wrong-order regression.
2. **Actual phone latency/coverage:** 300 ms P95, 3 fresh anchors/s, independently eligible lead coverage ≥95%, blackout ≤1 s and sustained 30-minute thermal behaviour are unpassed. Even the ideal owner-P50 timing simulation reaches only 86.2%, below the proposed coverage target.
3. **Physical 3–50 m accuracy:** P95 error ≤max(0.5 m, 15% Z) is untested without independent ground truth. Neither native parity, uniform depth nor AI-generated labels proves it. A-C long range, near-side overtakers, crop/FOV and nonplanar roads remain limits.

Next software phase: use the new per-object logs and local replay corpus to run TIP-61E's **actual combined-workload metric-model/preprocessing bake-off**, with device and scene-specific verdicts. Smaller relative-depth models cannot be substituted as absolute metres without a verified scale anchor. No hardware purchase or new highway-driving test is required to start that phase.

## Reproduce

Normal clean build: `npm run fixtures:drive-metric` then `npm run build`.
Native export/reference regeneration: isolated Python 3.12, `tests/metric-tip61d-requirements.txt`, `node scripts/fetch-da2-export-source.mjs`, `npm run fixtures:drive-metric:export`; then aspect parity test. Do not replace the immutable landscape pin with an arbitrary new exporter version.
UI: `node tests/drive-tip61d-e2e.mjs`; mechanisms: `node --import tsx tests/diagnostics/tip61d-stationary.ts`.
Local preview: `http://127.0.0.1:4192/drive.html?v=tip61d`. This machine only; production remains the previous deployment.
