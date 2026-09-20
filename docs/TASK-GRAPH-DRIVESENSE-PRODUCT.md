# DriveSense product task graph

**Baseline:** 2026-09-17
**Method:** Vibecode — Contractor defines gates and verifies evidence; Builder implements one bounded TIP at a time; product owner approves strategic architecture and field-risk decisions.

## Critical path

```text
SCAN/RRI/PRD
   ├── TIP-47A independent scorer ──→ TIP-49L-B local video workbench ─┐
   └── TIP-48 live E2E instrumentation ─→ TIP-49L-A local camera path ─┤
                                                                    ↓
                         SOFTWARE-READY LOCAL GATE (no hardware purchase)
                                                                    ↓
                           TIP-47B physical truth corpus (deferred)
                                                                    ↓
                              TIP-50 same-corpus hardware/model bake-off
                                                                    ↓
                              TIP-51 calibrated live range + shadow warnings
                                                                    ↓
                              TIP-52 HMI/installation/soak/privacy release gate
                                                                    ↓
                              TIP-53 licensed route-data connectors
                                                                    ↓
                              TIP-54 limited B2B pilot package
```

No downstream node may claim readiness when a required upstream gate is missing. UI polish and additional models cannot substitute for physical truth or end-to-end latency.

## Nodes and gates

| Node | State | Purpose | Entry | Exit evidence |
|---|---|---|---|---|
| D0 Scan/RRI/PRD | DONE | Establish current truth, product boundary and measurable requirements | Repository + prior reports | Scan, RRI, PRD and draft commercial blueprint |
| TIP-STAB-01 | VERIFIED | Recover one reproducible local source of truth before further feature work | Dirty local worktree + source scan | Inventory, quarantine, traceability, partitioned commits and local quality gates |
| TIP-STAB-02 | NEXT | Restore remote CI and release truth without deploying an unverified artifact | Clean STAB-01 baseline | Green remote CI, commit-aligned release candidate and explicit deploy decision |
| TIP-47A | VERIFIED | Independent corpus contract and scorer | Approved PoC blueprint | 163/163 tests; build pass; synthetic scorer clearly non-field |
| TIP-48 | VERIFIED / runtime measurement pending | Measure live capture→result→risk→display/audio | Current browser camera pipeline | Instrumentation/tests/build pass; first 30-minute camera report still required |
| TIP-49L-A | IMPLEMENTED / runtime evidence pending | Select laptop/phone webcam and run detector plus bounded same-frame live depth | TIP-48 contracts | Tests/build pass; operator camera report still required |
| TIP-49L-B | IMPLEMENTED / clip evidence pending | Explicit offline quality/speed presets, profiling and exact session cache | Existing uploaded-video pipeline | Tests/build pass; operator's two real clips must be rerun for before/after timing |
| TIP-49L-C | CODE-ACCEPTED v6 / runtime + physical accuracy pending | Enforce ground-contact ordering across car/truck/bus before filtering and at HUD/risk publication | Observed 70/56, 57/52, 51/45 and post-filter 51/43 inversions + 39-claim registry | All regression and quality gates must pass; user must rerun clip on v6 |
| TIP-47B | DEFERRED / external evidence needed | Acquire controlled physical truth | Measurement method, camera/device IDs, consent/rights | Locked journey/device split; synchronized physical distances; provenance audit |
| TIP-50 | DEFERRED by product owner | Select compute/model on identical evidence | Real corpus + instrumentation + candidate hardware | Pareto report for quality, latency, power, heat, BOM/license; explicit promotion decision |
| TIP-51 | BLOCKED by 50 | Integrate calibrated live metric range and event-level shadow policy | Selected runtime/model and fixed mount | Predeclared range coverage/error and missed/false-warning gates in fixed ODD |
| TIP-52 | BLOCKED by 51 | Make pilot installation and operation durable | Stable live pipeline | 30 min then ≥2 h soak, fail-closed degraded states, rollback, privacy and installer checklist |
| TIP-53 | BLOCKED by commercial architecture approval | Add connected route awareness without entering local warning hot path | Signed data rights/provider test access | Direction/map-match/TTL/dedup quality, outage safety and per-vehicle cost report |
| TIP-54 | BLOCKED by 52 plus selected parts of 53 | Limited B2B pilot | Buyer, route, fleet, liability/claims and support owner | Partner-approved protocol, incident review, KPI/cost report and stop criteria |

## Work-in-progress limits

- At most one perception/runtime TIP and one field-evidence activity run concurrently.
- No model promotion while test split or metric contract is changing.
- No public-road driver warning until shadow-mode event metrics and degraded states pass.
- Every TIP ends with a Completion Report and Contractor verdict; synthetic results cannot satisfy a field gate.

## Immediate sequence

1. Complete TIP-STAB-02: push the recovered baseline, make remote CI green and
   verify that any release candidate names the exact source commit.
2. Rerun the two existing uploaded clips under Detail, Balanced and Fast; export reports and compare elapsed time, stage P95, detections and metric coverage.
3. Test the MacBook camera and phone exposed as a webcam; export a short live report to verify source selection, metric acceptance/drop counts and capture→overlay latency.
4. Close remaining software-only defects and package a repeatable local demo before any purchase, mount or vehicle setup.
5. Only after the product owner reopens investment work, acquire TIP-47B physical truth and use it with runtime reports for the TIP-50 hardware/model bake-off.

## Product-owner decision checkpoints

- Approve or revise the commercial blueprint before TIP-52 or native edge/cloud restructuring.
- Name the first buyer/pilot route and allowable alert error before TIP-53.
- Approve any public-road test protocol, retention policy and user-facing claim separately from software completion.
