# COMPLETION REPORT — TIP-47A

**Date:** 2026-09-17
**Builder status:** DONE
**Contractor verdict:** ACCEPTED for validation-corpus intake; NOT READY for field-quality or road-safety claims.

## Outcome

TIP-47A establishes an independent, fail-loud evidence contract for DriveSense. Ground-truth object IDs no longer need to copy the detector/tracker IDs. Truth and predictions are associated one-to-one by bounded timestamp difference and bounding-box overlap, so missed vehicles, roadside false positives, range abstentions and identity switches remain visible in the denominator.

Delivered:

- strict JSON corpus parser for journey-level train/validation/test splits;
- explicit device/camera, image geometry, truth method, source hash, rights/provenance and scenario tags;
- independent truth object IDs and model-owned track IDs;
- timestamp + IoU association with FP/FN accounting;
- range coverage, MAE, bias and P95 absolute error, including `<5`, `5–30`, `30–70` and `≥70 m` buckets;
- explicit rejection of incompatible distance definitions;
- ID-switch, range-abstention and request-to-result latency metrics;
- local-only CLI and a synthetic fixture labelled `synthetic-algorithm-test-only`;
- rejection of unknown fields, duplicate IDs, invalid boxes/numbers, source leakage across splits, absent rights and mixed synthetic/physical corpora.

## Files

- `src/drive/validation.ts`
- `scripts/evaluate-drive-corpus.ts`
- `tests/fixtures/drive-validation-synthetic.json`
- `tests/unit/drive-validation.test.ts`
- `package.json`
- `docs/TIP-47-VALIDATION-CORPUS.md`

Run locally:

```bash
npm run benchmark:drive-corpus -- tests/fixtures/drive-validation-synthetic.json
```

## Verification evidence

| Gate | Result |
|---|---|
| TIP-47 unit scenarios | PASS — 6/6 |
| Full unit suite | PASS — 163/163, 0 fail |
| Targeted strict TypeScript check | PASS |
| Full TypeScript check | PASS |
| Production build | PASS — Vite build completed in 1m39s |
| Security baseline | PASS — 0 critical/high; no dependency changed in TIP-47A |
| Diff hygiene | PASS — `git diff --check` |

The synthetic fixture deliberately produces precision 0.75, recall 0.75, range coverage 0.50, MAE 1 m, bias 0 m, one false positive, one false negative and one ID switch. These values verify scorer behavior only. They are not evidence of detector, range or warning quality.

## Acceptance coverage

- Independent truth IDs matched without trusting model track IDs: PASS.
- One missed truth and one roadside false positive included in denominators: PASS.
- Unknown or incompatible distance kinds cannot invent metre errors: PASS.
- One model ID switch for a continuing real object counted once: PASS.
- Duplicate journey/source leakage/invalid coordinate/NaN/missing rights rejected: PASS.
- Synthetic CLI result deterministic and clearly labelled non-field evidence: PASS.
- Existing dirty RoboHand work preserved and excluded from this TIP: PASS.

## Contractor verification

The implementation matches the bounded TIP and does not alter DriveSense HUD, detector, risk thresholds or vehicle-facing behavior. The parser is intentionally closed-schema: this prevents raw video bytes, local paths or arbitrary personal fields from silently entering the evidence manifest. Metrics use honest nulls when no truth or measurement exists.

One metric is deliberately named `requestToResultP95Ms`. It is model-request latency, not capture-to-visible-alert latency. End-to-end live latency remains a separate P0 requirement and must not be inferred from this number.

## Known limits and next gate

1. There is still no physical synchronized ground-truth journey in the repository.
2. Source hashes prevent the same file crossing splits, but a real acquisition policy must also enforce route/session/device holdouts before model selection.
3. Box matching uses a fixed 80 ms / 0.5 IoU contract; any future threshold change must be versioned before seeing held-out results.
4. Camera-live still lacks learned metric range and capture-to-alert instrumentation.

**Next gate:** TIP-47B must define and acquire the first controlled field corpus with independently measured distances and locked split policy. In parallel, TIP-48 should instrument the live camera hot path from capture through inference/risk to rendered/audio alert. Neither task authorizes public-road deployment.

## Overall verdict

TIP-47A is production-quality evidence infrastructure for the current phase. DriveSense now has a defensible way to say “unknown,” count misses and compare challengers on the same corpus. The product itself remains a controlled PoC until real field truth and live latency pass their separate gates.
