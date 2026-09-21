# Verification — TIP-55B

**Verified:** 2026-09-21
**Environment:** local repository; Node.js/TypeScript; no provider credentials

## Requirement coverage

| Requirement | Evidence | Result |
|---|---|---|
| REQ-55B-01 neutral, advisory-only contract | `src/drive/connected-events.ts`; structural test excludes risk/warning/distance fields | PASS |
| REQ-55B-02 HERE fixture/adapter | synthetic fixture; stable ID, shape, type and criticality test | PASS |
| REQ-55B-03 TomTom fixture/adapter | synthetic fixture; GeoJSON, icon and non-escalating delay map test | PASS |
| REQ-55B-04 fail-closed validation/TTL | expired, future, old, invalid-time and invalid-geometry scenarios | PASS |
| REQ-55B-05 route/direction match | near/aligned, far, opposite-heading and invalid-route scenarios | PASS |
| REQ-55B-06 conservative dedup | same-event merge; conflicting road/kind separation; deterministic winner | PASS |
| REQ-55B-07 honest-null RFI | both providers × ten mandatory fields asserted `null` | PASS |
| REQ-55B-08 no regression/live dependency | full codebase gates listed below | PASS |

## Scenario results

- HERE: two valid events normalized; one already-expired row rejected alone.
- TomTom: two valid events normalized; one unsupported Polygon row rejected
  alone.
- One synthetic cross-provider accident is merged; stronger documented
  severity wins and both namespaced source IDs remain auditable.
- Far, opposite-direction, stale, planned/future and malformed evidence cannot
  become route-relevant output.
- The fixtures are explicitly synthetic and cannot support a provider coverage
  or field-quality claim.

## Technical health

| Gate | Result |
|---|---|
| TIP-55B focused unit tests | 11/11 pass |
| Full unit suite | 234/234 pass |
| `npm run typecheck` | pass |
| `npm run build` | pass |
| `npm run security:audit` | pass; 0 critical, 2 pre-existing accepted-risk `sharp` advisories |
| Technical registry + bite suite | digest `34d1d3cc3c223858`; pass |
| Traffic-data registry + bite suite | digest `3ab3a8269644ddeb`; pass |

Provider RFI fields remain blocked, so verification proves the contract and
offline behavior only—not Vietnam coverage, commercial permission, provider SLA
or field recall.

## Contractor verdict

**ACCEPTED for offline contract/RFI scope.** TIP-53 production trial remains
blocked until provider responses and a Vietnam corridor sample are available.
