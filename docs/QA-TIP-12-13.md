# QA REPORT — TIP-12/13 Production and Release 1.2

Date: 06/08/2026 | Environment: macOS, Playwright Chromium, local static preview

## SUMMARY

| Tier | Passed | Failed | Deferred external | Status |
|---|---:|---:|---:|---|
| Tier 1: requirements and core flows | 14 REQ | 0 | 0 | PASS |
| Tier 2: recovery/responsive/offline | 20 browser checks | 0 | 0 | PASS |
| Tier 3: security/release/real model | 15 unit + 13 detection + 14 smoke | 0 | 1 activation | PASS locally |

Requirement coverage: **14/14 = 100%**. TIP acceptance rate: **14/14 = 100%**.

## EXECUTED GATES

- TypeScript strict: PASS, 0 errors.
- Unit: PASS, 15/15.
- Dependency security: PASS under TIP-09 time-limited accepted risk; 0 critical, 2 accepted high, browser exposure 0.
- Production build: PASS, 22 modules transformed.
- Detection contract E2E: PASS, 13/13; mock workers, not model quality evidence.
- Release contract E2E: PASS, 20/20; includes deliberate depth-load failure/retry.
- Responsive: PASS at 375×667, 768×1024, 1440×900; no horizontal overflow.
- Offline shell: PASS; hashed JS/CSS present in version cache, cached fetch works, new controlled tab opens after preview server stops.
- Normal release verifier: PASS, 5/5 policy checks.
- Offline release verifier: PASS, 9/9 including three pinned fixture sizes and offline flag.
- Sub-path build `/roboeye/`: PASS.
- Real depth q8 smoke: PASS, 14/14; actual Transformers.js/ONNX WASM inference, fake webcam only.
- JSON and workflow YAML parse: PASS.

## VISUAL REVIEW

- Boot hero is a product thesis (“Từ camera đến không gian”), not a generic dashboard heading.
- Four numbered stops encode the real pipeline and continue as the guided tour.
- HIVE carbon/white palette, Noto Serif/Inter/mono roles and one signature rail are preserved.
- `?demo=1` changes action hierarchy without changing product behavior.
- Mobile collapses technical controls behind an explicit accessible button while keeping modes and safety actions reachable.
- Reduced-motion mode collapses transitions.

## SECURITY AND PRIVACY

- No remote analytics SDK or endpoint added.
- Diagnostics exclude frame buffers, labels and query text; storage is bounded and export is user-triggered.
- Service worker only intercepts same-origin GET requests.
- CSP allows approved Hugging Face model hosts and same-origin workers/WASM.
- Response-only headers depend on host support; GitHub Pages retains HTML CSP but cannot apply repository `_headers`.

## DEFERRED EXTERNAL ACTIVATION

- GitHub Actions/Pages/GitHub Release cannot be observed until commits are pushed and Pages is enabled. Local workflow syntax, base-path build, release archive inputs and all invoked commands were verified.

## OVERALL STATUS

**APPROVED locally / READY-with-external-activation.** No code/test blocker remains.
