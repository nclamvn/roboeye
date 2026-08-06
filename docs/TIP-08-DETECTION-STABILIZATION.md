# TIP-08: Detection Stabilization

## HEADER

- TIP-ID: TIP-08
- Project: RoboEye Edge Perception Studio
- Module: Detection and annotation
- Depends on: TIP-07
- Priority: P0
- Date: 06/08/2026

## CONTEXT

- Working directory: `/Users/os/Downloads/roboeye`
- Canonical branch: `main`
- Requirements: `docs/RRI-EDGE-PERCEPTION.md`
- Blueprint: `docs/BLUEPRINT-EDGE-PERCEPTION.md`
- Key files: `src/main.ts`, `src/worker/detect-worker.ts`, `src/render/scene.ts`, `src/ui/shell.ts`, `README.md`

## TASK

Formalize and stabilize the existing RT-DETR/OWL-ViT detection and annotation workflow according to REQ-D01–D08.

## SPECIFICATIONS

1. Create one shared typed contract for detection engines, boxes and worker messages.
2. Recover the main-thread detection loop after frame inference errors; expose a visible error state.
3. Extract COCO, YOLO and 3D serialization into pure typed functions.
4. Preserve current download filenames and UI behavior.
5. Remove the nonexistent metric-depth instruction from 3D JSON; explicitly preserve relative scale.
6. Add deterministic unit tests for converters and edge cases.
7. Document detection controls, annotation lifecycle, export formats and local-model requirements.
8. Run typecheck, unit tests and production build. Attempt smoke and report prerequisites honestly.

## ACCEPTANCE CRITERIA

- Given detection is enabled, when a frame inference error occurs, then the main loop clears its busy state and the UI reports the error without requiring a page refresh.
- Given normalized boxes, when COCO or YOLO export is generated, then coordinates, category IDs and class ordering are deterministic and covered by tests.
- Given fused and unfused boxes, when 3D JSON is generated, then scale is explicitly relative, nullable 3D boxes are preserved and no nonexistent metric mode is advertised.
- Given the codebase, when typecheck, unit tests and production build run, then all complete with zero errors.
- Given a new operator, when they read README, then they can enable detection, choose an engine, edit labels, export annotations and understand online/offline model behavior.

## CONSTRAINTS

- Do not add a backend, persistence, new model, new render mode or metric-depth implementation.
- Do not change depth, BEV or A* algorithms.
- Do not change export filenames or visible design language.
- Do not claim smoke passed if model fixtures are absent.
- Report dependency audit findings; do not upgrade the ML stack inside this TIP.

## REPORT FORMAT

Submit a standard Completion Report mapping test evidence to REQ-D01–D08.
