# BLUEPRINT — RoboEye Production Hardening and Release 1.2

## GOAL

Turn the verified perception prototype into a reproducible static product release that can be diagnosed locally, recovered after runtime failures, demonstrated by a first-time operator and deployed over HTTPS.

## ARCHITECTURE

```text
Git push/tag
  ├─ CI: typecheck → unit → security → build → contract E2E
  ├─ scheduled/main: pinned real-depth smoke
  └─ release: versioned dist → Pages HTTPS + artifact

Browser
  ├─ app shell + generated release.json
  ├─ service worker: versioned app-shell precache + same-origin runtime cache
  ├─ workers: depth + detection, explicit recoverable states
  ├─ local diagnostics: bounded events → user-triggered JSON download
  └─ guided demo: Camera → Depth → Point Cloud → BEV
```

## DESIGN PLAN

Subject: an edge-perception instrument for robotics operators. The page's single job is to move a first-time operator from camera permission to understanding the four perception stages in under 60 seconds.

### Tokens

- Carbon `#050505`: instrument housing/sidebar.
- Optical black `#0b0b0a`: viewport and boot field.
- Plate `#141413`: panels and runtime cards.
- Signal white `#f2f2ef`: active controls and measured output.
- Muted alloy `#9a9a95`: explanatory text.
- Hairline `#262625`: instrument boundaries.
- Display: Noto Serif for product/scene thesis.
- UI: Inter for actions and explanations.
- Utility: system monospace for versions, stages and diagnostics.

### Layout and signature

```text
DESKTOP                              MOBILE
┌────────┬──────────────────────┐    ┌─────────────────────────┐
│ modes  │                      │    │ brand · modes · controls│
│ control│   live perception    │    ├─────────────────────────┤
│ meters │                      │    │                         │
└────────┴──────────────────────┘    │     live perception     │
                                    └─────────────────────────┘
```

Signature: the boot card carries a four-stop perception rail whose state becomes the 60-second tour after inference starts. It encodes the actual pipeline sequence, so numbering is functional.

Self-critique: the existing near-black editorial look could become a generic “AI dark dashboard.” The rail avoids that by borrowing the product's own camera-to-BEV transformation, while all surrounding controls stay restrained. No new accent color, gradient or decorative chart is introduced.

## REQUIREMENTS MATRIX

| ID | Requirement | Priority | TIP |
|---|---|---|---|
| REQ-P01 | Pull requests and main run type, unit, security, build and browser contract gates | P0 | TIP-12 |
| REQ-P02 | Main/scheduled CI runs the pinned real-depth smoke separately | P0 | TIP-12 |
| REQ-P03 | Static release defines CSP, camera permissions and baseline security headers | P0 | TIP-12 |
| REQ-P04 | Production app shell works after an offline reload once installed | P1 | TIP-12 |
| REQ-P05 | Bounded diagnostics remain local and export only on user action | P0 | TIP-12 |
| REQ-P06 | Depth load/crash exposes retry; infer-frame error releases busy state and continues | P0 | TIP-12 |
| REQ-P07 | Unit and browser tests lock recovery, security/release metadata and offline shell behavior | P0 | TIP-12 |
| REQ-R01 | Package, UI and release metadata expose version 1.2.0 consistently | P0 | TIP-13 |
| REQ-R02 | First-run screen explains the pipeline and offers a guided 60-second demo | P0 | TIP-13 |
| REQ-R03 | Tour advances through RGB, Depth, Point Cloud and BEV with skip/finish controls | P0 | TIP-13 |
| REQ-R04 | Core UI has no horizontal overflow at 375, 768 and 1440 px | P1 | TIP-13 |
| REQ-R05 | One command builds a verified offline depth release without committing model binaries | P0 | TIP-13 |
| REQ-R06 | GitHub workflow can deploy `dist` to Pages HTTPS and attach a tagged release artifact | P0 | TIP-13 |
| REQ-R07 | Browser E2E proves onboarding, diagnostics, responsive layout, version and offline reload | P0 | TIP-13 |

## EXCLUSIONS

- No remote analytics/telemetry endpoint.
- No backend, authentication or database.
- No full offline RT-DETR/OWL-ViT bundle in this cycle.
- No claim that mock-worker release E2E proves model quality.
- No actual push, tag, GitHub Pages enablement or production DNS mutation without separate authority.
