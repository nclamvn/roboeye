# RoboEye repository inventory — 2026-09-20

## Source of truth

- Canonical working repository:
  `/Users/os/Documents/Codex/2026-08-05/new-chat/roboeye-live`
- Branch and baseline: `main` at `8a3c683`; this matched `origin/main` when the
  inventory began.
- Former `/Users/os/Downloads/roboeye` and `roboeye 2` paths do not exist.

## Baseline counts before recovery

- Modified tracked files: 24, 898 insertions and 307 deletions.
- Untracked files: 213, approximately 3.9 MiB and 37,316 lines.
- Untracked distribution: docs 156, tests 23, source 16, scripts 13, tools 3,
  requirements 1 and non-source session artifact 1.

## Disposition

| Area | Disposition | Reason |
|---|---|---|
| DriveSense range/runtime source and tests | Preserve as product source | Imported by current app/tests; local PoC behavior depends on it. |
| RoadStructure source, workers, scripts and tests | Preserve as experimental source | Required by D1–D7 and explicitly gated as non-promotable research. |
| RoboHand precision source and tests | Preserve as product source | Imported by current runtime and deterministic tests. |
| TIP, Completion, Verify, PRD/RRI/Blueprint/task graph docs | Preserve as audit trail | Required to reconstruct scope, decisions and gates. |
| Research registry and captured source snapshots | Preserve as provenance evidence | Small, hash/audit-backed evidence; no model weights or private video. |
| Local model/cache/output directories | Keep ignored | Reproducible or machine-local binaries; not source. |
| `:memory:.ses` | Quarantine outside repository | 51-byte tool session token, not product source. |
| `src/drive/road-vectorizer 2.ts` | Quarantine outside repository | Older copy; superseded by imported, tested `road-vectorizer.ts`. |

## Safety checks

- Secret-pattern scan found no credential/private-key material in the recovered
  product/research tree. Matches were ordinary local variable names and GitHub
  workflow permission syntax.
- No untracked model weights or private videos are admitted. Existing cache
  directories remain ignored.
- The canonical vectorizer is referenced by runtime/tests; the numbered copy is
  referenced nowhere and lacks the current v2 continuity implementation.

## Deferred to TIP-STAB-02

- Push and GitHub CI recovery.
- Full browser/model/release QA beyond mandatory local recovery gates.
- Version/tag alignment and GitHub Pages deployment.
