# COMPLETION REPORT — TIP-50R-B

**STATUS:** DONE
**Contractor verdict:** ACCEPTED as benchmark infrastructure; NOT field evidence.

## FILES CHANGED

- Created `src/drive/road-benchmark.ts`: closed-schema parser and deterministic scorer.
- Created `scripts/evaluate-road-corpus.ts` and package command `benchmark:road`.
- Created `tests/fixtures/road-structure-synthetic.json` and road benchmark tests.

## TEST RESULTS

- TIP-specific scenarios: 3/3 PASS.
- Synthetic CLI: PASS and labelled `synthetic-algorithm-test-only`.
- Expected synthetic proof: 6 truth lines, 6 predictions, 5 matches, F1 `0.8333`, ego-corridor recall `0.5`, stale rate `0.5`, drivable IoU `1.0`.
- Full unit suite: 182/182 PASS.
- Build/security/diff hygiene: PASS.

## REQUIREMENT COVERAGE

- Independent IDs and geometry/time matching: PASS.
- Lane vs curb/median/barrier/guardrail class separation: PASS.
- Miss/false-positive denominators: PASS.
- Drivable IoU, pixel line error, ego-corridor recall, temporal jitter, latency and stale evidence: PASS.
- Rights/source hash/split/closed schema: PASS.

## LIMITS

- Polygon IoU uses a deterministic 64×36 evaluation grid; the contract must be versioned before changing resolution.
- Temporal jitter currently measures matched ego-boundary residuals. A production model will also need topology/ID continuity and curve-aware tracking.
- There is no annotated Vietnamese field clip yet; synthetic scores test the scorer, not a model.
