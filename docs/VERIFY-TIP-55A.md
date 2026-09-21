# Verification — TIP-55A

**Verified:** 2026-09-21
**Environment:** local repository; Python 3; Refinery skill engine

## Positive controls

| Domain | Entities | Claims | Build digest | Result |
|---|---:|---:|---|---|
| Technical solutions | 4 | 18 | `34d1d3cc3c223858` | idempotent + auditor pass |
| Traffic data sources | 5 | 18 | `3ab3a8269644ddeb` | idempotent + auditor pass |

Both builds reported `VALIDATION PASSED · 0 gate bites`.

## Adversarial controls

For both domains the following injected failures stopped the build as intended:

- missing source snapshot;
- fabricated evidence span;
- invalid source tier;
- hidden roll-up denominator;
- deliberately non-deterministic build;
- inference placed into a field where inference is forbidden.

Domain gates not declared for this data shape (Chinese-origin text, incident
blame/severity, geographical stratum and required market-claim fields) correctly
reported N/A rather than a false pass.

## Traceability

- Registry contract and rebuild commands:
  `research/commercial-intelligence/README.md`
- Technical schema/claims/snapshots:
  `research/commercial-intelligence/domains/technical_solutions/`
- Traffic-data schema/claims/snapshots:
  `research/commercial-intelligence/domains/traffic_data_sources/`

## Codebase regression gates

| Gate | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run test:unit` | 223/223 pass |
| `npm run build` | pass |
| `npm run security:audit` | pass; 0 critical, 2 pre-existing accepted-risk `sharp` advisories with review deadlines |

The two accepted-risk advisories are not introduced by TIP-55A, and the browser
source/bundle exposure check remains zero.

## Verification boundary

This proves capture integrity, deterministic reconciliation and honest nulls. It
does not prove runtime latency, field accuracy, Vietnam coverage, a supplier SLA,
or permission to redistribute provider data in a commercial product.
