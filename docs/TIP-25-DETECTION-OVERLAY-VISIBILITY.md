# TIP-25 — Detection overlay visibility repair

## Root cause

`#det-overlay` starts with the HTML `hidden` attribute. The detector renderer previously appended correct SVG rectangles and changed only inline `display`. The `hidden` attribute remained on the SVG, so browser layout kept the entire overlay invisible even though tests could count its child nodes.

## Repair

`drawDetections` now toggles the actual `hidden` attribute in the same render path as `display`. When 2D detection is active the SVG becomes renderable; when the mode changes or detection is disabled it is hidden again.

## Regression contract

Detection E2E requires all of the following after two mock detections arrive:

- two lock rectangles exist;
- the SVG has no `hidden` attribute;
- computed display/visibility allow painting;
- the SVG occupies non-zero camera-stage space.
