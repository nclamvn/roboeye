# Verification — TIP-56A technical-frontier audit

**Date:** 2026-09-21
**Runtime changed:** no

## Checks

| Check | Result |
|---|---|
| Source capture inventory | PASS — 26 immutable files from 25 official source entries |
| SHA-256 manifest | PASS — every captured file matches `snapshots.sha256` |
| Deterministic extraction | PASS — 84 claims, 18 entities |
| Declared-universe coverage | PASS — 18/18 (100%) |
| Refinery validation | PASS — 0 gate bites; digest `d84f263f90f9ef72` |
| Adversarial bite suite | PASS — every applicable attack was caught |
| Licence/terms honesty | PASS — commercial ambiguities and non-commercial constraints remain explicit |
| Runtime regression | N/A — research/docs only; no application source changed |

## Reproduction

```bash
node research/technical-frontier/extract.mjs
python3 /Users/os/.codex/skills/refinery/refinery.py research/technical-frontier
python3 /Users/os/.codex/skills/refinery/bites.py research/technical-frontier
(cd research/technical-frontier && shasum -a 256 -c snapshots.sha256)
```

Recapturing sources is intentionally separate because it uses the network and
may produce a new timestamp/hash. The committed snapshots are the evidence
boundary for this audit.
