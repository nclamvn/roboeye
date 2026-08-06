# QA REPORT — TIP-10 Reproducible Fixture and Detection E2E

Run by Contractor: 06/08/2026

## GATE RESULTS

| Lane | Scope | Result |
|---|---|---|
| Fixture clean prepare | Pinned q8 files downloaded, byte count and SHA-256 verified | PASS, 3 downloaded |
| Fixture idempotency | Valid cache prepared again | PASS, 0 downloaded |
| Fixture verify-only | Valid cache without network mutation | PASS, 3/3 files |
| Fixture corruption | Truncated `config.json` in isolated cache | PASS, command rejected it with `INVALID config.json` |
| TypeScript | `npm run typecheck` | PASS, 0 errors |
| Unit | `npm run test:unit` | PASS, 12/12 |
| Security | `npm run security:audit` | PASS under TIP-09 time-limited policy |
| Production build | `npm run build` | PASS |
| Detection contract E2E | Mock workers, real browser/UI wiring | PASS, 13 checks |
| Real depth smoke | Real pinned q8 model, Transformers.js/ONNX WASM, WebGL2 | PASS, 14 checks |

## DETECTION CONTRACT COVERAGE

- Detection defaults off and label controls are hidden.
- An inference-stage error releases busy state and the next frame recovers.
- Two deterministic objects appear in list and SVG overlay.
- Engine switches from RT-DETR to OWL-ViT and exposes query control.
- Freeze, relabel and delete preserve one reviewed annotation.
- COCO download contains one annotation and the edited `operator` category.
- Expected recovery error is isolated; no other console error is allowed.

This lane uses browser Worker mocks. It proves application state transitions, DOM behavior and export wiring only. It does not prove detection model accuracy, latency, download integrity or backend compatibility.

## REAL MODEL EVIDENCE

- Fixture: `onnx-community/depth-anything-v2-small` at revision `4472b7362082ad9968fee890ca0f1e5aca36b93d`.
- ONNX q8 size: 27,258,801 bytes; checksum matched committed manifest.
- Runtime badges: `RENDER · WEBGL2`, `INFER · WASM`.
- First real depth frame arrived; depth viewport PNG was 141,016 bytes against a 25,000-byte non-blank threshold.
- Reported run rates on the QA host: inference 0.6 fps, render 30 fps.
- Browser console: 0 fatal errors.

Fake webcam supplies deterministic camera input only; depth inference itself is not mocked.

## RESIDUALS

- Live RT-DETR/OWL-ViT quality, latency and backend compatibility remain manual/future integration coverage because their large model snapshots are intentionally excluded from TIP-10.
- TIP-09 accepted dependency risk remains separately time-bounded to 06/09/2026.
