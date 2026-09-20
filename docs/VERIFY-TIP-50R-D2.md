# VERIFY — TIP-50R-D2 Reviewed RoadStructure benchmark

## Scope

Independent verification of the implemented evidence chain and the first
held-out result. This verifies measurement integrity; it does not certify road
perception quality.

## Matrix

| Check | Result | Evidence |
|---|---:|---|
| Reviewed-only truth conversion | PASS | Both inspectors report `benchmarkReady=true`; draft/self-review remains rejected by unit contracts |
| Exact task/frame binding | PASS | 8/8 raw image hashes and both task hashes validated before inference |
| Pinned model bytes | PASS | Canonical SHA-256 matches TIP-50R-C/D |
| Prediction blindness | PASS | Vectorizer accepts label bytes/shape only; reviewed coordinates are consumed only by the scorer |
| Deterministic output contract | PASS | Closed corpus parser accepts 8 truth and 8 prediction frames |
| Drivable metric emitted | PASS | Aggregate mean IoU `0.5949297093528134` |
| Line/corridor misses retained | PASS | `0/16` matches and corridor recall `0`, not omitted or converted to null success |
| Latency/staleness emitted | PASS | p50 `178.3 ms`, p95 `233.3 ms`, stale rate `0` |
| Diagnostic renders | PASS | 8/8 PNG previews written |
| Product promotion | FAIL-CLOSED | Line and corridor quality fail; E/F stay blocked |

## Adversarial findings

1. AI-assisted labels are not independently hand-drawn expert truth. The report
   exposes that evidence class instead of calling it production ground truth.
2. Eight frames from two related local clips cannot establish field safety,
   geographic robustness or commercial accuracy.
3. Model/training-data commercial rights are not cleared.
4. A zero stale rate on sparse samples is not a realtime throughput claim.
5. Post-hoc threshold changes on this test set would invalidate the held-out
   result; none were made.

## Verdict

TIP-50R-D2 implementation: VERIFIED.

RoadStructure quality/promotion: REJECTED for this candidate revision. The only
valid next step is a separately labelled validation/tuning slice followed by a
new frozen test run.

## Superseding metric note

TIP-50R-D3 proved the D2 line distance was sensitive to polyline sampling
density. D2's original `0/16` remains immutable but is deprecated for line
comparison; the corrected frozen-v1 rescore is `1/16` with the same rejection
outcome. Drivable IoU and latency conclusions are unaffected.
