# Drive-distance refinery — 2026-09-13

24 claims, 10 selected entities, 18 raw source snapshots. This is a purposeful
comparison set, NOT coverage of the whole field and NOT a best-model leaderboard.
Tier A means primary-source evidence about the authors' own work; it does not
mean independent verification of model accuracy or safety. Repository README and
its model card are the same source family, not independent corroboration.

Every record carries URL, capture date, short literal evidence and snapshot name.
`snapshots.sha256` identifies the exact captured bytes. Unmeasured RoboEye range
accuracy and end-to-end latency are intentionally null. Legal shipping approval,
checkpoint provenance and derived ONNX license review are not claimed complete.
Raw main/develop documents may change: pin weights/code revisions before D3.

Cross-checks: DA3 metric checkpoint card versus model-family table; MetricAnything
checkpoint card versus repository; RF-DETR variant-level licensing versus benchmark
hardware; Fast-FoundationStereo README versus its restrictive research license;
KITTI ground-truth capability versus dataset use terms. None establishes road safety.

Additional sources consulted through web retrieval (not raw-snapshot claims):
- https://www.nhtsa.gov/vehicle-safety/driver-assistance-technologies
- https://docs.opencv.org/4.13.0/d9/d0c/group__calib3d.html

Direct raw capture of these two sites returned 403; no raw snapshot was invented.
Incorrect initial README branch/case requests returned 404, then resolved against
the official repository links. No private sources, model weights or videos fetched.

Reproduce from repo root using installed skill engine:

```sh
python3 /Users/os/.codex/plugins/cache/claude-cowork/anthropic-skills/1.0.0/skills/refinery/refinery.py docs/research/drive-distance
python3 /Users/os/.codex/plugins/cache/claude-cowork/anthropic-skills/1.0.0/skills/refinery/bites.py docs/research/drive-distance
```

Source-file integrity: run `shasum -a 256 -c snapshots.sha256` from this directory.
The deterministic auditor checks provenance spans/schema/idempotence, not whether
the scientific claims generalize to Vietnamese traffic or a particular phone.

Decision and scan: [DriveSense blueprint](../../BLUEPRINT-DRIVESENSE.md).
