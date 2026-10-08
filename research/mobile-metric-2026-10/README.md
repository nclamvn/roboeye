# TIP-61R — Mobile metric research, October 2026

Public-source registry only. Owner JSON/device evidence is separately analysed
in `docs/evidence/tip61r/owner-session-audit.json`, never laundered into web facts.
This is research; no deployed algorithm/model/runtime has been changed.

Frozen shortlist: **12** entities (not total market), **53** source-backed claims,
**27** raw snapshots. Capture URLs/time/final URL/bytes/SHA are in `captures.json`.
Claims have literal spans and extraction/tier; auditor re-derives registry and
idempotence. Vendor papers/FPS are not DriveSense results; code licences are not
automatically weights/data rights. Empty fields are deliberately honest-null.

An upstream README marks Safari/iOS WebGPU unsupported while a 2026 design doc
says it ships. Both are retained as **disputed**. The owner session separately
shows actual WebGPU inference; this does not validate all iOS/models/runtimes.
The JSEP issue is a first-hand report (tier B), not a causal explanation for the
owner's no-worker-error session. Latest native WebGPU/asyncify also needs a soak
check; a version upgrade is not a promised fix.

Reproduce from frozen evidence:

Raw upstream snapshots are a local research cache and are excluded from Git
publication. The curated registry, claims, source URLs and capture fingerprints
remain versioned. The commands below require the matching local snapshots and
refinery installation; a fresh clone does not contain frozen capture bytes.
Recapturing today's upstream URLs may differ from recorded hashes and does not
reproduce the historical verification. Never publish a raw capture merely
because its page was publicly readable; review redistribution rights separately.

```sh
node research/mobile-metric-2026-10/extract.mjs
node research/mobile-metric-2026-10/verify.mjs
python3 /Users/os/.codex/skills/refinery/refinery.py research/mobile-metric-2026-10
python3 /Users/os/.codex/skills/refinery/bites.py research/mobile-metric-2026-10
```

`capture.mjs` touches the network; passing IDs recaptures only those IDs. Never
execute fetched code. A failed request stays missing, not a invented field.
403 OpenCV generated docs were replaced by permitted public upstream Markdown;
no access control bypass. Snapshot naming preserves HTML when appropriate.
Scaffold follows the skill template via apply_patch because `new_domain.py`
writes into the skill installation rather than the project research folder.

Six applicable negative gates bite: capture missing, span missing, invalid tier,
missing denominator, nondeterminism and forbidden inference. Eight other gates
are N/A by domain policy; not misreported as fourteen exercised gates.

`device_benchmark` remains null for all 12 entities: exact candidate artifact /
DriveSense graph / combined workload / physical iPhone has not been benchmarked
in this registry. The actual baseline session is available separately, not an
accuracy ground truth or candidate comparison.
