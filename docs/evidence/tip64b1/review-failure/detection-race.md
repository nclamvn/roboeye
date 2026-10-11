# Detection browser regression race — 2026-10-10

Expanded QA first failed the assertion `#det-overlay > rect:not(.det-label-bg) === 2`, while the immediately subsequent two-lock/two-badge/two-label assertion passed. No native test failed (25 core +5 UI passed). Failure receipt was `pass:false`, source `3cfce3346cea832350b6b83b0d6e82d066e4ad396119df42eda06a7648eeaedc`.

Independent diagnostic replay read **one lock/one box at raw-panel readiness**, then the same two-box assertion passed a moment later. Code explains the timing: `refreshAnnotations` renders raw rows on detection result; `setAnimationLoop` later draws `detSmoother.advance(dt)` with confidence/confirmation rules. Panel readiness is not tracker presentation readiness. `src/ui/shell.ts` confirms the original direct-child rect selector was correct; this was not a selector/DOM nesting defect or a demonstrated missing-box product defect.

Fix is in the test only: poll the actual visible overlay's exact two lock rects with a 2-second bound before checking boxes and their badges. Failure remains fatal if two boxes never arrive. No UI, tracking/model threshold or range safety gate was changed. Final complete QA must rerun on the updated test and expanded fingerprint, including the legacy feature contracts; physical detector quality remains untested by mocks.
