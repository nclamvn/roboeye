# TIP-50R-D6 — Anchor lane icon to video content

P0, depends on D5. User approved repositioning only. Compact workflow:
scan → TIP → Builder → verification; no architecture interview needed.

Root cause: icon has fixed viewport CSS offsets while the video uses object-fit
contain. Letterboxing separates the icon from actual video pixels.

Requirements:
1. Reuse the existing canvas/video contain rectangle; icon stays inside it,
   near its top-left corner, inset 12px, without changing video scaling.
2. Track viewport/source/fullscreen changes; avoid header/status overlap when
   they share the image area. Clamp inside small video regions.
3. Preserve lane state, colors, typography and risk/model behavior. Remove
   conflicting desktop/mobile absolute offsets. Test geometry + browser bounds.

Design: retain D5's cabin/gray/green/amber palette, SVG and 42px footprint;
only anchor changes. No new decorative layout. Completion report required.
