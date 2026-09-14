# TIP44 — Browser metric gates / Completion & VERIFY

Work started 2026-09-13; report finalized 2026-09-14 (Asia/Ho_Chi_Minh). Contractor → Builder → Contractor executed sequentially under the user's approval. **R0/R1 local measurement infrastructure implemented; full browser-on-phone-and-laptop distance-warning product NOT READY.**

## Implemented

- Separate typed metric contract: optical-axis Z, metres, model/revision/hash, invalid mask. Relative uint8 output is rejected.
- MoGe-2 Small official ONNX + focal/shift recovery + metric scale. Pinned graph actually emits `scale`, not `metric_scale`; loader validates the graph contract. Numerical geometry uses the upstream variable-projection objective with deterministic strided sampling, not an assertion of byte-identical upstream preprocessing.
- DA2 Metric Outdoor Small from author-hosted safetensors, local Transformers export, fixed 224×280 RGB input with normalization in graph. PyTorch→native ONNX max difference 0.000124 in depth-tensor units. No remote Python execution, no arbitrary relative checkpoint relabelled as metric.
- Browser worker, explicit backend selection, tensor validation/disposal, one request in flight, source epochs, timeout, teardown and stale-label rejection. Test UI supports image/video/camera and report export; DA2 is restricted to its validated reference fixture.
- Unaligned benchmark with explicit reference IDs, missing/stale coverage, null accuracy without independent physical measurements.
- Model files are ignored outside public assets. Existing relative/DepthPro worker preserved byte-for-byte; a worker naming collision was caught during verification and restored before completion. New worker is `drive-metric-worker.ts`. No private driving clip was accessed/uploaded this turn.

## Actual browser A/B evidence

Headless Chromium 151.0.7922.34; adapter reports Apple / metal-3. Exact chip not identified; browser UA's Intel string is not a hardware measurement. Same public bus RGB tensor, 224×280, MoGe token budget 400. WebGPU tests below ran without unsafe-GPU flag, 21 observations each, first observation labelled warmup.

| Model / backend | Warm request→result | Reference parity |
| --- | --- | --- |
| DA2 Metric / WebGPU | P95 **40.9 ms**, 20 warm samples | Max abs 0.0001145; 0 mask disagreements |
| MoGe-2 Small / WebGPU | P95 **112.3 ms**, 20 warm samples | Max abs 0.0003996; 0 mask disagreements |
| DA2 Metric / WASM | About **566–568 ms**, 3 warm samples | PASS, tolerance 0.01 |
| MoGe-2 Small / WASM | About **2941–2956 ms**, 3 warm samples | PASS, tolerance 0.01 |

WASM runs used the earlier harness launch with unsafe-GPU flag present, but explicitly requested WASM. Do not pool those runs with the normal WebGPU benchmark. All raw values, launch flags and scope are retained in [measurement evidence](measurements/tip44/README.md).

Parity compares 62,720 pixels against CPU/SciPy or PyTorch references. These tiny differences demonstrate export/integration consistency, **not sub-millimetre physical accuracy**. MoGe's independent SciPy solver uses the same sampled objective, not a separate real-world ground truth.

Times measure browser request→result on a prepared static tensor, not sensor→display and not detector+depth+tracking. Warm shader/cache effects apply; earlier cold runs were substantially slower. Node test throughput is not camera FPS. ORT can place shape/control nodes on CPU; kernel placement was not profiled. DA2 is a provisional latency candidate, not an established accuracy winner.

## Contractor VERIFY

| Requirement | Evidence / result |
| --- | --- |
| R44-1 metric contract | PASS — relative bytes, invalid shapes, masks and units guarded; model provenance exported |
| R44-2 MoGe loader/reconstruction | PASS locally — hash checked, graph run, numerical reference parity |
| R44-3 independent tests | PASS — analytical portrait/landscape/scale fixtures; independent SciPy/native/PyTorch reference; both models on both browser backends |
| R44-4 browser bench/explicit backend | PASS locally — real image, reference tensor, fake-camera lifecycle; explicit failure/no silent fallback |
| R44-5 lifecycle | PASS — unit single-flight/epoch/stale tests; browser stop clears map; pending camera task discarded and stream released |
| R44-6 benchmark | PASS — no alignment, coverage includes misses, absent ground truth leaves accuracy null, invalid/duplicate refs rejected |
| R44-7 checks/honest gates | PASS for reporting scope — actual local browser measurements retained; phone/Safari/road gates explicitly open |

Scoped implementation coverage **7/7**. Scenario groups **7 PASS / 0 FAIL** in browser UI test (including 390 px layout, not actual mobile inference). Full current dirty-worktree unit tests **106/106 PASS**, including **5 new metric groups**. Typecheck 0 errors; production build PASS; release verifier PASS; `git diff --check` PASS. No separate lint configured. Unrelated existing changes preserved; these tests do not prove every old camera interaction is regression-free. Full camera/road E2E suite not rerun in this TIP.

Visual QA inspected desktop and 390 px screenshots. A real mobile-width overflow was fixed; a pointer-test error clicking a letterbox was corrected to click the actual contained image. Source reset, corruption refusal and no POST/PUT were tested. This is not proof of zero network activity: assets/dependencies are fetched, and CSP/deployment qualification remains separate.

**Security: FAIL / release blocked.** Existing dependency path `@huggingface/transformers → sharp` exposes advisories GHSA-f88m-g3jw-g9cj and GHSA-rgj7-g3m4-5g8c outside the allowlist. No allowlist relaxation or broad dependency upgrade performed. Direct ORT dependency is the exact version already installed transitively; no runtime version upgrade. Audit remediation requires separate compatibility verification before release. Build/release-manifest PASS does not override this security failure.

## Remaining product gates, not completed

- Road-aspect-ratio DA2 export/preprocessing and multi-image parity, beyond this fixed portrait fixture.
- Camera/detector/depth combined live latency, actual phone browser compatibility/RAM, cold load and sustained thermal behaviour. Neither Safari nor a physical phone was tested.
- Vehicle-surface extraction and stable association; geometry/metric-depth agreement; calibrated uncertainty and quick calibration UX.
- Physical distance ground truth, lens/mount/crop controls, held-out range errors, annotated false-positive/recall evaluation across clips/conditions. Metres are currently learned and unverified, not certified bumper clearance.
- Release dependency advisories and redistribution licensing review of the chosen export/runtime assets.

No commit, push or deploy performed. No production warning logic connected to these unqualified outputs. Next engineering work should follow the sequence in [lab guide](METRIC-LAB-GUIDE.md), not simply print these numbers on vehicle boxes.
