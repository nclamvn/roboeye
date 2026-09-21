# TIP-55B — Provider RFI matrix

**Decision state:** BLOCKED pending written responses.
**Shortlist:** HERE Traffic API v7 and TomTom Traffic API.
**Use boundary:** connected incidents are route advice only. They cannot set
local collision risk, override camera distance, or enter the no-network safety
hot path.

`UNVERIFIED` means the current official material does not prove the exact answer
needed for a Vietnam commercial deployment. It is a deliberate stop state, not
a negative score.

## Evidence-backed interface baseline

| Area | HERE | TomTom | Engineering consequence |
|---|---|---|---|
| Incident object | Official v7 docs describe `location` plus `incidentDetails` | Official Incident Details v5 docs describe GeoJSON-like `geometry` plus `properties` | Two offline adapters normalize into one contract |
| Stable identity | `originalId` is documented stable across an update chain | `properties.id` is the documented incident ID | Provider IDs stay namespaced; cross-provider dedup never trusts equal IDs |
| Geometry | Request `locationReferencing=shape` for shape points | `Point` or `LineString` coordinates | No geometry means no route match and no advisory |
| Type/severity | Documented type and criticality enumerations | Documented icon category and magnitude-of-delay enumerations | Unknown/future values map to `other`/`unknown`; TomTom “moderate” is not escalated to “major” |
| Freshness signals | `sourceUpdated`, `startTime`, `endTime`, `entryTime` | Traffic Model ID, `startTime`, `endTime`, optional `lastReportTime` | Product TTL and maximum evidence age remain explicit caller policy, not invented provider SLA |
| Version issue | v7 is the inspected interface | v5 page recommends Orbis for new integrations | RFI must name the contracted production endpoint and migration obligation |

Primary technical references:

- HERE: <https://docs.here.com/traffic-api/docs/incidents-here-traffic-api-v7-concepts>
- HERE request/response example: <https://docs.here.com/traffic-api/docs/how-to-request-incident-data>
- TomTom v5: <https://docs.tomtom.com/traffic-api/documentation/tomtom-maps/v1/traffic-incidents/incident-details>
- TomTom Orbis v2: <https://docs.tomtom.com/traffic-api/documentation/tomtom-orbis-maps/v2/traffic-incidents/incident-details>

## Commercial RFI

| Mandatory question / evidence requested | HERE current state | TomTom current state | Trial gate |
|---|---|---|---|
| Exact Vietnam traffic-incident coverage by road class and province; supply machine-readable road/corridor sample for the proposed pilot route | **UNVERIFIED** | **UNVERIFIED** | At least one agreed pilot corridor with incident categories and known gaps disclosed in writing |
| Historical measured event recall, false event rate and provider update latency on that route | **UNVERIFIED** | **UNVERIFIED** | Provider sample can be replayed against the same timestamped route corpus; no marketing-only answer |
| Price per 1,000 requests/event, monthly minimum, overage, sandbox quota, currency/tax and vehicle/fleet tier | **UNVERIFIED** | **UNVERIFIED** | Written quote and a reproducible cost-per-active-vehicle model at agreed polling policy |
| Right to use data in a commercial in-vehicle advisory and derive short user-facing cues | **UNVERIFIED** | **UNVERIFIED** | Explicit written permission or contract clause; legal owner named |
| Permitted cache/retention duration for raw events, normalized events, hashes and audit logs | **UNVERIFIED** | **UNVERIFIED** | Retention schedule maps every stored field to a clause; otherwise ephemeral-only |
| Redistribution, screenshot/demo, customer report and attribution obligations | **UNVERIFIED** | **UNVERIFIED** | Approved attribution UI/report text and prohibited uses recorded |
| Production uptime SLA, latency/freshness commitment, maintenance notice and service credits | **UNVERIFIED** | **UNVERIFIED** | Signed SLA plus degraded/offline behavior exercised; outage can only remove advice |
| Support hours, severity definitions and escalation response time for Vietnam | **UNVERIFIED** | **UNVERIFIED** | Named escalation channel and P1 response target |
| Processing region, subprocessors, telemetry/personal-data treatment and deletion path | **UNVERIFIED** | **UNVERIFIED** | Privacy/security review and data-flow record accepted |
| Contracted production API/version, deprecation notice and migration support | **UNVERIFIED** | **UNVERIFIED** | Version frozen for trial; TomTom response must resolve v5 vs Orbis |

## RFI response package

Each provider should return:

1. signed or attributable written answers to every mandatory row;
2. a bounded Vietnam pilot-route sample with timestamps, geometry, IDs and
   known category/coverage exclusions;
3. sandbox credentials separated from production credentials;
4. rate-limit and failure-code documentation;
5. contract/SLA/price exhibits referenced by version and date.

Scoring does not start while any mandatory commercial field is `UNVERIFIED`.
After responses, both providers must run through the same offline replay,
map-match, TTL, dedup, outage and cost workload. A technically richer feed does
not pass if its rights or total cost are indeterminate.
