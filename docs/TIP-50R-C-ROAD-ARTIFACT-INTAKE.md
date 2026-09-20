# TIP-50R-C — RoadStructure artifact intake

## HEADER
- Project: RoboEye / DriveSense
- Module: RoadStructure model supply chain
- Depends on: TIP-50R-A, TIP-50R-B
- Priority: P0

## TASK

Create a fail-closed intake contract for every candidate ONNX artifact before browser smoke or benchmark. Pin source repository, full commit, source-weight SHA-256, exported ONNX SHA-256/bytes, exporter/opset, static tensor signatures, runtime providers, tasks and evidence references.

## ACCEPTANCE CRITERIA

- Closed schema rejects unknown fields, credentials, unsafe paths and dynamic tensor shapes.
- Local inspector recomputes exact bytes and SHA-256; it never downloads or stages an artifact.
- Registry and manifest must agree on repository, revision, source weights and tasks.
- Research eligibility and commercial eligibility remain separate.
- A manifest cannot grant itself rights; registry provenance remains authoritative.
- Operator inventory and runtime proof are independent, hash-bound evidence; every declared provider must be exercised and at least one must pass.
- Unit tests prove a valid contract and fail-closed cases.

## OUT OF SCOPE

This TIP does not claim that any currently surveyed model is commercially cleared or browser-compatible. Actual export, ONNX operator inventory, WebGPU/WASM smoke and M1 Max latency remain required before TIP-50R-C can be marked VERIFIED.

## COMMAND

```bash
npm run fetch:road-openvino
python3.12 -m venv tests/.road-tools
tests/.road-tools/bin/python -m pip install -r requirements/road-export.txt
npm run export:road-openvino
npm run inspect:road-artifact -- path/to/manifest.json path/to/model.onnx path/to/runtime-proof.json path/to/operators.json
npm run smoke:road-artifact -- --model path/to/model.onnx --inventory path/to/operators.json --shape 1,3,512,896 --out path/to/runtime-proof.json
```

Exit code `2` means the exact artifact or its declared-purpose promotion gate failed.
