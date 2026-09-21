# TIP-55B — Provider-neutral connected-event contract

**Status:** ACCEPTED
**Scale:** Medium / contract + offline adapters + commercial RFI
**Owner approval:** explicit implementation request, 2026-09-21

## Intent

Build the provider boundary needed before any paid trial: normalize two
shortlisted incident APIs offline, reject stale or ambiguous data, prove route
relevance and conservative dedup, and expose the missing commercial facts as an
RFI rather than assumptions.

## Safety boundary

- A normalized object is always `advisoryOnly: true`.
- It contains no camera range, local risk, braking or warning command.
- It cannot override local perception or the metric-distance fail-closed path.
- No credentials, live network call or browser-bundled provider key are in this
  TIP.
- Fixture coordinates and incidents are synthetic schema examples, not Vietnam
  coverage evidence.

## Requirements

| ID | Requirement | Acceptance evidence |
|---|---|---|
| REQ-55B-01 | One versioned neutral contract preserves provider ID, geometry, type, severity, validity/freshness, rights and provenance | Type contract plus structural tests |
| REQ-55B-02 | HERE v7 fixture uses stable `originalId`, shape geometry and documented type/criticality mapping | Offline fixture/adapter tests |
| REQ-55B-03 | TomTom fixture uses GeoJSON geometry and documented icon/delay mapping without semantic escalation | Offline fixture/adapter tests |
| REQ-55B-04 | Invalid rows, expired data, future/planned validity, old evidence and unknown values fail closed | Rejection and TTL tests |
| REQ-55B-05 | Route relevance requires bounded spatial distance and compatible direction when both headings exist | Map-match tests |
| REQ-55B-06 | Cross-provider dedup requires matching kind, closure state, time, geometry and non-conflicting road names | Deterministic dedup tests |
| REQ-55B-07 | Vietnam coverage, cost, commercial rights, retention, redistribution and SLA remain honest-null until written proof | RFI JSON/Markdown plus null gate test |
| REQ-55B-08 | Existing local runtime and warning behavior remain unchanged | Full typecheck/unit/build/security gates |

## Contractor / Builder split

- **Contractor:** fixed the advisory-only seam, conservative reject/match/dedup
  policy, evidence boundary and commercial stop fields.
- **Builder:** implemented the neutral TypeScript module, two synthetic offline
  fixtures, unit scenarios and RFI artifacts.
- **Contractor verification:** runs full regression gates and confirms no live
  provider integration or commercial claim was introduced.

## Out of scope

Production connector, secret storage, polling/backoff, UI cues, a Vietnam
coverage claim, legal interpretation, signed SLA, negotiated price and a
provider promotion decision remain TIP-53 inputs.
