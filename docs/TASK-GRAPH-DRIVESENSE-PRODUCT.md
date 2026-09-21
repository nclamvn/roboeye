# DriveSense product task graph

**Baseline:** 2026-09-21
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

Commercial evidence lane (never enters the local warning hot path):

TIP-55A sourced candidate registries ──→ TIP-55B provider-neutral fixtures/RFI ──→ TIP-53 trial input

Technical frontier lane (promotion remains blocked by common-corpus evidence):

TIP-56A independent frontier audit ──→ TIP-56B common evidence plane ──→ TIP-50 model/hardware promotion
```

No downstream node may claim readiness when a required upstream gate is missing. UI polish and additional models cannot substitute for physical truth or end-to-end latency.

## Nodes and gates

| Node | State | Purpose | Entry | Exit evidence |
|---|---|---|---|---|
| D0 Scan/RRI/PRD | DONE | Establish current truth, product boundary and measurable requirements | Repository + prior reports | Scan, RRI, PRD and draft commercial blueprint |
| TIP-STAB-01 | VERIFIED | Recover one reproducible local source of truth before further feature work | Dirty local worktree + source scan | Inventory, quarantine, traceability, partitioned commits and local quality gates |
| TIP-STAB-02 | VERIFIED | Restore remote CI and release truth without deploying an unverified artifact | Clean STAB-01 baseline | Green remote CI at `821170d`; deploy remains an explicit decision |
| TIP-47A | VERIFIED | Independent corpus contract and scorer | Approved PoC blueprint | 163/163 tests; build pass; synthetic scorer clearly non-field |
| TIP-48 | VERIFIED / runtime measurement pending | Measure live capture→result→risk→display/audio | Current browser camera pipeline | Instrumentation/tests/build pass; first 30-minute camera report still required |
| TIP-49L-A | IMPLEMENTED / runtime evidence pending | Select laptop/phone webcam and run detector plus bounded same-frame live depth | TIP-48 contracts | Tests/build pass; operator camera report still required |
| TIP-49L-B | VERIFIED / real clips measured | Explicit offline quality/speed presets, profiling and exact session cache | Existing uploaded-video pipeline | Six hash-bound runs on the two original clips; no depth failure/drop; tradeoff preserved |
| TIP-49L-C | CODE-ACCEPTED v6 / runtime + physical accuracy pending | Enforce ground-contact ordering across car/truck/bus before filtering and at HUD/risk publication | Observed 70/56, 57/52, 51/45 and post-filter 51/43 inversions + 39-claim registry | All regression and quality gates must pass; user must rerun clip on v6 |
| TIP-49L-D | IMPLEMENTED / real camera evidence pending | Turn live camera telemetry into repeatable smoke/soak and metric-path gates | TIP-48 instrumentation + TIP-49L-A camera path | Exported camera report passes the automated verifier; no pixels retained |
| TIP-47B | DEFERRED / external evidence needed | Acquire controlled physical truth | Measurement method, camera/device IDs, consent/rights | Locked journey/device split; synchronized physical distances; provenance audit |
| TIP-50 | DEFERRED by product owner | Select compute/model on identical evidence | Real corpus + instrumentation + candidate hardware | Pareto report for quality, latency, power, heat, BOM/license; explicit promotion decision |
| TIP-51 | BLOCKED by 50 | Integrate calibrated live metric range and event-level shadow policy | Selected runtime/model and fixed mount | Predeclared range coverage/error and missed/false-warning gates in fixed ODD |
| TIP-52 | BLOCKED by 51 | Make pilot installation and operation durable | Stable live pipeline | 30 min then ≥2 h soak, fail-closed degraded states, rollback, privacy and installer checklist |
| TIP-53 | BLOCKED by commercial architecture approval | Add connected route awareness without entering local warning hot path | Signed data rights/provider test access | Direction/map-match/TTL/dedup quality, outage safety and per-vehicle cost report |
| TIP-54 | BLOCKED by 52 plus selected parts of 53 | Limited B2B pilot | Buyer, route, fleet, liability/claims and support owner | Partner-approved protocol, incident review, KPI/cost report and stop criteria |
| TIP-55A | VERIFIED | Establish auditable technical/provider evidence before commercial integration | Approved research direction; primary official sources | Two deterministic registries, 9 entities/36 claims, source-span gates and destructive bite suites pass |
| TIP-55B | VERIFIED / commercial answers pending | Define provider-neutral connected-event contract and compare HERE/TomTom without a live safety dependency | TIP-55A + public official schemas + synthetic offline fixtures | Neutral advisory-only contract; HERE/TomTom fixtures; direction/map-match/TTL/dedup tests; honest-null Vietnam coverage, rights, retention, SLA and cost RFI |
| TIP-56A | VERIFIED / no runtime promotion | Independently audit current DriveSense direction against the technical frontier | Current repository truth + frozen official-source universe | 18 entities, 84 claims, 100% declared coverage, hash/source gates and destructive bite suite pass |
| TIP-56B | VERIFIED / real challenger evidence pending | Build one same-sample, same-video evidence plane for detector/tracker challengers | TIP-56A + existing uploaded clips and reviewed 2D labels | Closed contract, uploaded-video export, assembler/scorer and synthetic proof pass; real reviewed clips/challenger runs remain external inputs |

## Work-in-progress limits

- At most one perception/runtime TIP and one field-evidence activity run concurrently.
- No model promotion while test split or metric contract is changing.
- No public-road driver warning until shadow-mode event metrics and degraded states pass.
- Every TIP ends with a Completion Report and Contractor verdict; synthetic results cannot satisfy a field gate.

## Immediate sequence

1. **DONE:** TIP-STAB-02 restored a clean remote CI/release baseline.
2. **DONE:** the two existing clips were measured under Detail, Balanced and
   Fast; see `docs/evidence/TIP-49L-B-REAL-CLIP-PROFILE-2026-09-20.json`.
3. **IMPLEMENTED / EVIDENCE PENDING:** TIP-49L-D now evaluates an exported
   MacBook/phone-webcam report against explicit runtime smoke/soak gates and a
   separate metric-path gate. The first real camera report is still required.
4. Close remaining software-only defects and package a repeatable local demo before any purchase, mount or vehicle setup.
5. Only after the product owner reopens investment work, acquire TIP-47B physical truth and use it with runtime reports for the TIP-50 hardware/model bake-off.
6. **DONE:** TIP-55A created source-backed technical and traffic-data registries without changing the runtime.
7. **DONE:** TIP-55B defines the neutral advisory-only contract, HERE/TomTom offline adapters and the provider RFI. No credentials or production calls were introduced.
8. **NEXT COMMERCIAL DECISION:** send the TIP-55B RFI to both providers and obtain a timestamped Vietnam corridor sample. TIP-53 remains blocked until written rights, retention, SLA, price and production-version answers exist.
9. **DONE:** TIP-56A independently audited 18 technical/data/HMI candidates. It accepts the current architecture as the control, but rejects field-readiness claims until common-corpus and physical-truth gates pass.
10. **DONE:** TIP-56B freezes a common evidence plane around the existing uploaded-video path. It scores detection, continuity, primary-target churn and runtime coverage without selecting a winner.
11. **NEXT EVIDENCE INPUT:** bind an original clip SHA to independently reviewed 2D vehicle truth, then run the control and one licensed challenger through the same sample plan. No hardware purchase is needed.

## Product-owner decision checkpoints

- Approve or revise the commercial blueprint before TIP-52 or native edge/cloud restructuring.
- Name the first buyer/pilot route and allowable alert error before TIP-53.
- Approve any public-road test protocol, retention policy and user-facing claim separately from software completion.
