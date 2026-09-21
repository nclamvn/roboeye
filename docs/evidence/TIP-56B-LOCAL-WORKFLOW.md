# TIP-56B local workflow — old or new uploaded video

The Common Evidence Plane can reuse an old DriveSense test video. The original
file must still be available so its SHA-256 and dimensions can be bound to the
reviewed truth. A screenshot or old report alone is not sufficient.

## 1. Export the current control candidate

1. Open `drive.html` locally.
2. Load the video, select one fixed analysis preset and wait for the complete
   analysed replay.
3. Download `drivesense-report.json`.

The report now contains `evidencePlaneCandidate`: the pinned RT-DETRv2 control,
tracker contract, exact sample ordinal/media timestamp, boxes, track IDs,
primary-target selection and available telemetry. It contains no video pixels
or filesystem path. Unsupported browser telemetry stays `null`.

## 2. Create reviewed truth and a benchmark plan

For the exact sampled timestamps, review each vehicle box and give the physical
vehicle an independent `objectId`. Mark at most one `primaryTarget` per frame.
The reviewer must not copy candidate track IDs into truth IDs.

The plan is the TIP-56B envelope without `candidates`:

```json
{
  "schemaVersion": 1,
  "benchmarkId": "vn-highway-bakeoff-r1",
  "protocol": {
    "minimumIou": 0.5,
    "labelPolicy": "vehicle-family",
    "samplePlanId": "balanced-5hz-reviewed-r1",
    "preprocessingId": "stretch-640x640-rgb01"
  },
  "corpus": {
    "corpusId": "vn-highway-reviewed-r1",
    "journeys": [
      {
        "journeyId": "clip-001",
        "split": "test",
        "width": 1280,
        "height": 720,
        "sourceSha256": "REPLACE_WITH_64_HEX",
        "rights": { "basis": "owned", "reference": "REPLACE_WITH_RIGHTS_RECORD" },
        "annotation": { "method": "independent-reviewed", "reference": "REPLACE_WITH_REVIEW_RECORD" },
        "scenarioTags": ["highway", "multi-lane"],
        "truthFrames": []
      }
    ]
  }
}
```

`truthFrames` cannot remain empty when assembled. The repository synthetic
fixture demonstrates the complete object/frame shape.

## 3. Run challenger adapters

Each challenger must export the same `DriveCandidateExport` shape and must use
the identical `preprocessingId`, sample ordinal and timestamp. It must emit a
frame with `objects: []` when nothing is detected. Never remove a slow or empty
frame from the run.

The first intended challengers are RF-DETR Nano and YOLO26n, but obtaining
weights and accepting licences are separate decisions. A blocked licence may be
benchmarked and will remain ineligible for promotion review.

## 4. Assemble and score

```bash
npm run assemble:drive-evidence-plane -- \
  plan.json drivesense-report.json challenger-export.json \
  --out evidence-plane.json

npm run benchmark:drive-evidence-plane -- \
  evidence-plane.json evidence-report.json
```

Output files are created with exclusive mode: an existing report is not
silently overwritten.

## 5. Read the decision correctly

- `comparability.status=pass` means inputs shared the locked evidence plan.
- `promotionReviewEligible=true` only means reviewed 2D evidence and commercial
  approval are present. It is not a promotion decision.
- `promotion.automaticWinner` is always `null`.
- Physical metre accuracy is deliberately absent; it belongs to TIP-56D.
- `null` telemetry plus coverage is an honest missing measurement, not zero.
