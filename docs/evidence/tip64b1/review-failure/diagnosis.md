# Independent native UI review

The original large-type test only checked that a button existed; it did not prove the control could be brought into the scroll viewport. Strengthened test failed for `record`.

Reproduction: iOS 27 simulator, landscape, accessibility medium type, eight unconditional fast swipe-up gestures. The diagnostic XCTest log showed the record button **above** the viewport after overshoot, while subsequent gestures continued scrolling up:

```
record button=(90.0, 73.0, 342.0, 50.7)
controls viewport=(74.0, 175.3, 726.0, 198.7)
Reach record step 6 ...
Reach record step 7 ... [same coordinates at scroll end]
```

Root cause: test gesture strategy could skip a row and never reverse direction. Not missing buttons, native range logic, or camera/depth delay. Replace fast one-direction swipe with small direction-aware drags and assert every button's centre is within the actual scroll viewport and size ≥44 pt. Disabled controls remain intentionally disabled without camera/recording data. The app dark appearance was also corrected for readable disabled-button contrast; no range/permission/confidence threshold relaxed.

Keep software-vs-hardware distinction: this test exercises native layout/accessibility/scrolling, not real ARKit sensor alignment. Final native QA must run again after the refined test before READY-for-installation status.
