"""Host-only admission for Assist scene facts; no VLM text or JSON parser.

Trust is established at the producer boundary, not by these Python types. Only
host code that actually obtained verified sensor or track evidence may construct
the corresponding witness. Never deserialize external/VLM payloads into these
types, even if a payload claims to come from a recognized source. The Mac clip
runner has no native LiDAR adapter, so its distance input must be absent.
"""

from dataclasses import dataclass
from enum import Enum
from math import isfinite


# Mirrors native ObjectDisplayMetric: current, non-coasting track and a bounded
# approximate camera-to-surface reading. These are not safety-clearance limits.
MAX_AGE_MS = 300.0
MIN_METRES = 0.5
MAX_METRES = 5.0
RANGE_UNKNOWN_VI = "Chưa đo được khoảng cách."
MOTION_UNKNOWN_VI = "Chưa đủ bằng chứng về thay đổi vị trí trong khung hình."


class EvidenceSource(str, Enum):
    NATIVE_LIDAR_SURFACE = "native-lidar-surface"
    VERIFIED_FRAME_TRACK = "verified-frame-track"


class RangeConfidence(str, Enum):
    # SUPPORTED means the trusted native adapter received a supported result
    # from its range estimator, not just a confident RGB class prediction.
    SUPPORTED = "supported"
    LOW = "low"
    UNKNOWN = "unknown"


class MotionStatus(str, Enum):
    OBSERVED_FRAME_CHANGE = "observed-frame-change"
    NO_SIGNIFICANT_FRAME_CHANGE = "no-significant-frame-change"
    UNKNOWN = "unknown"


class Reason(str, Enum):
    ACCEPTED = "accepted"
    MISSING_EVIDENCE = "missing-evidence"
    UNTRUSTED_EVIDENCE = "untrusted-evidence"
    WRONG_SOURCE = "wrong-source"
    INVALID_TRACK = "invalid-track"
    COASTING_TRACK = "coasting-track"
    INVALID_CLOCK = "invalid-clock"
    FUTURE = "future"
    STALE = "stale"
    TRACK_MISMATCH = "track-mismatch"
    EPOCH_MISMATCH = "epoch-mismatch"
    FRAME_MISMATCH = "frame-mismatch"
    INSUFFICIENT_CONFIDENCE = "insufficient-confidence"
    INVALID_RANGE = "invalid-range"
    OUTSIDE_DOMAIN = "outside-domain"
    UNVERIFIED_CHANGE = "unverified-change"


@dataclass(frozen=True, slots=True)
class TrackContext:
    # Epoch is owned by the capture/track session. Timestamps are from its
    # common monotonic/media clock, never from the wall clock or a VLM response.
    track_id: int
    epoch: int
    observed_at_ms: float
    now_ms: float
    is_coasting: bool = False


@dataclass(frozen=True, slots=True)
class RangeEvidence:
    track_id: int
    epoch: int
    captured_at_ms: float
    metres: float
    confidence: RangeConfidence
    source: EvidenceSource


@dataclass(frozen=True, slots=True)
class MotionEvidence:
    track_id: int
    epoch: int
    # End timestamp of the verified temporal observation, in the track clock.
    observed_at_ms: float
    status: MotionStatus
    source: EvidenceSource


@dataclass(frozen=True, slots=True)
class RangeDecision:
    metres: float | None
    reason: Reason


@dataclass(frozen=True, slots=True)
class MotionDecision:
    status: MotionStatus
    reason: Reason


def _finite_number(value: object) -> bool:
    if type(value) not in (int, float):
        return False
    try:
        return isfinite(value)
    except OverflowError:
        # An arbitrary-precision integer may not fit as a float.
        return False


def _identity_ok(track_id: object, epoch: object) -> bool:
    return type(track_id) is int and track_id > 0 and type(epoch) is int and epoch >= 0


def _time_reason(observed_at_ms: float, now_ms: float) -> Reason | None:
    if (not _finite_number(observed_at_ms) or not _finite_number(now_ms)
            or observed_at_ms < 0 or now_ms < 0):
        return Reason.INVALID_CLOCK
    if observed_at_ms > now_ms:
        return Reason.FUTURE
    if now_ms - observed_at_ms > MAX_AGE_MS:
        return Reason.STALE
    return None


def _bind(track: TrackContext | None, track_id: int, epoch: int, stamp_ms: float) -> Reason | None:
    if (type(track) is not TrackContext or not _identity_ok(track.track_id, track.epoch)
            or type(track.is_coasting) is not bool or not _identity_ok(track_id, epoch)):
        return Reason.INVALID_TRACK
    if track_id != track.track_id:
        return Reason.TRACK_MISMATCH
    if epoch != track.epoch:
        return Reason.EPOCH_MISMATCH
    if track.is_coasting:
        return Reason.COASTING_TRACK
    track_age = _time_reason(track.observed_at_ms, track.now_ms)
    if track_age is not None:
        return track_age
    evidence_age = _time_reason(stamp_ms, track.now_ms)
    if evidence_age is not None:
        return evidence_age
    # Distinct from freshness: a different capture within 300 ms is not the
    # current target's depth sample or the end of its verified track interval.
    if stamp_ms != track.observed_at_ms:
        return Reason.FRAME_MISMATCH
    return None


def assess_range(track: TrackContext | None, evidence: RangeEvidence | None = None) -> RangeDecision:
    if evidence is None:
        return RangeDecision(None, Reason.MISSING_EVIDENCE)
    if type(evidence) is not RangeEvidence:
        return RangeDecision(None, Reason.UNTRUSTED_EVIDENCE)
    if evidence.source is not EvidenceSource.NATIVE_LIDAR_SURFACE:
        return RangeDecision(None, Reason.WRONG_SOURCE)
    mismatch = _bind(track, evidence.track_id, evidence.epoch, evidence.captured_at_ms)
    if mismatch is not None:
        return RangeDecision(None, mismatch)
    if evidence.confidence is not RangeConfidence.SUPPORTED:
        return RangeDecision(None, Reason.INSUFFICIENT_CONFIDENCE)
    if not _finite_number(evidence.metres) or evidence.metres <= 0:
        return RangeDecision(None, Reason.INVALID_RANGE)
    if not MIN_METRES <= evidence.metres <= MAX_METRES:
        return RangeDecision(None, Reason.OUTSIDE_DOMAIN)
    return RangeDecision(float(evidence.metres), Reason.ACCEPTED)


def assess_motion(track: TrackContext | None, evidence: MotionEvidence | None = None) -> MotionDecision:
    if evidence is None:
        return MotionDecision(MotionStatus.UNKNOWN, Reason.MISSING_EVIDENCE)
    if type(evidence) is not MotionEvidence:
        return MotionDecision(MotionStatus.UNKNOWN, Reason.UNTRUSTED_EVIDENCE)
    if evidence.source is not EvidenceSource.VERIFIED_FRAME_TRACK:
        return MotionDecision(MotionStatus.UNKNOWN, Reason.WRONG_SOURCE)
    mismatch = _bind(track, evidence.track_id, evidence.epoch, evidence.observed_at_ms)
    if mismatch is not None:
        return MotionDecision(MotionStatus.UNKNOWN, mismatch)
    if (evidence.status is MotionStatus.OBSERVED_FRAME_CHANGE
            or evidence.status is MotionStatus.NO_SIGNIFICANT_FRAME_CHANGE):
        return MotionDecision(evidence.status, Reason.ACCEPTED)
    return MotionDecision(MotionStatus.UNKNOWN, Reason.UNVERIFIED_CHANGE)


def format_range_vi(track: TrackContext | None, evidence: RangeEvidence | None = None) -> str:
    """Produce a distance sentence only by rechecking the typed witness."""
    metres = assess_range(track, evidence).metres
    if metres is None:
        return RANGE_UNKNOWN_VI
    decimal = f"{metres:.1f}".replace(".", ",")
    return f"Khoảng {decimal} mét từ camera đến bề mặt trong khung nhận diện."


def format_motion_vi(track: TrackContext | None, evidence: MotionEvidence | None = None) -> str:
    """Frame-relative wording only; never a statement about world motion."""
    status = assess_motion(track, evidence).status
    if status is MotionStatus.OBSERVED_FRAME_CHANGE:
        return "Vị trí của đối tượng thay đổi so với nền đã căn chỉnh; chưa xác định được chuyển động ngoài đời."
    if status is MotionStatus.NO_SIGNIFICANT_FRAME_CHANGE:
        return "Chưa thấy vị trí thay đổi đáng kể trong các khung hình đã kiểm."
    return MOTION_UNKNOWN_VI
