# Completion report · TIP-27

## Outcome

The complaint was traced to architecture, not a cosmetic threshold: production
detection was defaulting to WASM/CPU while depth and hand tracking continued to
compete for frame processing. AirSketch also rendered worker results as though
they were current camera frames and exposed obsolete double-flick instructions.

TIP-27 makes WebGPU the first detector path with explicit WASM fallback, isolates
interactive workloads from depth work, compensates bounded hand-result latency,
raises latest-frame hand sampling to 30 fps, and makes the actual gesture
contract and detector backend observable.

## User-facing behavior

- Turn on detection: status identifies `WEBGPU` or `WASM`, milliseconds and fps.
- Turn on AirSketch: camera remains RGB; drawing and cầm nắm are prioritized over
  the depth worker.
- Draw with thumb–index pinch; a fist is pen-up/transport, not an arm trigger.
- The cursor/ink follows a short bounded prediction, so it does not intentionally
  trail the hand by worker transit time.

## Residual risk

WebGPU availability is browser/hardware dependent. A WASM fallback preserves
function but cannot promise realtime detection for these models. This release
reports that condition rather than silently presenting stale locks as realtime.
