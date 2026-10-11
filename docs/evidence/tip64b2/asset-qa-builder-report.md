# Builder completion — TIP-64B2 assets and QA integration

Status: DONE for downloaded model, provenance, real-image smoke and QA tooling;
PARTIAL for end-to-end UI verification (native runtime builder/root will execute).

## Files

Created: `native/ios/Models/assets.json`, `LICENSE-NOTICE.txt`, ignored official
`YOLOv3FP16.mlmodel`; `native/ios/ModelQA/main.swift`;
`scripts/download-assistive-object-model.mjs`, `scripts/qa-assistive-objects.mjs`;
`docs/MODEL-CARD-ASSISTIVE-YOLOV3.md`; TIP64B2 real-model JSON receipts.

Modified: `native/ios/UITests/ProbeUITests.swift` (5original manual +6automatic
cases), `scripts/generate-assistive-ios-project.mjs` (new-project resources and
existing-project refusal), `package.json` (two commands), `.gitignore` (model and
partial-download binaries). App/Core/current signed Xcode project untouched by
this builder.

## Test results

- Model binary pinned SHA256/size: PASS.
- CoreML compile and Mac native runner compile: PASS.
- Actual Vision recognized-object observations, independent licensed bird: PASS.
- Actual Vision recognized-object observations, independent CC0 people: PASS.
- Actual Vision recognized refrigerator in user screenshot: PASS, combined0.8872
  (classification0.9961 × object-observation0.8907), not label score alone.
- Existing signed project cannot be regenerated and bytes remain unchanged: PASS.
- New Node scripts syntax checks:3/3PASS.
- iPhone install, room recall, LiDAR metric correctness, sustained phone latency,
  thermal30minutes: NOT VERIFIED by this builder.
- Native11UI cases: implemented, execution delegated to root after integration.

`model-summary.json` contains7passing executed gates, exact unchanged focused
source fingerprint and explicit limited scope. No full-app READY verdict is
derived from it.

## Findings / deviations

- Apple HF card declares MIT; actual binary metadata points to original Darknet
  whose notice declares public domain. Both are preserved, no invented MIT notice.
- Approved independent CC-licensed/CC0 fixtures replace a COCO/Flickr photo with
  unverified per-image rights. Both still exercise real80class model inference.
- Reusing an identical Vision request produces cached~0ms completions; fixed the
  QA runner to create a new request/handler each pass before recording Mac times.
- Independent Contractor review caught conditional class scores being reported
  as detection confidence. Updated runner/gate to the Apple-prescribed product;
  all3real-photo regressions passed again. Current schema2 receipts store both
  components and combined confidence; prior schema1 proof remains explicitly
  historical with its original source fingerprints.
- Source model118.5MiB: accuracy-oriented baseline, not newest/lightest phone
  detector. Runtime must control worker cadence/heat and never queue frames.

## Hygiene / security

No project copy, dependency install, venv or task scratch directory created.
Existing reusable `.build-xcode/model-qa` stores compiled detector and licensed
QA fixtures. No user photo copied into project, published, or uploaded. No Team,
Apple account, device signing or production deployment modified. No commit/push.
