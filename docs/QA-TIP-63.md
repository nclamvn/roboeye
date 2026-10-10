# TIP-63 test / provenance boundaries

Run `npm run qa:drive-partner` then `node tests/drive-lite-e2e.mjs` in this
checkout. Set TMPDIR to one task-named disposable scratch directory and
ROBOEYE_QA_OUTPUT / ROBOEYE_LITE_QA_OUTPUT to persistent evidence directories.
Do not copy the project. The build prepares pinned weights/licence/runtime.

The Nano gate runs the **actual official ONNX graph** on a public bus image,
WASM and WebGPU, 12 requests each. The calibration UI gate uses explicitly
synthetic truth, mock inference and a canvas camera. It verifies metre
publication, point picking, six fit/two check points, no depth dispatch,
export, narrow-screen overflow and immediate zoom invalidation. Twelve unit
scenarios cover BGR, raw grids, winning class/NMS, adversarial references,
source/domain/sensitivity guards, unchanged freshness and explicit coverage
truncation accounting. The compiled Nano gate also runs WASM/WebGPU and checks
375/430/1440-pixel layouts against the actual release bundle.

Neither gate measures physical iPhone/Android accuracy or thermal performance.
Per-target report coverage is box-visible time in the current timeline
generation, not ground-truth road-user eligibility. Physical accuracy and
eligible coverage remain null; product verdict remains `not-validated`.

## Morning test

Park safely; a passenger operates any test in motion. Open production, choose
Camera. Mobile auto initially selects Nano; manual RT-DETR/AI remains in
Analysis for comparison. A GPU probe and measured timing decide whether to
attempt AI depth, not the phone brand. Slow/CPU-only devices are directed to
the on-video **Đo theo mốc** button rather than loading unusable depth.

For that lightweight metre route, keep the camera/lens/crop fixed on a flat
controlled surface. Freeze a frame and mark ≥6 fit ground-contact points across
≥8 m and ≥3 distances, plus ≥2 different measured check points. Distances are
forward from the camera, **not** lateral gaps or guessed car dimensions. Confirm,
apply, export for reuse only with the same setup. Cropped/small vehicles,
extrapolation, poor checks or excessive sensitivity stay unknown. Rotation,
source changes and zoom revoke calibration. No calibration-free metres are
invented to fill a box.

## Primary model evidence

- Upstream/revision: https://github.com/Megvii-BaseDetection/YOLOX/tree/6ddff4824372906469a7fae2dc3206c7aa4bbaee
- Official binary: https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_nano.onnx
- Binary: 3,659,407 bytes, SHA256 `c789161ed43c8269fcd4e67c67eeeb4e80c622da2eb296a20bc6007bd18a0b7d`.
- Preprocess: upstream `yolox/data/data_augment.py`, `ValTransform(legacy=False)`.
- Decode: upstream `yolox/utils/demo_utils.py`, grid strides 8/16/32.
- Native graph inspected: images float32 [1,3,416,416] → output [1,3549,85],
  opset 11, raw offsets, native CPU execution verified. Canvas bilinear resize
  is not asserted byte-identical to OpenCV; browser NMS uses continuous IoU,
  not the upstream inclusive-pixel +1 variant. Application allowlist/top-k are
  explicit adaptations; bus smoke is not recall parity or a traffic benchmark.
- Full unmodified Apache licence is shipped at `/licenses/yolox-nano-LICENSE.txt`
  with SHA256 `0ec3668d3274bcf29e8a29e9576d5a2cd96fc78d3c5bec4387355a796e5d9088`,
  11,371 bytes; source attribution in `/licenses/yolox-nano-NOTICE.txt`.
- Runtime is npm alias `onnxruntime-web-mobile@npm:onnxruntime-web@1.30.0`;
  RT-DETR/depth keep their pinned runtime. Model/LICENCE fetch recipes verify
  bytes/SHA, not a community mirror or unverified download.

Paid/AGPL YOLO26 depth replacement, a full baseline runtime-major upgrade,
traffic-wide motorcycle/cycle/pedestrian recall, dynamic road-plane tracking,
physical 30-minute device soak and safety certification are **not implemented**
by this release. No model/performance claim is borrowed from an unrelated GPU.
