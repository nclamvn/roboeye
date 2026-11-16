"""Presentation for internal Mac RGB motion results; not a JSON ingestion API."""

from collections import Counter

from assist_scene_evidence import (
    EvidenceSource, MotionEvidence, MotionStatus, TrackContext,
    assess_motion, assess_range, format_motion_vi, format_range_vi,
)


def render_rgb_frame(*, time_ms, epoch, registration_valid, tracks, compensated_events):
    """Only this host producer's current registered events may become speech.

    Clip replay uses the sampled media clock. This path cannot be supplied a
    measurement or VLM reply. A sensor-equipped runtime requires a separate
    trusted adapter and a live clock at the time of rendering.
    """
    track_ids = Counter(row["id"] for row in tracks)
    visible = {row["id"]: row["label"] for row in tracks if track_ids[row["id"]] == 1}
    counts = Counter(row["trackId"] for row in compensated_events)
    notices = []
    if registration_valid is True:
        for row in compensated_events:
            id_ = row["trackId"]
            if (counts[id_] != 1 or id_ not in visible or row["label"] != visible[id_]
                    or row["epoch"] != epoch or row["timeMs"] != time_ms):
                continue
            context = TrackContext(id_, epoch, time_ms, time_ms)
            evidence = MotionEvidence(id_, epoch, row["timeMs"], MotionStatus.OBSERVED_FRAME_CHANGE,
                                      EvidenceSource.VERIFIED_FRAME_TRACK)
            decision = assess_motion(context, evidence)
            if decision.status is MotionStatus.OBSERVED_FRAME_CHANGE:
                notices.append({"trackId": id_, "label": visible[id_], "status": decision.status.value,
                                "reason": decision.reason.value, "textVi": format_motion_vi(context, evidence)})
    range_ = assess_range(None)
    return {
        "distance": {"metres": range_.metres, "reason": range_.reason.value, "textVi": format_range_vi(None)},
        "motion": {"status": MotionStatus.OBSERVED_FRAME_CHANGE.value if notices else MotionStatus.UNKNOWN.value,
                   "trackNotices": notices, "textVi": notices[0]["textVi"] if notices else format_motion_vi(None)},
    }
