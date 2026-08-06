# COMPLETION REPORT — TIP-08

**STATUS:** DONE

## FILES CHANGED

Created:

- `src/detection-types.ts`: shared detection engine, box and worker message contracts.
- `src/detection-state.ts`: pure error-recovery policy for main-thread detection state.
- `src/annotations.ts`: pure COCO, YOLO and relative-3D converters.
- `tests/unit/annotations.test.ts`: deterministic export and edge-case tests.
- `tests/unit/detection-state.test.ts`: inference/load error recovery tests.
- `docs/COMPLETION-REPORT-TIP-08.md`: this report.

Modified:

- `src/worker/detect-worker.ts`: typed messages, explicit load/infer error stages and stale async load/infer guards.
- `src/main.ts`: converter integration, tested recovery state and worker-crash status.
- `src/render/scene.ts`, `src/ui/shell.ts`: shared detection types.
- `README.md`: detection workflow, exports, offline models and test commands.
- `package.json`, `package-lock.json`: `test:unit` script and `tsx` dev dependency.

## TEST RESULTS

- REQ-D01: PASS — RT-DETR/OWL-ViT options and opt-in UI preserved; no boot behavior changed.
- REQ-D02: PASS — infer error returns `{ ready: true, busy: false }`; load error stays not-ready; 2 tests PASS.
- REQ-D03: PASS — main/worker/shell/scene compile against one shared contract.
- REQ-D04: PASS — COCO/YOLO coordinate and duplicate-label tests PASS.
- REQ-D05: PASS — 3D export test confirms `scale: relative`, nullable box and no `Depth Pro`/metric-mode claim.
- REQ-D06: PASS — 6/6 unit tests, 0 fail.
- REQ-D07: PASS — README covers controls, annotation lifecycle, three export formats and all current local-model roots.
- REQ-D08: PASS — typecheck 0 errors; production sub-path build PASS, 20 modules transformed in 3.18s.
- Smoke E2E: UNTESTABLE — exit 1 before browser launch because `tests/.model-cache/` is absent. No pass claimed.
- Dependency audit: 2 high, 0 critical; `@huggingface/transformers`/`sharp`, both `fixAvailable=false`.

## ISSUES DISCOVERED

- Smoke fixture: P1 — still requires a manually prepared ignored model cache.
- Dependency advisory: P0 review — existing ML dependency chain keeps two high findings with no automatic fix.
- Full live-model detection: P1 verification — requires browser, network/model cache and real or fake camera; unit/build gates do not prove model quality.

## DEVIATIONS FROM SPEC

- L1 internal hardening: added a monotonic load version and stale inference guard after Contractor review found that rapid engine switching could let an older async result overwrite the selected engine. Public behavior and architecture are unchanged.
- A lightweight `tsx` dev dependency was included by Blueprint decision D-011 to run TypeScript tests on Node 18+.

## SUGGESTIONS FOR CHỦ THẦU

- Accept TIP-08 as READY-with-deferred if code review confirms the shared contract and recovery wiring.
- Make the next cycle reproducible QA: model fixture manifest/bootstrap plus a detection UI smoke lane that does not require downloading full detection models.
- Keep dependency security review separate so an upstream ML-stack decision is not mixed with functional stabilization.
