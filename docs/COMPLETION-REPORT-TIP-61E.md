# Completion / verification — TIP-61E

2026-10-08 · Vibecode Kit v6.2 · Contractor → Builder → QA.

**Software implementation and HTTPS delivery verified — 5/5 scoped requirements. Product/phone acceptance remains PARTIAL; not every commercial accuracy/realtime gap is closed.**

## Requirements

| Requirement | Result |
|---|---|
| E1 Actual simultaneous detector/depth workload | Implemented; fixed local pixels, measured model/join timing, exact identities, FP32 controls before and after each candidate |
| E2 Precision candidate gated by parity and benefit | Evaluated and rejected; production remains pinned FP32 |
| E3 Bounded input ownership / recovery | Implemented; one reusable worker input buffer/tensor, transferred outputs independent; wrong-shape recovery passes |
| E4 Regression / build / security | Passed: 310/310 units, production build, release verifier, real-model numerical parity and scoped browser suites |
| E5 Existing-project production deployment / exact live assets | READY; canonical identity, 18 HTTP checks, UI smoke and 4 real metric-worker configurations pass; no project/owner/billing changes |

The deployed algorithm package includes TIP-61D's independent **224×392 portrait export**, source-aspect switching/rotation invalidation, central connected-depth support, variable-dt outlier continuity, bounded GPU phase alignment and per-object raw → policy → filter → publication evidence. It retains **1200 ms original capture expiry**, immutable identity binding, clipping/ROI/crop checks and ordinal abstention. No settings are loosened to force metres onto the HUD.

## Measured candidate verdicts — not claims about real-world accuracy

1. `onnxconverter-common 1.16.0` produces a structural-check-passing graph that the actual runtime rejects: original Cast-to-FLOAT attributes conflict with converted FLOAT16 annotations. Reproduction is preserved, not shipped.
2. The [official ORT 1.22.1 transformer converter](https://github.com/microsoft/onnxruntime/blob/v1.22.1/onnxruntime/python/tools/transformers/float16.py) handles those casts. Its topologically sorted graph passes full type/shape checking and runs in WebGPU, with float32 input/output.
3. On the local bus fixture, FP16/FP32 **tensor differences**, not physical errors, reach **1.7223 m landscape / 1.1209 m portrait**. P99 relative difference is **3.02% / 2.41%**, exceeding the predeclared ≤0.25 m maximum / ≤0.5% P99 numerical gate. Synthetic gradient also exceeds the relative gate.
4. The FP32 controls drift beyond the 20% stability gate in the ORT run. Therefore a causal speedup is **not accepted**, even where FP16 was faster in individual samples. Both orientations are unqualified for promotion.

Evidence: `evidence/tip61e/combined-workload-{common,ort}.json`. Operational `pass` means the FP32 control harness executed without unexpected external requests/page errors; it does **not** mean the candidate passed its numerical/performance gate. `productionPromotion` is false in every candidate record.

The WASM CPU control's joined P95 is approximately **1.90–2.74 s** across recorded scenes/orientations, over the original 1.2 s metric deadline. This is an actual paired desktop-worker observation, **not an iPhone benchmark**. GPU FP32 tails vary materially too; static-frame samples do not validate sustained traffic tracking or phone thermal behaviour. Smaller **relative**-depth outputs cannot be relabelled as absolute metres to solve this.

[ONNX Runtime's precision guidance](https://onnxruntime.ai/docs/performance/model-optimizations/float16.html) informed the controlled candidate experiment. [WebGPU guidance](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html) requires GPU-kernel placement proof for graph capture; no speculative graph capture/runtime upgrade was shipped.

## Production implementation / QA

- Input pooling removes a **1,053,696-byte per-frame input allocation** at either metric shape. No measured FPS improvement is claimed for this patch alone. Input storage is never transferred or mutated during an in-flight run.
- Repeated real inference uses distinct gradient/bus pixels; wrong-shape rejection followed by valid inference passes for landscape/portrait × WASM/WebGPU. Maximum FP32 native-reference difference remains **0.0000554 m** on the synthetic fixture, not physical accuracy.
- **310/310** unit tests; typecheck/build PASS; release verifier **5/5**; audit **0 high / 0 critical** and no native Sharp exposure in browser bundles.
- Per-object/orientation UI **6 checks**; mobile live mock cases **6/6**; bounded recovery **3/3**; real-clock persisted journal/reopen/denied-storage **4/4**; feature toggles **7 checks**; video-anchor/layout **7 cases**. These use fake cameras/mocked AI except the separately labelled real-model tests.
- Portrait immutable cache rule and HTTPS verifier now include the new graph; candidate/reference/environment files are absent from public output.
- Evidence collection: `node scripts/collect-tip61e-evidence.mjs`. Separate snapshots preserve TIP-61D/61R evidence. An initial test-launcher filename typo was corrected; the actual seven-case video-anchor script was re-run successfully before deployment.
- Live verification: **18/18** canonical HTTPS checks, source/byte hashes and camera/CSP headers; responsive UI smoke; **4/4** actual production metric-worker configurations (WASM/WebGPU × portrait/landscape), native parity and wrong-shape recovery. These are still desktop Chromium/synthetic tests, not physical phone accuracy or the complete live tracking/publication pipeline.

## Deployment identity

Prebuilt v1.5.0:

- buildFingerprint: `80142f1f649a`
- sourceFingerprint: `81c6100aadf2122d89beb3846651af4266420ded516dc54e9a1403e09714f508`
- runtimeFingerprint: `e1fda66b8d99`
- baseline Git commit: `8219b578cb4e` — **not a new commit**. New code is distinguished by its actual source fingerprint; no Git commit/push was requested in this turn.
- existing canonical project: `https://roboeye-drivesense.vercel.app`
- new production deployment: `dpl_F8nLUAwdfoxhaPyKbezQZG9Wbdr5`, READY, canonical alias independently inspected.
- immutable deployment: `https://roboeye-drivesense-hqcy1ko08-nclamvn-gmailcoms-projects.vercel.app`
- test URL: `https://roboeye-drivesense.vercel.app/drive.html?v=80142f1f649a`
- previous deployment retained for rollback: `dpl_2xdNgvTnzA3VK5gukp39BQVhe4Kw`.

Deployment receipt, exact HTTP checks, UI screenshot/smoke and real production-worker numerical checks are recorded separately in `evidence/tip61e/`.

## Unclosed product gates / safe test

Physical 3–50 m accuracy, phone P95 ≤300 ms, ≥3 fresh anchors/s, eligible lead coverage ≥95%, blackout ≤1 s and 30-minute thermal soak are **not accepted**. The owner's prior measured 12.83% coverage remains a baseline, not an after result. Verified road-plane/tyre-contact applicability is still missing; conservative cross-vehicle contradictions must remain unknown. This release does **not** close every commercial-product gap or certify collision warnings.

Test without highway driving: open the new build, use **Phân tích → Test realtime bằng video** with an existing clip, keep loop enabled, then export the saved diagnostic session. Camera can be tested while stationary; a driver must not operate this test UI or rely on it to brake/steer. Portrait and landscape are selected from actual decoded source dimensions. Reports now explain each object's rejected stage rather than only “ROI rejected”.

Reproduce candidate exploration: prepare pinned fixtures/native references, install the isolated Python 3.12 requirements, then `npm run experiment:drive-fp16`. `--converter common` reproduces the rejected converter; the default uses official ORT. Candidate ONNX files stay in ignored local test cache, never in production.
