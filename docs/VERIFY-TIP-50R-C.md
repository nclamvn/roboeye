# VERIFY — TIP-50R-C RoadStructure artifact intake

Date: 2026-09-17
Scope: research artifact only; no product or field-safety claim.

## Result

PASS for the research benchmark gate. FAIL-CLOSED for commercial promotion.

## Supply chain

- Official repository revision: `6697dead54ed1cdd664b0313189c2cb52ee6335e`.
- FP16 XML: 554,615 bytes, SHA-256 `f22818f4f0bf6c305ef39b06ae275ecf522b4ed156d6fd8529f2c09bc996739b`.
- FP16 BIN: 368,616 bytes, SHA-256 `58c57ee0a9b72ee9c76b0fd898ee6608bcc299c5d8d0af90a5d59d4df9e79317`.
- Export toolchain is pinned in `requirements/road-export.txt`.
- The first reproducibility attempt exposed non-deterministic ONNX node order; canonical topological ordering was added.
- Two independent canonical exports are byte-identical: 864,661 bytes, SHA-256 `be0ceeb002af577936e9b439b7194dc8df6c8e5bc84ecb9bbfcab68695c86d17`.

## Browser runtime proof

Hardware: MacBook Pro M1 Max 32GB.
Browser: Headless Chrome 151.
Runtime: ONNX Runtime Web `1.22.0-dev.20250409-89f8206ba4`.

| Provider | Result | Cold start | p50 | p95 | Evidence |
|---|---:|---:|---:|---:|---|
| WebGPU | FAIL | — | — | — | `using ceil() in shape computation is not yet supported for MaxPool` |
| WASM, 1 thread | PASS | 77.0 ms | 180.2 ms | 185.4 ms | 2 warm-ups + 8 measured zero-input runs |

This proves compatibility and honest latency only. It does not prove segmentation quality, numerical equivalence on real images, 30 FPS, or safe driving behavior.

## Gates

- TypeScript: PASS.
- Unit tests: 189/189 PASS.
- Refinery: PASS, digest `bce0d01cbc6a6101`, bite suite PASS.
- Artifact manifest: valid.
- Artifact bytes/hash: exact.
- Operator inventory hash/artifact binding: exact.
- Declared research purpose: allowed.
- Commercial eligibility: false; Mighty AI training-data terms remain unknown.
