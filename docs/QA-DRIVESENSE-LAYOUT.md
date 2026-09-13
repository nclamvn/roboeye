# DriveSense layout correction — 2026-09-13

User report: video/demo narrower than its toolbar, bright upload button with
white text. Scope restricted to presentation; no range/detector changes.

Design plan (frontend-design): retain video-first DriveSense layout, Inter controls
and Noto Serif heading. Retain paper #edf2f3 / ink #142631 / stage #111b22;
primary upload #234e63, interactive #193f52, white label #ffffff. Align video
edges with source/transport bars. Preserve source field of view, no cover crop or
non-uniform stretch. Review: no new decoration or unrelated UI redesign needed.

Root causes:

- Stage used auto width + aspect-ratio with max-height:70vh and minimum heights;
  ratio sizing could shrink its width independently of the enclosing viewer.
  Fixed 16:10/4:3 ratios also letterboxed 16:9 inputs.
- Shared `.file-button:hover` lightened the background but retained the upload
  control's white foreground.

Changes:

- Explicit stage width:100%, source-driven aspect ratio, no conflicting loaded
  stage min/max heights. Empty-state-only minimum height keeps instructions usable.
- Video and overlay retain one common contain transform; pixel coordinates used
  by calibration are unchanged. Source/dimension changes refresh the stage ratio.
- Explicit primary/secondary upload hover and focus color pairs. Input text color
  and light color-scheme are explicit; disabled controls no longer fade via opacity.

Verification on production preview `http://127.0.0.1:4191/drive.html`:

- Screenshot reviewed with synthetic replay: fills stage, no right gap/black bars.
- DOM measurement: sourcebar, stage, video, canvas and transport each 874px wide,
  left=22px; stage/video/canvas=491.625px high, matching 16:9 exactly.
- Upload computed normal foreground #fff/background #234e63; deployed hover
  selector pairs #fff/#193f52 and secondary #142631/#c8dce7.
- `npm run build`: pass (includes TypeScript).
- `npm run test:unit`: 87/87 pass. Existing tests, not a new UI E2E suite.
- No live camera, portrait-video or mobile viewport acceptance claimed this turn.

Local production bundle rebuilt. Existing user's browser tab not reset, to avoid
discarding a loaded source or calibration; refresh it to load the new UI.
