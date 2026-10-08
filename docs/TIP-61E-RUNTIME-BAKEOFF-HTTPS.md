# TIP-61E — Measured runtime bake-off and HTTPS delivery

Date: 2026-10-08. Method: Vibecode Kit v6.2, Contractor → Builder → QA.
Authorization: implement reasonable gap-removal methods and deploy the existing product. No separate approval checkpoint because this remains within that request; no paid service, hardware, native-app migration or vehicle control.

## Scope / gates

1. Run **actual detector and metric workers concurrently** on identical local pixels. Record cold start, measured per-model and joined P50/P95, model identity, errors and scope. Do not relabel desktop results as phone measurements.
2. Evaluate FP16 as a **candidate**, keeping input/output float32, the pinned outdoor metric weights, both aspect-specific shapes and metre semantics. Promotion requires numerical parity and a measured benefit; otherwise reject it and ship the already-verified FP32 corrections. No invented scale or relaxed ROI/TTL threshold.
3. Remove avoidable per-frame input allocation only if repeated inference, wrong-shape recovery and independent output ownership tests pass. One in-flight request remains mandatory.
4. Re-run production build, relevant unit/UI/runtime regressions and security checks. Preserve earlier evidence and report actual implemented/deferred items.
5. Deploy prebuilt output to the **existing** Vercel production project. Verify canonical release/source fingerprints, portrait and landscape model hashes, runtime/worker bytes and HTTPS security headers, then perform read-only UI smoke.

## Non-goals / acceptance boundaries

Physical 3–50 m accuracy, sustained phone thermal throughput and ≥95% eligible lead coverage are **not** accepted by synthetic timing, numerical parity or desktop Chrome. Ambiguous, stale or unsupported geometry still displays “chưa đo”. No requirement to drive on a highway to execute this software phase.

## Research basis

ONNX Runtime [float16 guidance](https://onnxruntime.ai/docs/performance/model-optimizations/float16.html) supports a controlled GPU-only precision experiment, not an automatic speed/accuracy promise. [WebGPU guidance](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html) limits graph capture to static graphs with all compute kernels on GPU. Current kernel placement is not proven, so graph capture is not enabled speculatively.

## Deliverables

Reproducible candidate exporter and combined-workload harness; bounded production patches supported by tests; `docs/evidence/tip61e/`; completion/verification report; exact HTTPS build link. Git commit/push is not part of this turn's explicit instruction.
