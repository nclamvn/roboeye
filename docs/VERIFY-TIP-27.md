# VERIFY · TIP-27

| Gate | Evidence | Result |
|---|---|---|
| Gesture regression | `npm run test:unit` | PASS, 44 tests |
| Static correctness | `npm run typecheck` | PASS |
| AirSketch browser contract | `npm run test:airsketch-e2e` | PASS, 13 checks |
| Detection browser contract | `npm run test:detection-e2e` | PASS, WebGPU-first + WASM retry |
| Build | `npm run build` | PASS |

The two real-model commands remain release gates: they measure the actual host,
not deterministic mocks. Detector status now makes backend, inference duration
and effective cadence visible in the product so a hardware/browser fallback is
not mistaken for a successful realtime path.
