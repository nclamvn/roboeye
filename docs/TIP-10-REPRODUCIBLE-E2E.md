# TIP-10: Reproducible Model Fixture and Detection E2E

## HEADER

- TIP-ID: TIP-10
- Project: RoboEye Edge Perception Studio
- Module: Test infrastructure and browser QA
- Depends on: TIP-09
- Priority: P1
- Date: 06/08/2026

## REQUIREMENTS

| REQ-ID | Requirement | Priority |
|---|---|---|
| REQ-Q01 | Pin the real depth q8 fixture to a Hugging Face revision with size and SHA-256 per file | P0 |
| REQ-Q02 | Provide an idempotent bootstrap/verify command with atomic downloads and checksum failure | P0 |
| REQ-Q03 | `npm run smoke` prepares/verifies its fixture automatically | P0 |
| REQ-Q04 | Browser discovery works through env override, Playwright cache and common OS locations | P1 |
| REQ-Q05 | Add deterministic browser E2E for detection opt-in, infer-error recovery, objects, engine switch and export | P0 |
| REQ-Q06 | Mock-worker E2E must be labeled contract/UI testing and never claimed as model-quality evidence | P0 |
| REQ-Q07 | Typecheck, unit, security, detection E2E and real depth smoke results are reported separately | P0 |

## FIXTURE CONTRACT

- Repository: `onnx-community/depth-anything-v2-small`
- Revision: `4472b7362082ad9968fee890ca0f1e5aca36b93d`
- Files: `config.json`, `preprocessor_config.json`, `onnx/model_quantized.onnx`
- Cache: `tests/.model-cache/` (ignored by Git)
- Source of truth: committed manifest, not mutable `main` URLs.

## TASK

Make the historical real-depth smoke reproducible from a clean checkout and add a fast detection browser lane that validates application wiring without requiring full detection model downloads.

## ACCEPTANCE CRITERIA

- Given an empty cache, when fixture preparation runs, then pinned files download atomically and match all manifest hashes.
- Given a valid cache, when preparation runs again, then files are verified and not downloaded again.
- Given a corrupted cache file, when verify-only runs, then it exits non-zero with the affected path.
- Given a supported local browser, when detection E2E runs, then mocked depth/detection workers exercise opt-in, infer-error recovery, object list, engine switching and COCO download with no fatal console error.
- Given the full smoke command, when no cache exists, then its pre-hook prepares the real q8 fixture before launching the browser.

## CONSTRAINTS

- Do not commit model binaries or `.model-cache`.
- Do not mock the existing real-depth smoke lane.
- Do not download full RT-DETR/OWL-ViT models for contract E2E.
- Do not claim mock detections prove model accuracy, latency or backend compatibility.
- Preserve existing screenshots unless the real smoke run intentionally regenerates them.

## REPORT FORMAT

Submit Completion, QA and Verify Reports with distinct results for fixture, mocked detection E2E and real depth smoke.
