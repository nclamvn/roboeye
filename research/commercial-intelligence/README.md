# DriveSense commercial intelligence registry

This directory is the evidence ledger for technical choices and connected-data
providers. It is research input, not production configuration: no provider in
these files is called from the local perception or warning hot path.

## Contract

- `snapshots/` contains the captured official source returned at the recorded
  URL and time.
- Each line in `claims.jsonl` has one field-level claim and a verbatim
  `evidence_span` present in its snapshot.
- Missing evidence stays `null` (`—` in the renderer). A blank cell is not an
  invitation to infer a licence, price, coverage or commercial right.
- Tier A is an official project/vendor/licensor source; Tier B is a primary
  paper or public-authority source; Tier C is secondary discovery material and
  is not used in this first cut.
- Registry results are decision support. They do not replace legal review,
  provider quotations, field measurement or an approval to ship.

## Rebuild and challenge the gates

```bash
refinery_root=/Users/os/.codex/skills/refinery
python3 "$refinery_root/refinery.py" research/commercial-intelligence/domains/technical_solutions
python3 "$refinery_root/bites.py" research/commercial-intelligence/domains/technical_solutions
python3 "$refinery_root/refinery.py" research/commercial-intelligence/domains/traffic_data_sources
python3 "$refinery_root/bites.py" research/commercial-intelligence/domains/traffic_data_sources
```

The `universe` in each domain is the explicitly enumerated first shortlist,
not an estimate of the entire market. Therefore the resulting 100% coverage
means “all shortlisted candidates have at least one sourced claim”, never
“complete market coverage”.

## TIP-55B decision seam

- `TIP-55B-RFI-MATRIX.md` separates documented interface facts from the written
  commercial answers still required.
- `rfi/tip55b-provider-rfi.json` is the machine-readable stop gate. Mandatory
  Vietnam coverage, cost, rights, retention, redistribution and SLA fields stay
  `null` until attributable provider evidence is received.
- Synthetic adapter fixtures live under `tests/fixtures/connected-events/` and
  are not registry evidence or provider output.
