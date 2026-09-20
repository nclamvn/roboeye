# TIP-STAB-01 — Source of Truth and Repository Recovery

## Header

- TIP-ID: TIP-STAB-01
- Project: RoboEye / DriveSense
- Module: repository, documentation and release hygiene
- Depends on: current local DriveSense/RoadStructure/RoboHand work
- Priority: P0
- Date: 2026-09-20

## Context

The current application builds and passes its unit suite, but the complete local
product is not reproducible from `origin/main`: 24 tracked files are modified and
213 files are untracked. GitHub Pages serves an older commit, recent CI is red,
and historical handover documentation names repositories that no longer exist.

## Requirements

| ID | Requirement |
|---|---|
| STAB-01 | Declare exactly one existing canonical repository. |
| STAB-02 | Inventory every modified/untracked path by product area and disposition. |
| STAB-03 | Preserve valid source, tests, research provenance and TIP artifacts. |
| STAB-04 | Quarantine obvious non-source/duplicate artifacts without destructive deletion. |
| STAB-05 | Restore D6/D7 index, TIP and task-graph traceability. |
| STAB-06 | Make no product behavior, model, metric or architecture change. |
| STAB-07 | Pass diff hygiene, unit, typecheck, build and security gates. |
| STAB-08 | Produce Completion and Verify reports with explicit deferred CI/release work. |
| STAB-09 | Partition recovered work into reviewable local commits and finish with a clean worktree. |

## Acceptance criteria

- Given a new maintainer, when they read `PROJECT_XRAY.md`, then the canonical
  path exists and former paths are clearly historical.
- Given the dirty baseline, when the inventory is reviewed, then all 24 modified
  files and all 213 initially untracked files have a documented disposition.
- Given the session artifact and duplicate vectorizer copy, when cleanup runs,
  then they leave the repository but remain recoverable outside it.
- Given TIP-50R-D6/D7, when the TIP index and task graph are inspected, then both
  changes have an explicit scope and status.
- Given the recovered source tree, when mandatory local gates run, then unit,
  typecheck, build, security audit and diff hygiene pass.
- Given valid recovered work from multiple product areas, when recovery closes,
  then it is partitioned by concern and no modified/untracked path remains.

## Constraints

- Do not reset, overwrite or discard pre-existing user work.
- Do not rewrite Git history, push, deploy or tag in this TIP.
- Do not alter runtime behavior; any code defect discovered becomes a separate TIP.
- Do not promote RoadStructure, absolute range or lane departure to field-ready.

## Decisions

- SCAN/RRI/Vision are condensed because the immediately preceding repository
  scan supplied the evidence and the user approved the ordered stabilization
  plan. This decision changes no product architecture.
- CI repair and release remain TIP-STAB-02 so repository recovery can be
  independently verified before any external mutation.
