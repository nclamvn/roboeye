# TIP-30: AirDesk Direct Content Manipulation

## Product contract

AirDesk is a visual, camera-first interaction surface rather than an invisible
gesture shortcut. All five visible fingertips are rendered as yellow points.
Extended fingers receive a larger yellow ring, while a fist or a lost hand
removes the affordance. Thumb–index pinch is the sole press/hold/release input.

AirDesk is mutually exclusive with AirSketch. This prevents a user from
accidentally creating an AAC stroke while choosing text or moving an image.

## Delivered interaction

- **Image:** pinch-drag the image to move it; pinch-drag the corner handles to
  scale or rotate it; pinch the visible controls to flip, reset or enter
  annotation mode. In annotation mode a held pinch draws on the image.
- **Text:** pinch-drag inside the editable note to select text, then pinch the
  Copy, Cut or Delete controls. The spelling control explicitly applies the
  displayed Vietnamese correction; it never silently rewrites user text.
- **Fallback:** regular mouse, touch, keyboard and browser spellchecking remain
  available. Clipboard failure never destroys the selected text.

## Safety and limits

This is a local demo editor, not system-wide computer control. It does not
claim reliable hand input under occlusion, nor does it send camera/text data to
a server. Destructive text actions remain visible, reversible through the
browser editor's normal undo mechanism and usable through conventional input.

## Verification

Unit coverage proves fingertip/pinch edges and independent transform/drawing
state. Browser E2E verifies five rendered markers, image rotation and the
visible spelling proposal in the real worker-to-DOM path.
