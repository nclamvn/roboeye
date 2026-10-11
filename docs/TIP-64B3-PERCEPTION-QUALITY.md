# TIP-64B3 — Perception Quality & Stable Scientific HUD

Date: 2026-10-11 · Contractor: Codex · Method: vibecode-kit v6.2

## Scope and authority

Source: user requests an architect-level product scan, cleanup of bottlenecks and technical debt, flexible AI, and stable premium visual UX after trying the native iPhone app.

This TIP implements bounded quality repairs to RoboEye Assist. The request authorizes these compatible repairs; the scan/RRI/blueprint/contract checkpoints are consolidated here. It does **not** authorize a paid model/API, new hardware, cloud uploads, a navigation-safety claim, a Git push, or production deployment. DriveSense and RoboHand remain separate products; the web Assist page remains an evidence lab, not a native sensor app.

## Scan / RRI

- Native: Swift, UIKit, ARKit sceneDepth, Vision/Core ML; one camera owner, one in-flight frame; no server or account.
- Web: TypeScript strict, Vite, three.js, ONNX workers; `/`, `/drive.html`, `/assist.html`, road annotator. Shared closed v1 evidence contract, not one interchangeable live engine.
- Reusable safeguards: monotonic frame clock, RGB/depth same-frame checks, finite geometry, 300 ms metric TTL, 600 ms visual coast, 12-track cap, consent-gated bounded RAM metadata, offline checksum-pinned model.
- Baseline software checks on this turn: TypeScript check PASS; 353/353 web unit cases PASS. Native B2 receipts are historical, not automatically proof of the forthcoming changes.
- B2 physical receipt: a 15 s real-camera smoke observed detection and one measured object, max detector inference 67.4 ms. No physical accuracy, recall, UI frame pacing or 30-minute thermal acceptance has been demonstrated.

Confirmed debts from code inspection:

| Priority | Debt | Evidence before edits | Action |
|---|---|---|---|
| P1 | Ambiguous same-class reassociation leaves obsolete coasting boxes alongside a new identity | `Core/ObjectTracking.swift`, ambiguous branch followed by unconditional old-track append | Retire ambiguous candidates; global bounded association; no inherited metres |
| P1 | Greedy confidence-order matching can consume the only valid match for another detection | Same tracker association loop | Max-cardinality, then best-cost matching; deterministic adversarial tests |
| P1 | Box jitter and label collisions; excess apparent precision | `App/ObjectOverlay.swift`, direct frame assignment, per-pass sizeThatFits, `%.2f`, no collision policy | Presentation-only adaptive filtering; decimal tenth; collision-aware stable labels |
| P1 | Duplicate UI refresh and accessibility recreation | DepthSession 10 Hz expiry + VC 10 Hz heartbeat + worker output; new AX elements per draw | One UI presentation/expiry owner; reuse AX/views and text sizing |
| P2 | Recording projection allocated even without consent/recording | ObjectPipeline constructs every packet | Request projection only when recording; maintain live range independently |
| P2 | Depth/confidence buffers locked again for every object | ObjectDepthSampling.samples inside track loop | One validated lock pair per processed frame |
| P1 | Repeated model/inference errors can retry at camera cadence; incompatible outputs silently become empty objects | ObjectPipeline catch/load/cast | Bounded backoff, explicit incompatibility, validated model descriptor |
| P2 | Diagnostic evidence lacks rolling timing/drop/error distributions | Only current work time / 15 s aggregate | Bounded local-only runtime diagnostics, distinguish inference from capture-to-ready |
| P1 | Legacy/current QA gates are inconsistent; reruns overwrite old TIP evidence | qa-assistive-ios fixed historical count; qa-assistive-objects fixed B2 directory | Coherent current gate, named B3 receipts, preserve B2; exact counts |

Deferred structural gaps: bbox interior is not an instance mask; tilted/partially occluded surfaces need a foreground-aware range estimator and measured truth; non-LiDAR devices currently cannot use this native capture path; automatic v1 exports intentionally do not certify semantic foreground. These are not repaired by extending TTL or lowering confidence.

## Blueprint / decisions

```text
ARKit RGB + sceneDepth (one immutable frame)
  → single-flight Vision detector / image tracker
  → raw normalized object identity + same-frame depth estimate
  ├→ consent-gated v1 diagnostic projection
  └→ fresh measurement + presentation-only box filter
       → collision-aware HUD / reused accessibility objects
```

- Filtering is a display concern only. Sampling, identity association, metadata and range use raw coordinates.
- Approximate metres remain fresh, finite, supported and in 0.5–5 m. Unknown stays unknown immediately; no smoothing or hysteresis may borrow expired metres.
- Model replacement is behind an explicit descriptor/validation seam. Only the existing checksum-verified artifact is shipping in this TIP. An unbenchmarked model is not promoted by name or paper AP.
- Design direction: camera-first instrument, compact dark high-contrast controls, quiet cyan/white graphics, amber unavailable state, no flashing or green “safe” indicator. System typography and Dynamic Type; 44 pt minimum hit areas. Reduce Motion disables optional smoothing. Labels and controls avoid occluding one another where feasible; dense scenes degrade without stacking unreadable labels.

## Requirements / acceptance criteria

| ID | Requirement | Verification |
|---|---|---|
| Q01 | Raw measurement/metadata coordinates unaffected by display filtering; 300 ms TTL and loss invalidate metres | Core tests + stale/background UI tests |
| Q02 | Deterministic stationary display-jitter fixture reduces RMS by ≥50%; a discontinuous 0.2 normalized jump reaches target within ≤2 observations | Measured pure-core fixture; not a physical-phone latency claim |
| Q03 | Ambiguous reassociation does not show obsolete duplicates or inherit metres; greedy conflict/permutation fixtures retain unambiguous identities | Tracker regression tests |
| Q04 | Decimal-tenth approximate labels, stable per-ID graphics/AX, bounded collision placement and viewport clipping | Pure layout cases + rendered simulator captures |
| Q05 | One UI expiry/render owner; no duplicate timer rendering; lifecycle/rotation resets graphics immediately | Native code review + UI lifecycle cases |
| Q06 | One in-flight frame, bounded adaptive scheduling and error backoff; incompatible model output is explicit | Runtime policy tests + build/static checks |
| Q07 | One depth/confidence lock pair per frame; v1 projection skipped without recording request | Runtime inspection + recording/interop regressions |
| Q08 | Bounded local diagnostics distinguish inference, work, capture-to-ready, drops and failures; no private image uploads/history | Core tests + diagnostic UI |
| Q09 | Camera-first compact high-contrast HUD, no blinking; portrait/landscape/Dynamic Type controls usable; no safety claim | UI tests + visual inspection |
| Q10 | Current QA commands produce B3 receipts without altering B2; model smoke uses runtime confidence threshold; exact Swift/UI totals | QA gate and preserved-evidence checks |
| Q11 | Existing offline artifact/license and signing settings preserved; new model configuration validated, no silent unsupported fallback | Asset/build/generator/config checks |
| Q12 | Audit, model comparison, deferred risks and quantitative completion report delivered | Contractor review |

## Builder ownership / task graph

1. `object_core`: `Core/ObjectTracking.swift`, new `Core/ObjectPresentation.swift`, related core tests. No depth estimator policy relaxation.
2. `native_runtime`: `App/ObjectPipeline.swift`, `App/DepthSession.swift`, runtime policy/config + tests; project/generator source registration. Preserve Personal Team, bundle ID and offline model.
3. `asset_qa`: `App/ObjectOverlay.swift`, `App/ProbeViewController.swift`, native UI tests, current/legacy QA/preflight scripts. Coordinate APIs with both Builders. No simultaneous Xcode builds.
4. Contractor: read primary technical sources, audit/report/TIP, independent verification and rendered UI review. Freeze source writers before fingerprinted final QA.

## Verification / release boundaries

Reuse existing checkout, `.build` and `.build-xcode`; no project copy, dependency installation or extra temporary build tree. Disk check before large work. No automatic phone installation in this TIP without informing the user. Final software status must separately state untested physical accuracy, thermal/endurance and accessibility user validation. A successful simulator screenshot is not a real-camera measurement.

Required handover: implemented/total requirements, scenario pass/fail/untestable with severity, exact test/build/type counts, measured jitter results, changed files, remaining gaps, READY / READY with deferred physical gates / NOT READY.
