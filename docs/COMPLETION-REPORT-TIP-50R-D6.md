# Completion Report — TIP-50R-D6

## Outcome

Lane status icon now overlays the actual contained video image, not the surrounding letterbox. Scope is layout only; lane inference, confidence, distance and warning logic are unchanged.

## Root cause and implementation

The icon previously used fixed stage offsets while the video used object-fit: contain. In portrait windows this placed the icon above the image. The render loop now supplies the same contain rectangle used by the canvas overlay to a small tested layout function. The icon is inset 12 CSS pixels, clears header/status chrome when necessary, and is clamped inside small image regions. Conflicting fixed/mobile positioning rules were removed. CSS coordinate updates are skipped when unchanged.

## Acceptance: 3/3

- Icon remains inside the actual video image, using shared geometry.
- Layout follows viewport resize, fullscreen enter/exit, and source aspect-ratio changes.
- Existing compact styling and state colors are preserved; no detection changes.

## Verification

- TypeScript typecheck: pass.
- Production build: pass.
- Targeted layout, HUD and runtime unit tests: 13/13 pass.
- Browser geometry checks: 7/7 pass; zero page errors.
- Cases: portrait window, desktop, phone-sized viewport, ultrawide, fullscreen enter, fullscreen exit, portrait source replacement.
- Test waits for decoded video and seeks to 1 second before captures. Portrait-window screenshot visually inspected: icon is on the upper-left of real road footage.
- git diff --check: pass.

Browser evidence: `/private/tmp/roboeye-road-icon-anchor-qa/result.json` and screenshots in the same temporary directory. These verify layout, not lane-detection accuracy or physical-device performance.

## Handoff

Local UI: http://127.0.0.1:4192/drive.html?lanes=1&v=video-anchor

No commit, push or deployment performed. Existing unrelated worktree changes preserved.
