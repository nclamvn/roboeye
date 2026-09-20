# BLUEPRINT — DriveSense RoadStructure

**Status:** Approved for software-only research/benchmark foundation by product-owner instruction on 2026-09-17. Model promotion, field claims and hardware remain separate gates.

## GOAL

Add a commercial-grade road-context branch that identifies lane markings, drivable surface and physical boundaries, then publishes a bounded-age ego corridor. It augments the current vehicle/range path; it never fabricates metres or weakens the existing abstention policy.

## ARCHITECTURE

```text
Decoded source frame + capture timestamp
  ├── existing vehicle detector → tracker → range/risk
  └── RoadStructure worker
        ├── lane head → typed polylines
        ├── semantic head → drivable / curb / median / barrier / guardrail
        └── temporal fusion → RoadGraph (value-or-unknown, evidence age)
                              ↓
                   ego corridor + lane departure shadow event
                              ↓
                  sparse HUD + post-drive audit
```

## CONTRACTS

- Coordinates stay normalized to the original source frame; preprocessing transforms are explicit.
- Every result carries source frame time, result time, model/artifact IDs and evidence age.
- RoadGraph expires after 250 ms until the hardware bake-off proves a different bound.
- Ego corridor requires both left and right evidence with compatible topology; physical boundary classes remain distinct from paint.
- Metric lateral offset and lane width require calibrated camera geometry; without it the output is qualitative only.

## MODEL BAKE-OFF

| Role | Baseline/challenger | Why evaluated | Promotion gate |
|---|---|---|---|
| Multi-task baseline | YOLOPv2 | Detection + drivable + lane in one network | Rights, pinned export, browser runtime, same-corpus score |
| Lightweight lane | UFLDv2 R18 | Documented ONNX route and low-compute design | CULane/weights rights + ORT Web compatibility |
| Lane accuracy | CLRerNet DLA34 | Strong source-reported CULane F1 | Export/runtime + temporal score + rights |
| Semantic boundary | PIDNet-S | Real-time semantic/boundary architecture | Browser/edge export + class mapping + rights |
| Four-class road baseline | Open Model Zoo road-segmentation-adas-0001 | Direct road/curb/mark output; tiny published graph | Research benchmark only until Mighty AI provenance and product quality clear |

Source-reported metrics are scouting evidence only. They cannot promote a model.

## DATA AND RIGHTS

- Corpus manifests contain hashes, rights reference, split, scenario tags and annotations—not video bytes or local paths.
- Split at route/session/device level; never random adjacent frames.
- Recommended Vietnam tags: day/night/rain/glare, solid/dashed/faded paint, merge/split, curve, bridge, shoulder, curb, median/con lươn, concrete barrier and guardrail.
- User media is not training data by default. Reuse requires owned/licensed/consented basis and retention policy.

## TASK GRAPH

```text
TIP-50R-A provenance registry ─┐
                              ├─→ TIP-50R-C export/operator probe → TIP-50R-D model bake-off
TIP-50R-B benchmark contract ─┘                                  ↓
                                                    TIP-50R-E RoadGraph fusion
                                                                  ↓
                                                    TIP-50R-F sparse HUD/shadow QA
```

## ACCEPTANCE BOUNDARY FOR THIS ITERATION

TIP-50R-A/B deliver auditable selection infrastructure and a synthetic-tested scorer. TIP-50R-C adds a reproducible research artifact and honest browser runtime proof. It deliberately does not modify the driving HUD or promote the model commercially.
