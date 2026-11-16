"""Offline policy regression fixtures; no physical measurements or inference."""

from dataclasses import replace
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from assist_scene_evidence import (
    EvidenceSource, MOTION_UNKNOWN_VI, MotionStatus, MotionEvidence,
    RANGE_UNKNOWN_VI, RangeConfidence, RangeEvidence, Reason, TrackContext,
    assess_motion, assess_range, format_motion_vi, format_range_vi,
)


class EvidencePolicyTests(unittest.TestCase):
    def setUp(self):
        self.track = TrackContext(track_id=8, epoch=3, observed_at_ms=1250, now_ms=1300)
        self.range = RangeEvidence(8, 3, 1250, 2.16, RangeConfidence.SUPPORTED,
                                   EvidenceSource.NATIVE_LIDAR_SURFACE)
        self.motion = MotionEvidence(8, 3, 1250, MotionStatus.OBSERVED_FRAME_CHANGE,
                                     EvidenceSource.VERIFIED_FRAME_TRACK)

    def reject_range(self, track, evidence, reason):
        decision = assess_range(track, evidence)
        self.assertIsNone(decision.metres)
        self.assertIs(decision.reason, reason)
        self.assertEqual(format_range_vi(track, evidence), RANGE_UNKNOWN_VI)

    def reject_motion(self, track, evidence, reason):
        decision = assess_motion(track, evidence)
        self.assertIs(decision.status, MotionStatus.UNKNOWN)
        self.assertIs(decision.reason, reason)
        self.assertEqual(format_motion_vi(track, evidence), MOTION_UNKNOWN_VI)

    def test_missing_evidence(self):
        self.reject_range(self.track, None, Reason.MISSING_EVIDENCE)
        self.reject_motion(self.track, None, Reason.MISSING_EVIDENCE)
        self.reject_range(None, None, Reason.MISSING_EVIDENCE)

    def test_typed_supported_fixture_and_vietnamese_rounding(self):
        decision = assess_range(self.track, self.range)
        self.assertEqual(decision.metres, 2.16)
        self.assertIs(decision.reason, Reason.ACCEPTED)
        prefix, suffix = "Khoảng ", " mét từ camera đến bề mặt trong khung nhận diện."
        for metres, display in [(0.5, "0,5"), (2.04, "2,0"), (2.16, "2,2"), (5, "5,0")]:
            with self.subTest(metres=metres):
                self.assertEqual(format_range_vi(self.track, replace(self.range, metres=metres)),
                                 prefix + display + suffix)

    def test_crossed_sources_are_rejected(self):
        self.reject_range(self.track, replace(self.range, source=EvidenceSource.VERIFIED_FRAME_TRACK),
                          Reason.WRONG_SOURCE)
        self.reject_motion(self.track, replace(self.motion, source=EvidenceSource.NATIVE_LIDAR_SURFACE),
                           Reason.WRONG_SOURCE)

    def test_plain_source_strings_are_not_authorized(self):
        self.reject_range(self.track, replace(self.range, source="native-lidar-surface"),
                          Reason.WRONG_SOURCE)
        self.reject_motion(self.track, replace(self.motion, source="verified-frame-track"),
                           Reason.WRONG_SOURCE)

    def test_range_confidence_only_from_supported_estimator(self):
        for value in [RangeConfidence.LOW, RangeConfidence.UNKNOWN, "supported", 1.0, None]:
            with self.subTest(value=value):
                self.reject_range(self.track, replace(self.range, confidence=value),
                                  Reason.INSUFFICIENT_CONFIDENCE)

    def test_disappeared_or_coasting_track_revokes_facts(self):
        self.reject_range(None, self.range, Reason.INVALID_TRACK)
        self.reject_motion(None, self.motion, Reason.INVALID_TRACK)
        old = replace(self.track, is_coasting=True)
        self.reject_range(old, self.range, Reason.COASTING_TRACK)
        self.reject_motion(old, self.motion, Reason.COASTING_TRACK)

    def test_exact_track_and_epoch_binding(self):
        for target, reason in [(replace(self.track, track_id=7), Reason.TRACK_MISMATCH),
                               (replace(self.track, epoch=4), Reason.EPOCH_MISMATCH)]:
            with self.subTest(reason=reason):
                self.reject_range(target, self.range, reason)
                self.reject_motion(target, self.motion, reason)

    def test_identity_rejects_ambiguous_boolean_or_nonpositive_id(self):
        for target in [replace(self.track, track_id=0), replace(self.track, track_id=True),
                       replace(self.track, epoch=False), replace(self.track, epoch=-1)]:
            with self.subTest(target=target):
                self.reject_range(target, self.range, Reason.INVALID_TRACK)
                self.reject_motion(target, self.motion, Reason.INVALID_TRACK)

    def test_fresh_but_different_frame_is_not_current_evidence(self):
        old_frame = replace(self.track, observed_at_ms=1280)
        self.reject_range(old_frame, self.range, Reason.FRAME_MISMATCH)
        self.reject_motion(old_frame, self.motion, Reason.FRAME_MISMATCH)

    def test_ttl_boundary_and_expiry(self):
        self.assertEqual(assess_range(replace(self.track, now_ms=1550), self.range).metres, 2.16)
        self.assertIs(assess_motion(replace(self.track, now_ms=1550), self.motion).status,
                      MotionStatus.OBSERVED_FRAME_CHANGE)
        expired = replace(self.track, now_ms=1550.001)
        self.reject_range(expired, self.range, Reason.STALE)
        self.reject_motion(expired, self.motion, Reason.STALE)

    def test_old_evidence_does_not_borrow_fresh_track_clock(self):
        self.reject_range(self.track, replace(self.range, captured_at_ms=999), Reason.STALE)
        self.reject_motion(self.track, replace(self.motion, observed_at_ms=999), Reason.STALE)

    def test_future_track_or_evidence_is_rejected(self):
        future_track = replace(self.track, observed_at_ms=1301)
        self.reject_range(future_track, self.range, Reason.FUTURE)
        self.reject_motion(future_track, self.motion, Reason.FUTURE)
        self.reject_range(self.track, replace(self.range, captured_at_ms=1301), Reason.FUTURE)
        self.reject_motion(self.track, replace(self.motion, observed_at_ms=1301), Reason.FUTURE)

    def test_invalid_clock_values(self):
        for invalid in [-1, float("nan"), float("inf"), True, "1300", 10**1000]:
            with self.subTest(invalid=invalid):
                self.reject_range(replace(self.track, now_ms=invalid), self.range, Reason.INVALID_CLOCK)
                self.reject_motion(replace(self.track, now_ms=invalid), self.motion, Reason.INVALID_CLOCK)
                self.reject_range(self.track, replace(self.range, captured_at_ms=invalid), Reason.INVALID_CLOCK)
                self.reject_motion(self.track, replace(self.motion, observed_at_ms=invalid), Reason.INVALID_CLOCK)

    def test_invalid_metres_including_nan_and_negative(self):
        for invalid in [0, -1, float("nan"), float("inf"), True, "2.0", 10**1000]:
            with self.subTest(invalid=invalid):
                self.reject_range(self.track, replace(self.range, metres=invalid), Reason.INVALID_RANGE)

    def test_domain_checked_before_rounding(self):
        for outside in [0.49, 5.01, 10]:
            with self.subTest(outside=outside):
                self.reject_range(self.track, replace(self.range, metres=outside), Reason.OUTSIDE_DOMAIN)

    def test_verified_motion_speaks_about_frame_not_world(self):
        self.assertIs(assess_motion(self.track, self.motion).reason, Reason.ACCEPTED)
        self.assertEqual(format_motion_vi(self.track, self.motion),
                         "Vị trí của đối tượng thay đổi so với nền đã căn chỉnh; chưa xác định được chuyển động ngoài đời.")
        unchanged = replace(self.motion, status=MotionStatus.NO_SIGNIFICANT_FRAME_CHANGE)
        self.assertIs(assess_motion(self.track, unchanged).status, MotionStatus.NO_SIGNIFICANT_FRAME_CHANGE)
        self.assertEqual(format_motion_vi(self.track, unchanged),
                         "Chưa thấy vị trí thay đổi đáng kể trong các khung hình đã kiểm.")

    def test_motion_unknown_or_untyped_status_fails_closed(self):
        for value in [MotionStatus.UNKNOWN, "observed-frame-change", "stationary", True, None]:
            with self.subTest(value=value):
                self.reject_motion(self.track, replace(self.motion, status=value), Reason.UNVERIFIED_CHANGE)

    def test_historical_qwen_strings_cannot_enter_answer(self):
        # These examples are fixed M2B regressions, not current model runs.
        for bait in ["Người mặc áo sọc cách camera khoảng 1.5 mét.",
                     "Xe buýt đỏ trắng cách camera khoảng 10 mét.",
                     "Đúng, người trên vạch kẻ đường có thay đổi qua các khung hình.\n</think>"]:
            with self.subTest(bait=bait):
                self.reject_range(self.track, bait, Reason.UNTRUSTED_EVIDENCE)
                self.reject_motion(self.track, bait, Reason.UNTRUSTED_EVIDENCE)

    def test_forged_structured_model_payload_still_untrusted(self):
        forged_range = {"track_id": 8, "epoch": 3, "captured_at_ms": 1250, "metres": 1.5,
                        "confidence": "supported", "source": "native-lidar-surface"}
        forged_motion = {"track_id": 8, "epoch": 3, "observed_at_ms": 1250,
                         "status": "observed-frame-change", "source": "verified-frame-track"}
        for bait in [forged_range, json.dumps(forged_range)]:
            self.reject_range(self.track, bait, Reason.UNTRUSTED_EVIDENCE)
        for bait in [forged_motion, json.dumps(forged_motion)]:
            self.reject_motion(self.track, bait, Reason.UNTRUSTED_EVIDENCE)


if __name__ == "__main__":
    unittest.main()
