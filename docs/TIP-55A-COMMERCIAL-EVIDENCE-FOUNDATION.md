# TIP-55A — Commercial evidence foundation

**Status:** ACCEPTED
**Scale:** Medium / documentation-data infrastructure
**Owner approval:** “triển khai ngay”, 2026-09-21

## Intent

Create a reproducible, provenance-first evidence base for technical candidates
and connected traffic/map sources before implementing a commercial connector or
changing the local perception architecture.

## In scope

- Capture official primary sources as immutable local snapshots.
- Extract field-level claims with URL, capture time, source tier and verbatim
  evidence span.
- Keep missing price, coverage, rights or performance fields null.
- Make conflicts visible rather than choosing a convenient value.
- Run deterministic build/audit and adversarial bite tests.
- Record the result in the product task graph.

## Out of scope

- No production provider credentials or paid calls.
- No network call in detector, range, risk or warning paths.
- No model replacement, vehicle installation, hardware purchase or public-road
  claim.
- No claim that source availability equals Vietnam coverage or licence approval.
- No legal conclusion; licence and provider terms still require professional
  review before a commercial release.

## Acceptance criteria

1. At least four technical candidates and five connected-data candidates are
   represented by official-source claims.
2. Every claim has a snapshot and a verbatim evidence span that the machine gate
   can locate.
3. Licence/terms/price/freshness fields reject inferred claims.
4. Both registries build twice to identical canonical bytes and pass the
   independent auditor.
5. The destructive bite suite proves `CAPTURE_MISSING`, `SPAN_NOT_FOUND`,
   `SOURCED_ATTR`, `DISTRIBUTION_NO_DENOMINATOR`, `IDEMPOTENT` and
   `NO_INFERRED` stop the build.
6. The product graph names the next task without promoting connected data into
   the local safety hot path.

## Contractor/Builder split

- **Contractor:** fixed the boundary, evidence schema, source tiers, no-inference
  fields and acceptance gates.
- **Builder:** captured the official pages, authored claim rows, ran the refinery,
  corrected two unsupported spans and removed one unreferenced snapshot that
  weakened the destructive capture test.
- **Contractor verification:** compared the delivered registries with this TIP,
  reran both positive and adversarial suites, and retained all residual blockers.
