# COMPLETION REPORT — TIP-50R-A

**STATUS:** DONE
**Contractor verdict:** ACCEPTED as research/commercial-release gate; no candidate is yet commercially promotable.

## FILES CHANGED

- Created `src/drive/road-model-registry.ts`: typed candidate/evidence/rights registry and fail-closed audit.
- Created `docs/research/road-structure/`: full upstream snapshots, claim registry, schema and audit instructions.
- Created scan/RRI/blueprint/task-graph and TIP documentation.

## TEST RESULTS

- Registry unit scenarios: 2/2 PASS.
- Refinery positive build: PASS; digest `f7a704e51ce693c8`.
- Refinery bite suite: PASS for every applicable gate; missing capture/span/source, hidden denominator and nondeterminism all stop the build.
- Full unit suite: 182/182 PASS.
- Typecheck/build/security/diff hygiene: PASS.

## FINDINGS

- YOLOPv2, UFLDv2, CLRerNet and PIDNet code licences are permissive in their official repositories.
- That does not clear pretrained weights or training datasets. BDD100K explicitly requires membership/separate commercial licensing outside education/research/non-profit use.
- Source-reported accuracy/FPS is retained only as scouting metadata; it is not comparable browser evidence.

## DEVIATIONS

- None. No weight was downloaded and no runtime/UI behavior changed.
