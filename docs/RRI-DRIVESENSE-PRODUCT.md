# RRI REPORT — DriveSense product phase

Date: 2026-09-17. This is a risk-prioritized reverse interview condensed from the user's stated direction and current codebase. Auto-answered facts are not asked again; unresolved business/safety choices remain explicit. No answer is invented for a partner.

## Requirements matrix

| ID | Requirement | Source/persona | Priority |
|---|---|---|---|
| DS-01 | Provide local, bounded-age forward vehicle perception and distance/risk evidence on a moving vehicle | User + driver | P0 |
| DS-02 | Benchmark actual capture-to-alert latency, sustained operation and fallbacks on designated hardware | User + operator | P0 |
| DS-03 | Publish metric distance only within a measured operating domain; abstain on weak, stale or incompatible evidence | Existing blueprint + QA | P0 |
| DS-04 | Use independent, journey/device-split ground truth and report detection, range and alert errors including misses | TIP-46 gap + QA | P0 |
| DS-05 | Keep high-priority local warning independent of network/API availability | User + driver | P0 |
| DS-06 | Ingest only contractually usable route-relevant traffic/road data with provenance, direction, freshness and expiry | User + legal/operator | P1 |
| DS-07 | Make warnings short, distinguishable and non-distracting; allow audit after the drive | Prior user feedback + driver | P0 |
| DS-08 | Minimize personal location/video retention; control access, export and deletion | Privacy law + operator | P0 before pilot |
| DS-09 | Measure cost per vehicle, per active hour and per data API; prevent uncontrolled billing | User + business | P1 |
| DS-10 | Keep model/license and source selection traceable; compare challengers on the same held-out corpus/hardware | User's AI-method goal + developer | P0 |

## Auto-answered from scan and conversation

- Initial market/road context: Vietnam, highway driving, camera-first, retrofit-friendly.
- Existing experience: browser DriveSense PoC and report UI; inference is local. Browser remains useful for replay/QA, not yet qualified as vehicle realtime runtime.
- Existing model baseline: RT-DETRv2 R18 and DA2 Metric Outdoor; neither is an accuracy winner without field evaluation.
- Current safety boundary: advisory/shadow mode only; no brake/steer control.
- User prioritizes low latency, reliability, modest cost, and visibly rigorous AI-enabled research/build method.

## Decisions log

| Decision | Options | Provisional choice | Reason/status |
|---|---|---|---|
| D-01 | Add connected features first / prove core first | Prove local perception and benchmark first | A remote incident feed cannot repair an unverified metre or delayed alert. Within previously approved PoC blueprint. |
| D-02 | Browser-only in car / edge runtime + browser UI | Benchmark both; target local edge for pilot | Keep reusable TS contracts/UI; do not promise browser deadline or Jetson kit as production hardware. **Commercial architecture awaits approval.** |
| D-03 | Cloud inference / local inference | Local hot path | Must still operate without network and bound latency/privacy. |
| D-04 | Show every number / abstain | Abstain outside measured domain | Avoid false precision and retain failure evidence. |
| D-05 | Live enforcement checkpoint feed / verified road-safety data | Exclude live checkpoint locations from MVP | Rights, accuracy and product-purpose unresolved; verified fixed camera/speed restrictions remain candidates. |
| D-06 | Full RRI questionnaire now / context-derived focused RRI | Focused RRI | Prior conversation answers many questions; do not block the evidence-only first build slice. |

## Open questions and owner

| ID | Question | Owner | Blocks |
|---|---|---|---|
| OQ-01 | First paying buyer: fleet operator, road operator, dashcam OEM or insurer? | Homeowner/business | Commercial packaging and pricing, not TIP-47 |
| OQ-02 | First designated camera, mount, compute module and speed/GNSS source? | Homeowner + engineering | Live hardware qualification |
| OQ-03 | Access to legally collected trips and independent static/dynamic truth, including data rights? | Homeowner + test lead | Field accuracy claims |
| OQ-04 | What exact warning event thresholds/acceptable false and missed-alert rates will the safety case use? | Safety lead + partner | Road-facing alert pilot |
| OQ-05 | Which provider contracts allow in-vehicle display, aggregation, retention and onward distribution? | Legal + data owner | Connected features |
| OQ-06 | Which partner routes/geographies and what data uptime/freshness SLA? | Business + data owner | Traffic rollout |

Blueprint approval is required before implementation of the new commercial topology. The narrower validation slice follows the already-approved DriveSense PoC blueprint.
