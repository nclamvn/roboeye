# SCAN delta — DriveSense commercial evidence foundation

**Date:** 2026-09-21
**Scope:** changes since `SCAN-DRIVESENSE-PRODUCT-2026-09-17.md`
**Method:** repository evidence + primary-source capture; no product claim inferred

## Executive finding

The local perception PoC is substantially ahead of the commercial evidence
layer. The repository already has deterministic tests, uploaded-video profiling,
camera acceptance instrumentation and fail-closed distance semantics, but it did
not have one auditable place to answer two product questions:

1. Which detector/depth/runtime candidates are legally and technically eligible
   for a commercial bake-off?
2. Which connected traffic/map sources can be evaluated without putting a
   network dependency in the safety-critical perception path?

TIP-55A closes that documentation/data gap. It does **not** close physical range
accuracy, real-camera latency, provider contract, legal review or public-road
release gates.

## Current truth retained

- Local-first perception remains the architectural invariant. Vehicle detection,
  geometry, risk state and the minimal HUD must keep working when every external
  data service is unavailable.
- TIP-49L-D still requires a real laptop/phone-camera report. Passing unit tests
  is not a substitute for this evidence.
- TIP-47B physical truth and the hardware/model bake-off remain deferred by the
  product owner. A source registry does not reopen purchasing or vehicle setup.
- Connected traffic data may enrich route awareness later, but cannot directly
  manufacture a collision warning or overwrite a local measurement.

## New evidence assets

| Registry | Shortlist | Captured claims | Primary-source only | Honest-null preserved |
|---|---:|---:|---:|---:|
| Technical solutions | 4 | 18 | yes | yes |
| Traffic/data sources | 5 | 18 | yes | yes |

The 100% coverage emitted by the refinery is coverage of these two explicit
shortlists only. It is not a market-completeness claim.

## Decision-relevant findings

- The licence boundary is model-specific, not project-name-specific. The
  captured Depth Anything V2 source gives Apache-2.0 to the Small model while
  naming CC-BY-NC-4.0 for Base/Large/Giant. Candidate promotion must therefore
  pin the exact checkpoint and its terms.
- ONNX Runtime Web remains a credible local browser runtime because its official
  documentation explicitly covers browser JavaScript inference and WebGPU,
  WebGL, WebNN and WebAssembly paths. This is eligibility evidence, not a latency
  result for the DriveSense graph.
- Google, HERE and TomTom expose different traffic/routing products. They are not
  interchangeable until a common event contract, Vietnam coverage probe, quota,
  pricing, retention and redistribution review are complete.
- Waze for Cities is an authority partner programme, not an unrestricted retail
  API. It belongs in a partnership track rather than the default customer app
  dependency list.
- OpenStreetMap is an appropriate base-map candidate with explicit attribution
  and share-alike obligations; it is not a real-time incident feed.

## Residual risks and next gate

The highest-value next bounded task is TIP-55B: define a provider-neutral
connected-event contract, build offline fixtures/adapters for two shortlisted
providers, and create an RFI matrix for Vietnam coverage, commercial rights,
retention, SLA and per-active-vehicle cost. Live credentials and production API
calls are explicitly outside that TIP until the product owner approves a
provider trial.
