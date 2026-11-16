# TIP-65 M3L diagnosis: what the 21 M3K lane-C misses actually measured

Status: measured diagnosis only. Runtime, policies and inference files remain frozen.

## Evidence and scope

The actual lane-C reconstruction exactly reproduced all 99 complete M3K C surfaces and field traces (apart from wall timing). It used 588 RAFT direction calls, zero detector calls, and retained 265 cumulative measurement records: 202 warming, 27 unsupported expansion and 36 supported expansion. These are cohort records across the stream, not 265 reviewed targets.

The posthoc join preserves all 24 reviewed positive target-keyframes, including all three successes and 21 misses. It retains the original full matching rule: same-family IoU at least 0.35, runner-up margin at least 0.08, and all duplicate reports selecting one target treated as ambiguous. No reviewed labels entered reconstruction.

Detailed cases: [m3k-growth-miss-join.json](evidence/tip65/m3k-growth-miss-join.json). The join also preserves raw detector overlap, full-graph track assignment, identity age, current/past cohort retirements, exact numeric returns and derived gate checks.

## The 21 false negatives

| Observed measurement state | Cases |
|---|---:|
| No attributable current track, with no current same-family detector overlap | 5 |
| Current track exists but no cumulative cohort measurement ran | 11 |
| Only immature cumulative windows were measured | 4 |
| Mature numerical measurements exist, but final cross-cohort conflict vetoes warning | 1 |
| Total | 21 |

Thus **20 of these 21 reviewed positive target-keyframes have no mature numeric growth decision on the target being evaluated**. This is not evidence that their optical growth was weak, negative, noisy or recoverable. Missing growth remains unknown.

The 11 track-present/no-measurement cases comprise four current camera vetoes, three new identities, three retained-ID cases with lost cohorts, and one small/truncated object. The four warming measurements were only 80.701 ms, 80.701 ms, 239.449 ms and 160.490 ms old, with 2, 2, 4 and 3 samples, respectively. They could not meet the frozen 320 ms/five-sample maturity floor.

The traffic target `7dd1fcbb-eb6a-4a65-9b8f-f239f2666b96` illustrates that identity age is not measurement age: at frame 28 its identity was 1040.523 ms old, but its surviving measured cohort was only 160.490 ms old. Three preceding cohorts were retired at frame 26 for insufficient object flow.

## The one mature miss: conflicting box trend vetoes positive pixel growth

Exact case: urban frame 35, token `boreas-boreas-m3k-urban-1598989117933399`, target `18063ff4-1c06-4fee-874b-c928f206d0db`, runtime track 145.

- Cohort 108: age 641.8360000000002 ms; net angular log growth 0.057157390980976726; robust point growth 0.06076729101491078; robust box growth 0.02208671260007731. Confirmed.
- Cohort 118: age 481.7600000000002 ms; net angular log growth 0.04197517341512476; robust point growth 0.045659848446169084; robust box growth 0.038321685646793405. Confirmed.
- Cohort 131: age 321.48 ms; net angular log growth 0.0247680239375385; robust point growth 0.027078704275994684; robust box growth **-0.018210783304242036**; fresh current growth 0.004192056828700686; MAD 0.005423998725958815. Not confirmed.

The younger cohort's net/robust-point growth falls below the unchanged 0.04 floor and its robust box growth falls below the unchanged 0.012 floor. More importantly, its nonpositive robust box growth triggers the frozen cross-cohort conflict rule and vetoes both older confirmed cohorts. Its point and fresh-current growth are positive; this is not a measured RAFT failure to find expansion, nor a measured MAD failure. All failed-gate counts are overlapping cohort counts, not independent missed targets.

## Consequence for the alternative

A mechanism-level test should establish bounded, fresh anchor-to-current pixel evidence without requiring one disposable measurement cohort to survive every adjacent exposure. It should also expose how uncertain detector-box trends influence a warning. Merely accelerating RAFT or lowering numeric floors does not address the observed absence of mature evidence.

This diagnosis does not demonstrate that any alternative rescues a case, preserves false-positive behavior or is useful on untouched clips. Keep camera validity, current evidence, ambiguity vetoes and silence when unsupported. D was not reconstructed; no D numerical conclusions follow from this C-only run.

## SHA-256 provenance

- Input: `7b6508c348920c1105438994e30779e087c777fcd599885e1c518e8a7be3bbe7`
- Original actual M3K receipt: `c65028c0697cd70b321db6f62e00622c8782a02ec34262f5ef334c607a94c138`
- Actual growth reconstruction: `31d2f37fd50d065f9f3f40a0fb2ebd5e16b35d0eb621e274d73a3300f80dd821`
- Original miss diagnosis: `7af7d2bdb1cc6e75c04f213a5cad21a1e82eb1a0f28cfbe623ce8c4205de251c`
- Reviewed truth: `48f7031e5548810b82b2990c0d5d1652718a2c8d40b6d9198a9709029cca0ffc`
- Source projected truth: `9126454f68b8d2cb7315e96430d83f847cc2ea64480a229fb31f684997528b64`
- Reconstruction tool: `54838fbc32972ff18afba85a20989da75764bd139cac6ec3a83c8b83e2705515`
- Miss-diagnostic tool: `fd9092bd0807caf740da96e780e6b33ecc454fc3c568e53112c041c8187ec89e`

The join contains the full frozen inference code fingerprints. Original input/receipt/code bindings and before/after source fingerprints agree. No raw pixels or model weights are copied into these deliverables. No metric range, phone, real-time, safety or commercial claim is made.

