# TIP-62G — Commit, push and exact-commit HTTPS deployment

2026-10-08 · Vibecode Kit v6.2 · User explicitly requested commit, push and deploy.
Small release task: scan → scoped pack → commit/push → build → verify.
No new architecture or feature-approval checkpoint: no inference implementation
change is included beyond already verified TIP-61/62 work.

## Requirements

- **G-01:** Commit the existing DriveSense recovery/hardening source, tests,
  curated research and scoped QA evidence. Preserve all existing user changes.
  Exclude secrets, model/cache bytes, owner videos and raw upstream capture cache.
- **G-02:** Push the current `codex/tip61-mobile-reliability` branch to the verified
  `nclamvn/roboeye` origin, non-force. Do not merge/change `main` or create a PR
  without a request. Verify remote branch SHA equals local release HEAD.
- **G-03:** Build the existing Vercel project after commit. Recheck typecheck,
  units, build/security, release integrity and source-lifecycle regressions;
  preserve and explicitly scope earlier full QA with unchanged runtime inputs.
  Release metadata must identify the committed revision, not the older dirty
  baseline. No model pin/precision/freshness change.
- **G-04:** Deploy existing canonical HTTPS and verify the alias/deployment,
  release identity, exact worker/model bytes, phone-sized UI and compiled source
  lifecycle. Save a receipt and retain the earlier deployment for rollback.

## Acceptance / limits

Given passed software QA, when the commit is pushed and prebuilt is published,
then remote SHA, built commit, inspected alias and HTTP release match; tests do
not publish owner images or advertise physical phone/metric accuracy acceptance.

Completion/Verify receipt is stored outside the Git checkout in the release
handoff directory (or ignored `.vercel/release-evidence`), so recording the final
commit/deployment does not create a self-referential second release commit.
Historical TIP-61/62 reports remain immutable evidence of their earlier runs.
Physical iPhone/Xiaomi and independent road-distance accuracy remain unaccepted.
