# TIP-64B3 — Core Builder completion

Date: 2026-10-11. Scope: Q01–Q04 pure identity / presentation quality.

## Implemented

- Raw normalized object association now uses bounded global assignment: maximize matched cardinality, then geometric score. At most 12 observations and 12 old tracks produce a 24×24 assignment matrix. Same-class ambiguous alternatives create new IDs and retire obsolete compatible coast candidates instead of displaying duplicate ghosts. No range is transferred across a new identity.
- New presentation-only state applies a speed-adaptive 1€ filter to **display** normalized rectangles, with discontinuity/ID/reset/coast/Reduce Motion snapping, bounded deviation, repeated-evidence protection and finite clipped output. Sampling boxes, depth support, object identity and v1 metadata never pass through this filter.
- Current metric eligibility is stateless: 300 ms freshness, 0.5–5 m domain, no coasting, no numeric smoothing/hold. Labels use approximate decimal tenths, not apparent centimetre precision.
- Bounded collision layout tries attached label positions and prefers a previous still-legal slot. Viewport edges, up to 32 control exclusions and previously placed higher-priority labels are checked. If no legal attached slot exists, only the badge is omitted; the UIKit integration owns retained outline/accessibility/focus UI.

## Exact verification

Command: `swift test --package-path native/ios --scratch-path native/ios/.build`.

Result: **94/94 PASS, 0 failures**. Breakdown: 25 existing Core, 41 ObjectTracking, 18 ObjectPresentation, 10 ObjectRuntimePolicy (runtime Builder). Parse check of the four owned Swift files also passed. This adds four tracker tests and 18 presentation tests, and strengthens the existing ambiguity test with the exact one-observation/no-ghost count.

| Fixture | Measured / asserted result |
|---|---|
| Stationary alternating ±0.006 normalized x/y jitter; 240 observations at 30 Hz, first 30 excluded as warmup | Raw RMS **0.008485281**, display RMS **0.001551348**, reduction **81.717%**; gate ≥50% |
| Discontinuous +0.2 normalized x jump | Exact raw target reached in **1 observation**; gate ≤2 |
| Repeated capture timestamp with changed caller rectangle | Cached result unchanged over three redraw times; filter does not advance |
| Greedy-conflict fixture, two observations/two old tracks | Both old IDs retained by globally feasible assignment; reversed confidence order preserves geometry-to-ID mapping |
| Two old same-class candidates, one ambiguous observation | Exactly **1** new-ID box, unknown range; no old coast duplicates |
| Three old candidates, one ambiguous observation | Ambiguous compatible candidates retired; a genuinely unrelated far coast may remain, without metres |
| Maximum-budget separated same-class fixture | **12** old IDs retained after reversed observation order and small movement; no coast duplicates |
| Freshness / unknown / coasting / invalid metric fixtures | Current raw value only; expires immediately after 300 ms and never borrowed after unknown |
| Layout permutation / old-slot / dense / malformed / exclusion fixtures | Deterministic bounded attached labels; no forced detached badge |

The jitter measurement is a **deterministic synthetic display fixture**, not measured phone accuracy, frame pacing, movement latency, detector recall or thermal endurance. Constants (2 Hz minimum cutoff, beta 4, 1 Hz derivative cutoff) are reproducible starting values in normalized display units, not a claim of device-specific tuning. Method reference: [1€ filter primary page](https://gery.casiez.net/1euro/).

## Changed files

- `native/ios/Core/ObjectTracking.swift`
- `native/ios/Tests/ObjectTrackingTests.swift`
- `native/ios/Core/ObjectPresentation.swift` (new)
- `native/ios/Tests/ObjectPresentationTests.swift` (new)
- This completion receipt.

Range-estimator cluster policy, confidence requirements, 300 ms metric TTL and closed v1 export contract were not changed. Generic `ProbeResult` provenance typing, bbox-only foreground ambiguity, tilted/partially occluded surfaces, non-LiDAR hardware and physical accuracy/endurance validation remain deferred in the Contractor TIP. Displayed range remains approximate camera-to-supported interior surface, not guaranteed semantic object foreground or obstacle clearance.

No dependency install, project copy, extra scratch directory, signing mutation, commit, push or device installation was performed. Existing `native/ios/.build` was reused; disk check before the build showed 55 GiB available. Core source freeze follows this receipt; final native/UI/product QA belongs to the Contractor.
