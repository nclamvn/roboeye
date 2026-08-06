# TIP-09: Dependency Security Review

## HEADER

- TIP-ID: TIP-09
- Project: RoboEye Edge Perception Studio
- Module: Supply-chain security
- Depends on: TIP-08
- Priority: P0
- Date: 06/08/2026

## CONTEXT

- `npm audit` reports GHSA-f88m-g3jw-g9cj through `@huggingface/transformers → sharp 0.34.5`.
- The advisory affects sharp `<0.35.0` when processing untrusted input.
- Current Transformers.js 3.8.1 and registry-latest 4.2.0 both constrain sharp to 0.34.x.
- Sharp 0.35.x changes the supported Node floor and is outside the upstream dependency range.
- RoboEye deploys a browser-only static bundle via the package's conditional web export.

## REQUIREMENTS

| REQ-ID | Requirement | Priority |
|---|---|---|
| REQ-S01 | Record advisory facts, exploit precondition and deployed exposure with primary sources | P0 |
| REQ-S02 | Do not apply an unsupported sharp override or ML-stack major upgrade | P0 |
| REQ-S03 | Add an automated gate that fails unexpected high/critical advisories | P0 |
| REQ-S04 | An accepted advisory must be explicit, package-bound and time-limited | P0 |
| REQ-S05 | Gate must fail if sharp/libvips/native signals enter the browser bundle or app source | P0 |
| REQ-S06 | Existing typecheck, unit tests and production build remain green | P0 |

## TASK

Document and automate a bounded risk acceptance for GHSA-f88m-g3jw-g9cj while the upstream browser ML dependency has no supported patched resolution.

## ACCEPTANCE CRITERIA

- Given the current lockfile, when the security gate runs after build, then it reports only the known accepted advisory and exits successfully with an expiry date.
- Given any other high/critical advisory, when the gate runs, then it exits non-zero.
- Given a sharp/libvips/native marker in deployed JS or application source, when the gate runs, then it exits non-zero.
- Given the acceptance expiry passes while the advisory remains, when the gate runs, then it exits non-zero.
- Given normal product gates, when typecheck, unit tests and production build run, then all pass unchanged.

## CONSTRAINTS

- No `npm audit fix --force`.
- No unsupported `overrides` entry.
- No Transformers.js major upgrade in this TIP.
- Do not describe an accepted risk as “fixed”.
- Cite the GitHub reviewed advisory and official package/repository evidence.

## REPORT FORMAT

Submit Completion and Verify Reports with exact advisory count, exposure evidence, accepted-risk expiry and regression results.
