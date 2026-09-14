# TIP44 retained measurement evidence

Generated on the local Mac during TIP44, 2026-09-13–14 (Asia/Ho_Chi_Minh). JSON copied unchanged from ignored `tests/.metric-cache/` after completed runs. No model weights, user video or camera image is included.

- `browser-da2-webgpu-normal-21.json`, `browser-moge-webgpu-normal-21.json`: default Chromium launch, no unsafe GPU flag; same fixture, 1 warmup + 20 warm observations per model.
- `browser-da2-wasm.json`, `browser-wasm.json`: DA2 and MoGe respectively; earlier harness, unsafe GPU launch flag present but explicit WASM provider, 1 warmup + 3 warm observations each.
- `reference.json`: MoGe CPU + independent SciPy objective reference, input SHA-256.
- `da2-manifest.json`: pinned source/export hash and PyTorch↔native ONNX comparison.
- `ui-e2e.json`: seven UI/lifecycle scenario groups, fake camera on desktop. Mobile viewport only tests layout.
- `python-freeze.txt`: exact installed export/reference environment; production browser does not execute Python.
- `security-audit.txt`: output from release security gate. Failure must not be hidden by passing build/tests.

These data prove local numerical compatibility and measured request-to-result timing for the recorded fixture. Physical distance accuracy, camera-to-screen delay, vehicle recognition quality, mobile performance and long-duration stability are **not** measured by them. See [completion report](../../COMPLETION-REPORT-TIP-44.md).
