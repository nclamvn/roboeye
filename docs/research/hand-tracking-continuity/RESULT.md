# Hand-tracking continuity research result

Date: 2026-09-24  
Scope: seven candidate methods for the current commercial browser runtime.

The evidence registry is composed of frozen primary-source excerpts plus one
claim per product-relevant attribute. It is intentionally a decision set, not a
claim that all hand-tracking research has been enumerated.

## Refinery verification

- Universe: 7 methods
- Coverage: 7/7 (100%)
- Build digest: `f6b4f8c84952fefd`
- Idempotency: PASS
- Independent auditor: PASS
- Positive build: PASS
- Adversarial gates: `CAPTURE_MISSING`, `SPAN_NOT_FOUND`, `SOURCED_ATTR`,
  `DISTRIBUTION_NO_DENOMINATOR`, `IDEMPOTENT` all bit and stopped the build.

## Product conclusion

- Primary runtime: MediaPipe Hand Landmarker + timestamp-aware 1€ filtering.
- Adopt now: small observation-centric two-hand association and bounded motion
  bridge, implemented locally without a tracking framework dependency.
- Benchmark later: optical flow and RTMPose/RTMW.
- Offline research reference: HaMeR.
- Blocked as a commercial browser dependency: WiLoR.
