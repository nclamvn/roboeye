# Completion Report — TIP-50R-C

## Status

VERIFIED FOR RESEARCH BENCHMARK — no third-party model is promoted to the commercial product.

## Delivered

- Closed, typed RoadStructure artifact manifest.
- Exact local file byte/SHA-256 inspection CLI.
- Separate research and commercial gates tied to the provenance registry and a hash-bound runtime proof.
- Static tensor, safe filename, HTTPS source, full commit and mandatory operator-audit invariants.
- Deterministic unit coverage for pass and fail-closed paths.
- Pinned Open Model Zoo `road-segmentation-adas-0001` source at commit `6697dead54ed1cdd664b0313189c2cb52ee6335e`.
- Exact FP16 XML/BIN downloads and a pinned export environment.
- Stable ONNX canonicalization: two independent exports produce 864,661 bytes and SHA-256 `be0ceeb002af577936e9b439b7194dc8df6c8e5bc84ecb9bbfcab68695c86d17`.
- Operator inventory: Add, AveragePool, Constant, Conv, MaxPool, Relu, Resize and Softmax.
- M1 Max browser proof: WebGPU failed explicitly on MaxPool ceil shape computation; WASM passed at 180.2 ms p50 / 185.4 ms p95 over eight measured runs after two warm-ups.

## Remaining exit evidence

- Establish commercial terms for the named Mighty AI training subset or replace the candidate with internally trained, fully controlled weights.
- Rewrite/normalize the MaxPool path or use another architecture before claiming WebGPU support.
- Add peak-memory capture and numerical agreement against the OpenVINO source runtime.
- Benchmark real Vietnamese-road clips with held-out annotations; source-reported IoU is not product evidence.

Until the commercial and quality gates are complete, RoadStructure remains outside the product HUD and release bundle.
