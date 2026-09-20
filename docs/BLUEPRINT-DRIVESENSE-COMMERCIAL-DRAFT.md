# BLUEPRINT — DriveSense commercial architecture (DRAFT)

Date: 2026-09-17. **Not approved.** The earlier [DriveSense PoC blueprint](BLUEPRINT-DRIVESENSE.md) remains approved for replay/benchmark work. This document describes a materially expanded vehicle and connected-data architecture; no production integration is authorized by the prior approval.

## Vision

Single-camera road-awareness assistant, local-first, advisory-only. Initial B2B pilot on selected Vietnamese highways. Optimize for bounded camera-to-alert age, measured distance/alert quality, low cognitive load and cost per vehicle—not an impressive but unverified live box.

## Architecture / contracts

```text
Vehicle camera ── frame clock ── edge detector/road/metric candidates ── tracker ── risk policy ── audible/visual alert
       │                 │                            │                  │
       └── local bounded evidence recorder ───────────┴──────────────────┘
GNSS/speed ───── timestamp/extrinsics ──────────────────────────────┘

Provider APIs + contracted road-operator feeds
       └── rights/provenance gate ── normalize/dedup/TTL ── road+direction match ── route advisory
                                                                        │
                                                                    alert arbiter
                                                                        │
                                                    short driver cue + post-trip audit
```

- Hot-path output: `captureTs`, `resultTs`, `alertTs`, device/profile/model IDs, target ID, coordinate frame and distance kind, value-or-null, evidence age, risk reason, health state. Sensor capture timestamp must survive workers and UI; interpolated boxes cannot create newer measurement timestamps.
- Connected event: provider/license scope, event/road segment/heading/lane, observation and receipt times, expiry, severity, confidence, attribution and allowed retention. Source adapters cannot silently populate the safety hot path.
- A single arbiter rate-limits and ranks alerts; local urgent risk has priority. No unverified event can force a critical local-collision state.
- Edge and cloud provider identities/config/keys are separated. No unrestricted API key in public browser bundle.

## Reuse vs new build

Reuse: strict TS geometry/tracking/risk contracts, DriveSense replay/UI, model prep/tests, report provenance. Build: independent GT corpus, true end-to-end telemetry, edge capture/inference runtime, speed/GNSS clock, device health, licensed data ingestion, privacy/cost controls. Do not treat Vite/GitHub Pages as an in-car realtime backend.

## UI direction

One full camera field, one priority cue, fixed metre or “chưa đo”; short audio. Connectivity and camera health are small but unmistakable. Setup/analysis/post-trip dashboards are separate from the driving view. No expanding text wall while driving.

## Task graph and dependency gates

```text
TIP-47 corpus/scorer → real GT → TIP-48 live timestamp and hardware bake-off
                            └── TIP-49 range calibration/uncertainty → TIP-50 road relevance + shadow warning events
Rights registry/contract ─── TIP-51 provider adapters + route QA ───────┘
TIP-48..51 + safety/privacy review → TIP-52 edge package + controlled pilot → TIP-53 commercial release audit
```

TIP-47A (contract/scorer) is within the **already-approved PoC benchmark direction** and may start now. TIP-48 through TIP-53 are architectural previews; owner/partner choices and this blueprint need homeowner approval before code affecting vehicle installation, connected services or commercial claims.

## Decisions required at blueprint checkpoint

1. Confirm B2B fleet/operator as first buyer versus direct consumer.
2. Confirm first pilot device/camera/speed source and whether a native edge runtime is acceptable.
3. Confirm pilot routes and data-rights owner/partner.
4. Confirm that advisory-only/shadow-first remains the release policy.

Approval of this blueprint permits engineering to begin the commercial architecture. It does **not** waive later field, legal, safety or release gates.
