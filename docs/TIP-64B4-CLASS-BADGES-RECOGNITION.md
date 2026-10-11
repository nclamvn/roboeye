# TIP-64B4 — Class-colored badges & recognition gap investigation

2026-10-11 · Contractor/Builder: vibecode-kit v6.2 · UI: frontend-design.

Source: user reports all badge fills black, asks different colors by object type;
electric fan is missed and smartphone sometimes becomes remote. This is feedback
on installed native0.2.1(4), not DriveSense/browser. Existing user changes retained.

## Decisions / boundary

Direct compatible UI refinement is authorized by the feedback; consolidate
scan/design/approval. Different **class**, not confidence/ID, owns stable badge
fill. IDs/text remain necessary: colors alone cannot uniquely encode80 classes.
Separate range validity from class hue. Do not use red/green to imply safe travel.
No blink, model score-dependent hue, aliases remote→phone or heuristic fan claim.
No paid API, image upload, dependency/model install, large architecture change or
Git/deploy. Phone installation separately asked; no install without authorization.

New semantic vocabulary/model is a separate promotion gate. The shipped80-class
artifact has no fan label; newer80-class COCO weights alone cannot add that class.
Investigate preprocessing, alternatives/score provenance and replacement paths
before altering detection. Ask for real smartphone samples; do not invent them.

## Requirements

| REQ | Acceptance |
|---|---|
| C01 | Visible stable class-colored fill, same class/aliases same hue; phone/remote/person/chair/book/bottle/fridge distinguishable in UI fixtures |
| C02 | White text/fill contrast>=4.5:1; measured/unknown and Reduce Transparency preserve semantic fill and readable separate status cue |
| C03 | Retained planes/views/AX, collision/exclusion/TTL and raw measurement unchanged; dense/bright/DynamicType regression screenshots reviewed |
| C04 | Recognition root-cause investigation with local source + primary technical evidence; fan vocabulary confirmed, phone confusion not misrepresented as fixed by palette |
| C05 | B4-only QA receipts/counts, old B1–B3 evidence immutable; version0.2.2/build5 if code ships, signing/model unchanged; completion distinguishes physical/semantic gates |
| C06 | A high-overlap phone↔remote relabel does not leave the obsolete contradictory coast badge or transfer metres; concurrent contradictory high-overlap hypotheses are bounded/deterministic without preferring phone by name; distinct objects and other classes remain untouched |

## Design

Camera-first native instrument remains. Use a bounded perceptually separated
palette of solid, clearly chromatic fills (not near-black with a colored border
only). Example families: person azure, phone violet, remote ochre, furniture teal,
book blue; choose actual tokens with measured contrast. No claim80 unique hues.
Classification uncertainty is not fixed by color; unknown metres remain explicit
and amber status cannot relabel an object. Names/IDs and decimal metric retained.

## Ownership

- UI Builder: focused scan + palette core helper/tests, Overlay integration,
  UITests, version/project/generator and QA scripts/ModelQA ONLY if needed to
  write separate B4 receipts. No recognition algorithm change. Report tests,
  deviations and source freeze. No Xcode/simulator/phone builds until Contractor.
- Core Builder: recognition/preprocessing/confidence scan followed by a bounded
  approved ObjectTracking-only C06 repair and regression tests. No model
  downloads/preprocessing/confidence/depth policy changes; no overlapping writes.
- Contractor: primary-source research, TIP/decision/report, final model/build/
  core/interop/UI QA and actual screenshot critique. No application source code.

## Verify / hygiene

Reuse checkout, `.build`, `.build-xcode`; df>=20GiB before large work; no external
project copies/venvs/deps. Exact tests/counts and requirements coverage; label
colors must appear in real rendered UI, not just enum tests. Semantic phone/fan
recall improvement stays unverified until an actual model/data comparison.
No new fixture may pretend a fan was detected by the80-class shipping model.

## L2 decision after scan

Core Builder found same-label-only association leaves an old phone coasting
beside a new remote at the same geometry, and concurrent contradictory pair
hypotheses are not deduplicated. Approve C06 for this specific pair using the
existing high-overlap suppression threshold as a conservative boundary. Do not
turn generic cross-class overlap into suppression (person/phone or book/phone
can be physically nested). New identity must not inherit range. Picking a raw
stronger hypothesis is not proof of correct semantic class. No arbitrary vote,
phone-name preference or fabricated generic/fan class. Keep semantic error open.

User subsequently authorized installation after QA. Contractor owns that step;
Builders still do not build/install on the physical phone.
