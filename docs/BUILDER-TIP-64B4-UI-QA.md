# TIP-64B4 — Class fill UI / QA Builder report

2026-10-11 · Builder: asset_qa · Contractor contract: `TIP-64B4-CLASS-BADGES-RECOGNITION.md`.

## Status

**PARTIAL — implementation complete; frozen platform QA and actual visual review pending.** No app build, simulator launch, installation, model download, commit, push or deployment by this Builder. Main Contractor owns final gates and authorized installation after acceptance.

## Focused scan and decisions

- Existing native Swift/UIKit camera-first instrument, Core ML/Vision detector and ARKit depth. No server/API/account or new dependencies needed.
- The reported fill defect was literal: `ObjectOverlay` set nearly-black backgrounds, and Reduce Transparency changed them to black. Border hue represented range validity; no class-owned fill existed.
- Reused pure `ObjectPresentation.swift`, canonical class aliases, retained geometry/badge planes, stable AX instances, collision/exclusion layout and stateless metric TTL. No new project source registration or measurement architecture.
- Frontend-design influence: spend chromatic emphasis on semantic badges only, keep surrounding camera controls restrained, white legible names/IDs, no flashing or positive-safety colors. System type/Dynamic Type unchanged. Direct compatible refinement was already authorized in the TIP; no new architectural decision assumed.
- Names/IDs remain necessary; thirteen family tokens do not imply eighty uniquely distinguishable hues. Unsupported classes do not gain model support merely because a palette fallback exists.

## Implementation / requirement mapping

| REQ | Builder work | Acceptance status before final gate |
|---|---|---|
| C01 | Actual solid opaque class fills; seven distinct common-class tokens; canonical aliases reuse hue. Palette uses class only, not ID/score/range. | Portable token/integration PASS; actual UI pixel cases added, pending execution |
| C02 | Every token has white contrast >=4.5; lowest is **5.645:1**. Unknown metric explicitly says `— m · chưa đo`; amber range cue remains separate from fill. Opaque fills unchanged under Reduce Transparency. | Portable contrast PASS; unknown/transparency screenshot case pending |
| C03 | Two retained planes/AX/cache/collision and raw coordinates unchanged. Existing sixteen UI cases retained. New seven-class fixtures are Debug-simulator-only, permanently watermarked; no fan fixture. | Source review/Swift parse PASS; dense/bright/AX rendered review pending |
| C04 | No model/heuristic/EXIF change or phone→remote remapping. Phone/remote semantic confusion and absent fan vocabulary explicitly remain recognition gaps, investigated separately by Contractor/Core Builder. | Not claimed fixed by this palette work |
| C05 | Version **0.2.2/build5** in Info, both app configurations and generator; signing/model untouched. Current gate, interop, preflight and legacy alias output only B4. B1/B2/B3 directories are historical checksum inputs, never output directories. | Source/plist/script checks PASS; immutable-history/frozen-source gates pending |

Common fills: person azure `#085A9C`; phone violet `#7238AC`; remote ochre `#8E5D09`; chair/furniture teal `#0A7162`; book indigo `#3F4DAD`; bottle/container berry `#963E79`; refrigerator/appliance petrol `#33677C`. All are alpha1. No fill relies on a near-black plate or colored border alone.

## Test and file accounting

Modified: `Core/ObjectPresentation.swift`, `Tests/ObjectPresentationTests.swift`, `App/ObjectOverlay.swift`, `App/ProbeViewController.swift`, `UITests/ProbeUITests.swift`, `App/Info.plist`, current `.xcodeproj/project.pbxproj`, `scripts/generate-assistive-ios-project.mjs`, current/legacy native QA scripts, preflight and seven-case interop script. Created: `scripts/test-assistive-class-palette.mjs`, this report.

- **6 new pure Swift palette tests**: chromatic/distinct common fills; all-token/class contrast; canonical aliases/no relabel; range-loss/ID independence; unsupported fan vocabulary; deterministic/non-mutating policy.
- **18 UI cases expected**: 16 retained B3 cases plus 2 seven-class REAL simulator screenshot-pixel checks (bright measured and unknown+Reduce Transparency). RGB/opacity assertions sample padded label interior, not an accessibility color string. These remain UI fixtures, not detector recall proof.
- Swift total is parsed exactly from final source; Core Builder is separately adding tracking-policy cases, so no obsolete hardcoded package total is asserted here.
- Portable class source-token checker PASS: **13 tokens**, seven distinct common fills, minimum white contrast **5.645401743:1**. This is explicitly not rendered/recognition proof.
- Node syntax checks PASS for current QA, legacy alias, preflight, interop and generator.
- Swift frontend parse PASS for palette/core tests/Overlay/VC/UI tests. Parse is not a platform type/build proof.
- `plutil -lint` PASS for Info.plist and existing signed-config project. No signing team changed.
- No scratch directories, dependencies or large build folders created.

## Final gate invocation and remaining limitations

After every source owner freezes, Contractor runs:

```sh
npm run qa:assistive-objects
```

To retain the independently supplied refrigerator smoke, append `-- --local-photo` and the existing user JPEG path; pixels must not be copied/uploaded. Current full receipts live only under `docs/evidence/tip64b4/runs/<UTC-run>` plus B4 latest summary. Every old B1–B3 file is checksum-checked unchanged. Actual new palette, dense, bright and AX screenshots require human/Contractor visual critique even when test assertions pass.

Physical range accuracy, phone/remote semantic recall, fan recognition, photo EXIF handling, latency/thermal and accessibility user validation are not improved or proven by badge colors. Model artifact, thresholds, crop policy and closed-v1 evidence contract remain unchanged. No deviation beyond the approved presentation/QA/version scope.
