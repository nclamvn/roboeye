# TIP-42 — Usable, evidence-based video PoC

Depends TIP41. P0. Scope: existing DriveSense browser architecture, no new service,
model family or dependency. Contractor/Builder roles exercised sequentially.

## Focused scan / decisions

TypeScript/Vite, native video + canvas, worker RT-DETR, planar calibration,
Hungarian/Kalman, 13 DriveSense unit groups. No authentication/server/upload.
Found gaps: choosing video does not start AI; slow results are discarded against
a newer frame; there is no analysed replay cache; empty distance state looks like
a broken app. Prior tests used an image, not the user's actual driving clip.
User's supplied filename resolves to Downloads/Videotest1.mp4; local-only testing
is in scope, no copying it into Git/public fixtures or transmitting it externally.

RRI auto-answered: user wants a convincing PoC, not decorative synthetic results.
Existing approved D1 replay path is extended; approval checkpoint merged with
user's "triển khai tiếp đạt PoC" request. Full D3 model comparison and real-world
metric accuracy are not implied by this TIP.

## Requirements / acceptance

- P1: Given an uploaded valid clip ≤120s, load AI and analyse automatically;
  show loading/analysing/ready/error explicitly, progress, and cancel/retry.
- P2: Sample at 5Hz into a bounded timeline; source seeks and inference are serial,
  with cancellation, source-generation guards and no live capture contention.
- P3: After analysis, play native video with synchronised tracks; interpolate
  only same-ID boxes in bounded adjacent frames, never across detection gaps.
  Label analysed playback as such, not realtime inference. Seeking keeps cache.
- P4: Source change/cancel/model error stops analysis cleanly; no results leak into
  next clip. Direct camera retains stale-result safeguards. No automatic camera use.
- P5: Calibration is optional for boxes and required for metres. Applying/removing
  profile recomputes cached range without expensive re-inference. Show unknown
  explanation prominently; colour remains experimental proximity, not FCW.
- P6: Export records source mode, coverage, raw sample timing, model/backend,
  analysed vs interpolated display semantics; no fake latency/accuracy metrics.
- P7: Verify on actual Videotest1.mp4 through local file picker, plus pure replay
  tests (boundaries, missing IDs, interpolation, cancellation/time sampling).

## Design plan / review

Keep paper #edf2f3, ink #142631, primary #234e63, dark stage #111b22, progress
#227b9d, amber #855c13. Inter controls/Noto Serif heading unchanged. Video remains
full source aspect; compact workflow strip above video, actions under it. Progress
has numbers/text, not colour only. Advanced manual calibration stays separate.
Review: specialised for recorded driving footage; no new marketing hero, no
opaque panel over traffic, no animation except progress and video.

## Constraints and open gates

No fitted camera values without user's measurements. No road video redistributed.
No patch to dirty RoboHand files. No deploy/commit unless separately requested.
Video PoC readiness and calibrated distance/FCW acceptance must be reported apart.
No claim this fixes the known WASM live latency. Tests and Completion Report required.
