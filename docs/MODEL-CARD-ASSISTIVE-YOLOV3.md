# Native object detector provenance — TIP-64B2

Reviewed2026-10-11. This is a replaceable integration baseline, not a claim that
YOLOv3 is the newest/best detector or that a laptop smoke proves an iPhone demo.

## Reproducible asset

- Official Apple download: https://ml-assets.apple.com/coreml/models/Image/ObjectDetection/YOLOv3/YOLOv3FP16.mlmodel
- Source model bytes:124207764 (about118.5MiB).
- SHA256:`276afae53da362e25ad21c827f8a929a8512254b1343433d970e725a0de57d8f`.
- Local manifest:`native/ios/Models/assets.json`; binary intentionally ignored by Git.
- Restore: `npm run assets:assistive-objects`; offline verification:
  `npm run assets:assistive-objects -- --verify-only`.
- A mismatched hash/size fails loudly. A `.download-partial` file is removed on
  ordinary success/failure; the existing verified model is never replaced by a
  failed download. No dependency install, camera upload, token or paid API.

The model consumes RGB416×416 and optional scalar`confidenceThreshold` and
`iouThreshold`. It outputs`confidence[N,80]` and`coordinates[N,4]`. Actual
`VNCoreMLRequest` emits`VNRecognizedObjectObservation` with labels and normalized
bottom-left Vision boxes. RGB/model/Vision/display mappings need their own tests;
the output does not directly encode physical depth or object segmentation.

Apple's `VNRecognizedObjectObservation` contract separates conditional class
confidence from object-observation confidence. The runtime and smoke runner use
their **product**, not the often saturated class label score alone:
`combinedConfidence = classificationConfidence × observationConfidence`.
Source: https://developer.apple.com/documentation/vision/vnrecognizedobjectobservation.
Each current schema2 receipt preserves both inputs and the product, and requires
the expected class product to be at least0.25. Superseded schema1 receipts are
retained with `-before-confidence-review` filenames, not presented as current
detection-confidence evidence.

## License provenance — two statements, not a fabricated single notice

Apple's official model card at
https://huggingface.co/apple/coreml-YOLOv3/raw/main/README.md declares`license: mit`
and links https://github.com/pjreddie/darknet as original source. That Apple model
card repository had no standalone`LICENSE` file at review time.

The actual downloaded model's `MLModelLicenseKey` reads:
`Please see https://github.com/pjreddie/darknet for license information.`
Its author metadata identifies Joseph Redmon and Ali Farhadi. The linked original
Darknet `LICENSE` declares public domain, under its YOLO LICENSEv2 notice:
https://raw.githubusercontent.com/pjreddie/darknet/master/LICENSE.

Both statements and the complete original license notice are retained in
`native/ios/Models/LICENSE-NOTICE.txt`, to be included with the app. Do not invent
an MIT copyright holder, silently equate these statements, or use licensing from
an unrelated Ultralytics model. Legal review of weight redistribution/training
data remains appropriate before commercial distribution; a local demo does not
certify every future redistribution arrangement.

## Supported scope

The vocabulary is80COCO categories. Person, refrigerator, chair, book and phone
are examples; a standing fan is not a supported class. This is not “recognize
everything”, person identity recognition, OCR, segmentation, navigation, or
collision safety. Confidence scores are not metric-error probabilities.

Real-depth support, freshness, object association and unknown reasons are supplied
by the separate ARKit/object-range implementation. Bounding boxes can include
background, so a median over an entire box is not automatically the object's
distance. Glass, mirrors, thin structures and poor support must remain unknown.

## Real-image smoke evidence

Run `npm run assets:assistive-objects -- --fixtures`, then
`npm run qa:assistive-objects -- --model-only`.

The QA-only images are cached in the reusable ignored build folder, not bundled
in the app. The manifest pins their original bytes and attributes their licenses:

| Fixture | Author / source | License | Expected class |
|---|---|---|---|
| Gull portrait ca usa.jpg | Dschwen / Wikimedia Commons | CC BY2.5, selected from available licenses | bird |
| Man with marinière t-shirt and backpack.jpg | DimiTalen / Wikimedia Commons | CC0 1.0 | person |

Sources:
https://commons.wikimedia.org/wiki/File:Gull_portrait_ca_usa.jpg and
https://commons.wikimedia.org/wiki/File:Man_with_marini%C3%A8re_t-shirt_and_backpack.jpg.
License links: https://creativecommons.org/licenses/by/2.5/ and
https://creativecommons.org/publicdomain/zero/1.0/.
The downloaded JPEGs are unchanged; inference scaling occurs only in memory.

An optional `--local-photo <path>` checks the user's supplied refrigerator
screenshot directly. It records only labels/scores/boxes/technical metadata, not
private pixels, file paths, exports or uploads.

Three real-image runs passed the combined-confidence threshold: bird0.9849;
person highest1.0; user screenshot refrigerator0.8872 (class0.9961 ×
observation0.8907). These are smoke assertions, not a recall benchmark. Full
current receipts are `docs/evidence/tip64b2/real-model-{bird,person,user-photo}.json`.

The runner constructs fresh Vision requests/handlers to avoid reporting cached
request completion as inference speed. The receipts retain individual Mac
durations only. They are explicitly NOT iPhone latency, end-to-end frame age,
sustained thermal throughput or physical-range accuracy.

## Signing and QA integrity

The project generator refuses to overwrite an existing Xcode project, protecting
the user's Team, bundle ID and selected device. It must not be used to “refresh”
sources in a signed project. New sources/resources are patched in place by the
native builder. The negative generator test verified identical project bytes
before/after refusal.

The independent object QA script preserves TIP-64B1 evidence and writes only
TIP-64B2 receipts. `--model-only` passes only the model/provenance subgate. The full
script additionally requires unit/interop, iOS unsigned Release/analyze, and every
native UI test. Simulated tests must carry permanent simulation labels and be
compiled out of physical-device builds. Physical install/accuracy/latency/thermal
acceptance remains separate, never inferred from these receipts.
