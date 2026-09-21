# DriveSense technical-frontier evidence registry

This directory is the reproducible source package for **TIP-56A**. It audits
candidate methods against the current DriveSense architecture; it does not
promote a model or change the runtime.

## Scope

- vehicle detection and multi-object tracking;
- monocular metric geometry and camera calibration;
- drivable-area/lane understanding;
- browser and future native-edge video runtimes;
- validation datasets and in-vehicle warning HMI.

The universe was frozen at 18 representative entities before extraction.
Official documentation, official repositories and government guidance are
preferred. Marketing benchmarks are retained only with their hardware and
measurement context; they are not treated as DriveSense results.

## Reproduce

```bash
node research/technical-frontier/capture.mjs
node research/technical-frontier/extract.mjs
python3 /Users/os/.codex/skills/refinery/refinery.py research/technical-frontier
python3 /Users/os/.codex/skills/refinery/bites.py research/technical-frontier
(cd research/technical-frontier && shasum -a 256 -c snapshots.sha256)
```

`capture.mjs` intentionally touches the network. The remaining commands work
from the frozen snapshots. `extract.mjs` fails if an evidence span is absent.
The refinery rejects unsupported licences, terms, benchmarks and limitations.

## Files

- `captures.json`: URL, capture time, snapshot name and SHA-256 per source.
- `snapshots/`: inert source snapshots; no page code is executed.
- `snapshots.sha256`: integrity manifest.
- `domain.yaml`: schema, source policy and fail-loud rules.
- `extract.mjs`: deterministic claim extraction.
- `claims.jsonl`: 84 source-backed claims for 18 entities.

## Interpretation limits

This registry answers whether a technique exists, what the publisher says it
does, where it can run and which licence/validation constraints are visible.
It does **not** establish accuracy, latency, thermal stability or commercial
fitness on DriveSense hardware and Vietnam road video. Those require a
same-corpus benchmark and independently measured physical truth.
