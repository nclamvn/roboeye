# TIP-07: Handover X-Ray

## HEADER

- TIP-ID: TIP-07
- Project: RoboEye
- Module: Project governance / handover
- Depends on: TIP-01 → TIP-06
- Priority: P0
- Date: 2026-08-06

## CONTEXT

- Working directory: `/Users/os/Downloads/roboeye`
- Canonical branch: `main`
- Historical branch: `archive/roboeye-2`
- Key references: `README.md`, `docs/TIPS.md`, `docs/COMPLETION-REPORTS.md`, `docs/VERIFY.md`, `docs/REGISTRY-NOTES.md`
- Method: Vibecode Kit v6.1, X-Ray Protocol

## TASK

Scan and document the current product so one agent can alternate explicitly between Contractor and Builder roles without losing the trust boundary. Produce a handover document that explains the architecture, runtime flow, build history, requirements traceability, deployment path, technical health, known gaps, and the next strategic decisions.

## SPECIFICATIONS

1. Treat `/Users/os/Downloads/roboeye` as the only canonical working repository.
2. Preserve `archive/roboeye-2` as historical evidence; do not rewrite or merge its overlapping commits.
3. Inspect source, dependencies, tests, docs, Git state, environment inputs, and deploy configuration.
4. Run non-destructive health checks available in the repository.
5. Create `PROJECT_XRAY.md` at repository root.
6. Create a Completion Report for this TIP.
7. Do not implement or redesign product features during this TIP.

## ACCEPTANCE CRITERIA

- Given the canonical repository, when a new maintainer reads `PROJECT_XRAY.md`, then they can understand, run, build, test, extend, and deploy RoboEye.
- Given the Vibecode history, when a feature is inspected, then its TIP/commit/file relationship is traceable where current evidence allows.
- Given the current codebase, when health checks run, then exact pass/fail/untestable results and blocking prerequisites are recorded.
- Given the handover, when Contractor resumes planning, then product gaps and decisions requiring the Homeowner are explicit.

## CONSTRAINTS

- No product code changes.
- No dependency upgrades.
- No GitHub push or deployment.
- No invented requirements; mark missing source evidence as a gap.
- Contractor reviews outputs only after Builder submits the Completion Report.

## REPORT FORMAT

Submit a standard Vibecode Completion Report with files changed, quantitative checks, issues, deviations, and suggestions for the Contractor.
