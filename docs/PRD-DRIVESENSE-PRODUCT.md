# DriveSense — PRD tổng quan từ PoC tới sản phẩm

**Status:** Draft for strategic review · 2026-09-17 · Owner: Chủ thầu/kiến trúc sư trưởng.  **Baseline:** [Scan](SCAN-DRIVESENSE-PRODUCT-2026-09-17.md), [RRI](RRI-DRIVESENSE-PRODUCT.md), [PoC blueprint đã duyệt](BLUEPRINT-DRIVESENSE.md), [TIP-46 verify](COMPLETION-REPORT-TIP-46.md). This PRD is not a certification, performance claim or approval of a commercial architecture.

## 1. Problem and positioning

On a highway, the driver needs timely, sparse information about the vehicle ahead and hazards beyond camera view, not an overloaded analytics screen. Today DriveSense can demonstrate vehicle boxes, approximate range on analysed video and an explainable shadow-risk HUD; it has not demonstrated field range accuracy, complete live camera-to-alert latency, sustained in-car operation or licensed live traffic feeds. Selling it as a real-time safety product before those measurements would create avoidable user and business risk.

**Product thesis:** a camera-first, retrofit-friendly, local-first road-awareness assistant for Vietnam. Edge AI handles immediate vehicle/road risk; licensed connected data adds upcoming congestion, closures, incidents, restrictions and verified fixed cameras. It advises the driver and fleet operator; it never brakes or steers. It must also demonstrate a reproducible AI-assisted engineering method: source/license registry → same-corpus model bake-off → explicit decisions → measured acceptance.

**Initial proposed beachhead:** B2B pilot with a defined fleet/route and installation protocol, before mass consumer sales. This is a proposal pending buyer confirmation, not a signed commercial decision.

## 2. Goals and measurement

| Goal | Measure / proposed first gate | Qualification |
|---|---|---|
| G-01 Bounded live response | P50/P95/P99 sensor capture→visible/audio alert, result age and dropped frame counts; **P95 ≤150 ms is an engineering target**, not achieved | One designated camera/compute in a fixed ODD, sustained ≥30 min; long-run ≥2 h before pilot |
| G-02 Honest distance | Within 5–50 m ODD, proposed trial gate: ≥95% of published values error ≤max(2 m, 20% truth), coverage ≥90% over predeclared eligible targets | Independent truth, no per-clip scale alignment, report bias/P95 and abstentions; not a safety certification |
| G-03 Useful warnings | Event-level missed/false alerts, lead time, wrong-target and stale-alert rate, by scenario | Numeric release threshold to be approved after hazard analysis and pilot corpus; no metric substitutes for this |
| G-04 Connected utility | Fraction of verified, route-relevant incidents delivered before encounter; false/stale event rate and provider downtime | Measured by provider/road; no source is assumed complete |
| G-05 Viable economics | Installed BOM, recurring cost/active vehicle-hour, support burden, gross-margin scenario | Actual pilot usage and provider contracts; no price promise before quotes |

Every metric has a denominator including misses/unknowns. Report by journey, camera, road, light/weather, range bucket and model/build version. Targets are proposed *test gates*, never retrospective claims.

## 3. Personas and stories

- **Driver:** As a driver, I want one timely, comprehensible alert for a relevant forward danger so that I can keep attention on the road; if vision is blocked or data is stale, I need an honest degraded state rather than a green/safe impression.
- **Fleet safety manager:** As a manager, I want post-trip, privacy-bounded evidence for warnings and near misses so that I can distinguish a useful system from nuisance alarms without watching raw video continuously.
- **Installer/operator:** As an installer, I want a reproducible mount, calibration and health check so that lens/crop/power changes cannot silently invalidate metre values.
- **Data steward:** As a steward, I want every external event to carry rights, source, direction, timestamp and expiry so that the product cannot launder an unauthorized/stale report into a warning.
- **Product partner:** As a partner, I want a measured quality/cost report per designated route and hardware set so that I can evaluate a paid pilot and its limitations.

## 4. Requirements with acceptance criteria

### P0 — first controlled product pilot

| ID | Requirement | Acceptance evidence |
|---|---|---|
| DS-01 | Local camera/edge hot path with latest-frame-wins, synchronized speed/timestamps, no cloud dependency | Disconnect network during controlled test; local detection/risk continues, stale results cannot appear as fresh |
| DS-02 | End-to-end latency and long-run health instrumentation | Export capture, decode, inference, risk and alert/display timestamps; P50/P95/P99 plus ≥30 min thermal/memory run |
| DS-03 | Range semantics and fail-closed gate | Distinguish optical Z, ground-forward Z and bumper gap; invalid profile, crop, tiny/side/occluded target or old frame returns unknown |
| DS-04 | Independent evaluation corpus | Split by journey/device; GT object association does not trust model track IDs; report FP/FN, coverage, error by bucket and missing truth as null |
| DS-07 | Low-distraction HMI and audit | One priority warning, short opt-in audio, in-trip controls limited; post-trip evidence/provenance report; no false “safe” state |
| DS-08 | Privacy/operability | Default local video processing, protected diagnostics, explicit consent/retention/deletion plan, device health and rollback tested before pilot |
| DS-10 | Reproducible AI selection | Model, weights/hash, license, preprocessing, test split, hardware and latency captured; challenger only promoted on predeclared Pareto gate |

### P1 — connected route awareness after local core gate

| ID | Requirement | Acceptance evidence |
|---|---|---|
| DS-05 | Local warning survives API outage | Feed outage/expired event cannot block or mislabel camera risk |
| DS-06 | Licensed event ingestion | Contract/permission recorded; source, capture time, geometry, travel direction, confidence and TTL required; duplicates and opposite carriageway rejected |
| DS-09 | Provider/compute cost control | Per-API request ledger, caps, route-aware refresh and monthly per-vehicle cost report; no polling per video frame |

### P2 — candidates only after evidence

True lane/drivable-area model, cut-in prediction, calibrated far-range policy, offline map packs, OEM/display integration and partner analytics. Candidate ≠ promise.

## 5. Non-goals and exclusions

1. No automated brake/steer/throttle, collision-avoidance guarantee or ADAS certification in the initial product.
2. No public-road alert release merely because the synthetic UI and unit tests pass.
3. No live police-checkpoint location feature in MVP; verified fixed camera and speed-rule data are a separate licensed candidate.
4. No scraping Google/Waze/paid tiles into a competing event database; source access is not redistribution permission.
5. No LLM in the immediate warning loop. LLMs may assist offline source extraction/review with evidence and human approval.

## 6. Product architecture and operation

`camera + speed/GNSS → local timestamped perception/range/track/risk → minimal alert + bounded evidence`; independent `licensed source connectors → provenance/rights validation → map match (road + direction) → TTL/dedup → route-context advisory`. Browser TypeScript UI/replay and pure policy contracts are reusable. Edge native runtime, camera/power/thermal package and connected service are **draft commercial architecture** pending approval. Missing network degrades only route context; missing/late local sensor data degrades distance/risk explicitly.

Device/route data are sensitive. Video remains local by default; upload, plate/face redaction, consent, access roles, retention and deletion require explicit pilot policy. External provider data may not be cached, merged, used for AI training or redistributed unless its agreement permits it.

## 7. Phasing and release gates

| Stage | Deliverable | Exit gate |
|---|---|---|
| P0a — TIP-47 | Corpus contract, scorer, then real journey GT acquisition and independent benchmark | Synthetic harness passes; real-data metrics remain null until truth exists; report covers all misses |
| P0b-local | Software-complete local workbench | Uploaded-video presets/profiling plus selectable MacBook/phone webcam pipeline; tests/build pass and local reports are reproducible |
| P0b-field | Live pipeline and instrumented hardware bake-off — deferred until product-owner approval | Measured capture→alert, frame age, 30 min/2 h heat/power; choose hardware/model from same corpus |
| P0c | Calibrated live range and event-level shadow warnings | Predeclared range and false/missed-warning gates in controlled test, with documented ODD and degraded states |
| P1a | Licensed route data connectors and event QA | Rights signed, route-direction relevance/freshness/coverage measured, outage safe |
| P1b | Limited B2B pilot | Installation, consent, support, rollback, economic and incident review process accepted by partner |
| P2 | Production hardware/OEM pathway | Automotive environmental/electrical and security review; separate release decision |

No calendar promise is made before data access, hardware and pilot partner are confirmed. See [proposed commercial blueprint](BLUEPRINT-DRIVESENSE-COMMERCIAL-DRAFT.md), [product task graph](TASK-GRAPH-DRIVESENSE-PRODUCT.md), [TIP-47](TIP-47-VALIDATION-CORPUS.md) and [TIP-48](TIP-48-LIVE-LATENCY-INSTRUMENTATION.md).

## 8. Open decisions

Buyer/contracting entity, pilot routes/fleet size, first camera/compute/speed source, ground-truth access, data-provider contracts, allowable alert error rates and launch liability/claims are open (OQ-01..06 in RRI). These block a commercial release but not the first validation-tool build slice.
