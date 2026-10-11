# TIP-64B3 — UI / QA Builder handover

Date: 2026-10-11. Builder: asset_qa. Scope: Q04–Q05, Q09–Q10; coordinated with object_core and native_runtime. Frontend-design informed a camera-first scientific instrument: neutral high-contrast chrome, stable identity and uncertainty, no decorative blink or green safety status.

## Implemented

- Stable per-ID UIView / UIAccessibilityElement instances. Thin dark-backed cyan/amber corner graphics; real IDs and decimal-tenth approximate metre text, not a centimetre-accuracy claim.
- Presentation-only Core filter integration; raw association/depth/export coordinates remain outside the renderer. Dense badges use bounded deterministic placement, previous legal slots, header/footer exclusions and restrained leader lines. Labels may be omitted only when no legal slot exists; outline and accessibility identity remain.
- Label fitting cached by text, available width and Dynamic Type category. Unlimited lines preserve the metric for long labels/large fonts. Stable accessibility array updates only on identity membership changes; no unsolicited speech.
- Single lifecycle-bound 30 Hz presentation/expiry clock, with <=10 Hz metadata/controls/diagnostics maintenance. No timer while camera is stopped; no duplicate draw for unchanged evidence/freshness state. This is a scheduling cap, **not measured physical UI FPS**. The runtime camera watchdog no longer republishes automatic graphics.
- Compact high-contrast camera action, restrained diagnostics button, short live target status and persistent source warning. Bundle-based version. Manual selection, confirmation, recording, truth and JSON sharing retained.
- Runtime diagnostics show bounded inference P50/P95, capture-to-ready/work P95, executed stage/drop/error/lock/projection counters only in expanded diagnostics; mocks are explicitly not performance measurements.
- **16 UI cases total**: all original 11 retained (format assertions updated from hundredths to tenths), plus dense twelve identities/collision exclusions, jitter+Reduce Motion+stale, edge objects/bright backdrop/rotation, compact default instrument, dense large-type portrait/landscape. Simulator paths remain Debug-only and permanently watermarked.
- Canonical native QA writes TIP64B3 per-run receipts, binds an explicit xcresult, exports actual screenshots, records structured failure counts, streams bounded logs, asserts exact Swift/UI totals and presence of the eleven original cases, fingerprints package-lock/QA sources/toolchain, checks B1/B2 evidence is unchanged, and restores a simulator that it booted.
- Legacy qa:assistive-ios delegates to the current native gate; it does not imply web QA. Interop retains all seven closed-v1 cases and writes only B3. Preflight is discovery-only with nullable installed/signed/readiness fields; target-specific Debug/Release Team checks; no UDIDs or credentials retained; owned scratch is removed before claiming cleanup.
- Mac model smoke compiles the SAME shipping descriptor, validates the same input/output schema, supplies confidence 0.38/IoU 0.45 inputs and requires combined class*object confidence >=0.38. Original artifact/hash/license unchanged; Mac time is not phone latency.

## Verification before source freeze

- Node syntax checks: qa-assistive-objects, qa-assistive-ios, preflight-assistive-ios PASS.
- Swift parse of ObjectOverlay / ProbeViewController / ProbeUITests / ModelQA PASS. Parse alone is **not** a platform type/build proof.
- No Xcode build, simulator run, phone installation, commit, push or deployment performed by this Builder.
- Core Builder separately reported 94/94 Swift cases and synthetic jitter reduction 81.717%; Contractor must bind fresh full-gate receipts to final sources.

## Pending acceptance / deferred physical gates

Contractor runs frozen-source model smoke, native Release build/analyze and all 16 UI cases, then visually reviews portrait, landscape, dense and AX screenshots. Physical semantic recall, range error, photon-to-screen latency, VoiceOver user experience, frame pacing and 30-minute thermal endurance remain **NOT TESTED** by simulator graphics. Nearest readout still uses the actual fresh minimum; user pinning/audio/haptics are not added or implied.

Status at handover: **IMPLEMENTED; FINAL QA PENDING**, not a commercial safety acceptance.

## First full-gate review and repairs (history preserved)

Contractor reported actual 94/94 Swift, 16/16 UI, three model smokes, Release/analyze and interop passing in the first frozen run. Source and B1/B2 hashes were unchanged. The run correctly remained FAIL because cleanup returned 149 after Xcode had already shut down the selected simulator. New pure policy tests (9/9) verify exact-state discovery before and after any shutdown: an already Shutdown device is success without a redundant command; a nonzero exit is only acceptable with independent post-state proof; failed/unknown restoration remains a failing gate. The first receipt is not edited.

Rendered dense-scene review found a defect missed by rectangle collision tests: later-created corner strokes painted across earlier badges. Two retained composition planes now keep ALL outline/leader graphics below ALL label plates regardless of object creation order. Debug hierarchy invariants execute in the existing dense fixtures. No every-frame z-order reshuffle, ID change, metric hold or historical-receipt rewrite is used. A new frozen full run and visual review remain required.
