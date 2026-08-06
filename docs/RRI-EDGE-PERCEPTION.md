# RRI REPORT · RoboEye Edge Perception Studio

Generated: 06/08/2026

## REQUIREMENTS MATRIX

| REQ-ID | Requirement | Source | Priority | Persona |
|---|---|---|---|---|
| REQ-D01 | Detection remains opt-in and preserves both RT-DETR and OWL-ViT engines | Existing product + Homeowner direction | P0 | End User |
| REQ-D02 | A frame-level detection error releases the busy state and leaves a visible recoverable status | X-Ray gap | P0 | Operator |
| REQ-D03 | Detection worker messages and boxes have one shared typed contract | X-Ray gap | P1 | Developer |
| REQ-D04 | COCO and YOLO exports are deterministic and testable outside the UI | Existing product | P0 | End User / QA |
| REQ-D05 | 3D export states that coordinates are relative and never advertises a nonexistent metric mode | X-Ray gap | P0 | End User / Business |
| REQ-D06 | Unit tests cover annotation conversion, empty/duplicate labels and 3D nullable boxes | X-Ray gap | P0 | QA |
| REQ-D07 | README documents detection, labeling, export and local-model limitations | X-Ray gap | P1 | End User / Operator |
| REQ-D08 | Existing depth, point-cloud, BEV and A* behavior continues to typecheck and build | Regression boundary | P0 | QA / Developer |

## AUTO-ANSWERED FROM SCAN

- Runtime remains browser-only, static and privacy-first; no backend, auth or database.
- Existing UI and HIVE design system are reused.
- Detection remains a second latest-frame-wins worker and is off by default.
- Relative depth is not converted to meters.
- Existing WebGPU → WASM and WebGPU renderer → WebGL2 fallbacks remain unchanged.

## DECISIONS LOG

| ID | Decision | Chosen | Rationale |
|---|---|---|---|
| D-008 | Product direction | RoboEye Edge Perception Studio | Homeowner approved on 06/08/2026 |
| D-009 | Stabilization scope | Formalize and test existing detection before adding features | Avoid compounding unverified behavior |
| D-010 | Architecture | Preserve current dual-worker/browser-only architecture | No approved reason to redesign |
| D-011 | Test runner | Node test runner via lightweight TypeScript execution tooling | Test pure converters without browser/model downloads |
| D-012 | Blueprint checkpoint | Combined with Homeowner “chốt” | Cycle preserves architecture and implements the approved stabilization scope |

## OPEN QUESTIONS

No blocking question for TIP-08. Target market, packaging and pricing remain future product-strategy work and do not affect this stabilization cycle.
