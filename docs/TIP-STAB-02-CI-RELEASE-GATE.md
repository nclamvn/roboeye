# TIP-STAB-02 — CI and Release Gate

## Header

- TIP-ID: TIP-STAB-02
- Project: RoboEye / DriveSense
- Module: reproducible browser QA, GitHub CI and release truth
- Depends on: TIP-STAB-01
- Priority: P0
- Date: 2026-09-20

## Context

TIP-STAB-01 recovered a clean local source tree three commits ahead of
`origin/main`. Recent remote CI failed because the accepted dependency-risk
register and recovered source were not tracked. D6/D7 browser tests also depended
on videos in `/Users/os/Downloads` and a manually running port 4192, so a clean
GitHub runner could not execute those contracts.

## Requirements

| ID | Requirement |
|---|---|
| CI-01 | D6/D7 browser tests generate their own non-private video fixture. |
| CI-02 | D6/D7 tests start and stop an isolated Vite dev server because RoadStructure is intentionally local/research-only. |
| CI-03 | Package QA and GitHub CI execute the recovered control tests. |
| CI-04 | Full local QA passes before any push. |
| CI-05 | Push only the verified commits to `origin/main`, without force. |
| CI-06 | Required GitHub CI jobs complete successfully at the pushed SHA. |
| CI-07 | Do not deploy, tag or claim Pages alignment until CI is green. |
| CI-08 | Produce Completion and Verify reports with exact SHA/run evidence. |

## Acceptance criteria

- Given a clean checkout without `/Users/os/Downloads/Test1.mp4`, when the D6/D7
  browser suite runs, then it creates its own video, serves the intentionally
  local/research-only UI on isolated ports and exits without a persistent server.
- Given the recovered source, when `npm run qa` runs, then every included gate
  passes before push.
- Given a verified local branch, when it is pushed normally, then remote `main`
  resolves to the same SHA and GitHub CI succeeds.
- Given CI success, then release/deploy remains a separate explicit action and
  no tag is created in this TIP.

## Constraints

- No force push, history rewrite, tag or GitHub Pages deployment.
- No private video, model cache or local absolute path may enter CI fixtures.
- Do not enable RoadStructure in production merely to make a browser test pass.
- Do not weaken tests to make CI green; fix reproducibility or report the gate.
- Do not change perception/model/risk behavior.
