"""Mac-only sparse feature track candidate; no range or world-motion authority.

Detector boxes seed/confirm identity, never create a displacement vote. Each
intermediate frame must have an accepted previous→current background warp.
Only a new, unambiguous detector match can publish a fresh candidate. Unknown
means unknown: the caller must not fall back to raw detector box displacement.
"""

from collections import deque
from dataclasses import dataclass, field
import math

import cv2
import numpy as np

from assist_scene_motion import Detection, apply, box_center, box_diag, box_iou, warp_box


POLICY = {
    "maxTracks": 12, "maxPoints": 48, "minPoints": 7,
    "minSurvival": .58, "minConsensus": .70, "minSpan": .14,
    "maxFrameGapMs": 65, "maxDetectorGapMs": 300, "maxHistoryMs": 1050,
    "minHistoryMs": 360, "minDirectionCoherence": .76,
    "minDisplacementDiagonal": .013, "minDisplacementObjectDiagonal": .10,
    "busAnchorScore": .70,
}
_LK = {"winSize": (17, 17), "maxLevel": 3,
       "criteria": (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 24, .01),
       "flags": cv2.OPTFLOW_USE_INITIAL_FLOW}


def _inset(box, fraction):
    a, b, c, d = box
    dx, dy = (c - a) * fraction, (d - b) * fraction
    return a + dx, b + dy, c - dx, d - dy


def _contained(points, box):
    a, b, c, d = box
    return ((points[:, 0] >= a) & (points[:, 0] <= c)
            & (points[:, 1] >= b) & (points[:, 1] <= d))


def _spans(points, box):
    return (len(points) >= POLICY["minPoints"]
            and min(np.ptp(points, axis=0) / np.maximum(1, [box[2] - box[0], box[3] - box[1]]))
            >= POLICY["minSpan"])


def _clip(box, w, h):
    a, b, c, d = box
    return max(0., float(a)), max(0., float(b)), min(float(w), float(c)), min(float(h), float(d))


def _boxes(detections, w, h):
    valid = []
    for row in detections:
        if (not isinstance(row, Detection) or not isinstance(row.label, str) or not row.label
                or not math.isfinite(row.score) or not .38 <= row.score <= 1
                or len(row.xyxy) != 4 or not all(math.isfinite(v) for v in row.xyxy)):
            continue
        box = _clip(row.xyxy, w, h)
        if box[2] - box[0] >= 14 and box[3] - box[1] >= 14:
            valid.append(Detection(row.label, row.score, box))
    return sorted(valid, key=lambda item: (-item.score, item.label, item.xyxy))[:POLICY["maxTracks"]]


def _features(gray, detection, neighbors):
    x, y, r, b = _inset(detection.xyxy, .18)
    h, w = gray.shape
    a, t, c, d = max(3, math.ceil(x)), max(3, math.ceil(y)), min(w-3, math.floor(r)), min(h-3, math.floor(b))
    if c-a < 8 or d-t < 8:
        return None
    mask = np.full((d-t, c-a), 255, np.uint8)
    for other in neighbors:
        if other is detection:
            continue
        x0, y0, x1, y1 = other.xyxy
        xx0, yy0 = max(a, math.floor(x0)), max(t, math.floor(y0))
        xx1, yy1 = min(c, math.ceil(x1)), min(d, math.ceil(y1))
        if xx0 < xx1 and yy0 < yy1:
            mask[yy0-t:yy1-t, xx0-a:xx1-a] = 0
    points = cv2.goodFeaturesToTrack(gray[t:d, a:c], maxCorners=POLICY["maxPoints"],
                                     qualityLevel=.018, minDistance=3, mask=mask, blockSize=5)
    if points is None:
        return None
    points = points[:, 0] + np.array([a, t], np.float32)
    return points if _spans(points, detection.xyxy) else None


def _flow(prev, gray, points, matrix):
    """Batch forward/backward LK; initialize using only background geometry."""
    original = np.ascontiguousarray(points.reshape(-1, 1, 2), dtype=np.float32)
    background = apply(matrix, points)
    guess = np.ascontiguousarray(background.reshape(-1, 1, 2), dtype=np.float32)
    target, good, error = cv2.calcOpticalFlowPyrLK(prev, gray, original, guess, **_LK)
    if target is None or good is None or error is None:
        return None
    back, reverse_good, reverse_error = cv2.calcOpticalFlowPyrLK(gray, prev, target, original.copy(), **_LK)
    if back is None or reverse_good is None or reverse_error is None:
        return None
    target = target[:, 0]
    h, w = gray.shape
    keep = (good.ravel() == 1) & (reverse_good.ravel() == 1)
    keep &= np.isfinite(target).all(axis=1)
    keep &= np.linalg.norm(back[:, 0] - points, axis=1) <= max(.9, 1.55 * max(w, h) / 768)
    # Forward/backward consistency alone can survive occluder swaps or poorly
    # textured patches. Reject very different local appearance as well.
    keep &= (error.ravel() <= 17) & (reverse_error.ravel() <= 17)
    keep &= _contained(target, (2, 2, w-3, h-3))
    return target, target - background, keep


@dataclass
class _Track:
    id: int
    detection: Detection
    points: np.ndarray
    detected_ms: float
    observed_ms: float
    seed_count: int
    bus_anchored: bool = False
    labels_changed: bool = False
    observations: int = 1
    votes: deque = field(default_factory=lambda: deque(maxlen=32))

    @property
    def label(self):
        # Only successful same-region matching can transfer a bus anchor, and
        # even then publish a neutral class if a bus/truck flicker occurred.
        return "vehicle" if self.labels_changed else self.detection.label


class BurstTracker:
    """One bounded clip tracker; an explicit reset discards prior evidence."""

    def __init__(self):
        self.epoch = 0
        self.next_id = 1
        self._tracks = []
        self._previous = None
        self._time_ms = None
        self._pose = np.eye(3)

    def reset(self):
        self.epoch += 1
        self._tracks.clear()
        self._previous = None
        self._time_ms = None
        self._pose = np.eye(3)

    def predicted_boxes(self, matrix=None):
        """Advisory masks only; never a source of motion or semantic claims."""
        return [Detection(t.label, t.detection.score,
                          t.detection.xyxy if matrix is None else warp_box(matrix, t.detection.xyxy))
                for t in self._tracks]

    def _propagate(self, gray, matrix, now):
        prior = self._tracks
        if not prior:
            return
        notes = _flow(self._previous, gray, np.concatenate([t.points for t in prior]), matrix)
        self._tracks = []
        if notes is None:
            return
        targets, residuals, intact = notes
        h, w = gray.shape
        common = np.linalg.inv(self._pose[:2, :2])
        offset = 0
        for track in prior:
            part = slice(offset, offset+len(track.points))
            offset += len(track.points)
            good = intact[part]
            if now-track.detected_ms > POLICY["maxDetectorGapMs"] or np.count_nonzero(good) < max(
                POLICY["minPoints"], track.seed_count * POLICY["minSurvival"]
            ):
                continue
            old, new, residual = track.points[good], targets[part][good], residuals[part][good]
            estimate = np.median(residual, axis=0)
            # One outlying texture patch does not vote against a static object.
            spread = max(1.15, .35 * float(np.linalg.norm(estimate)))
            agree = np.linalg.norm(residual-estimate, axis=1) <= spread
            if np.mean(agree) < POLICY["minConsensus"] or not _spans(old[agree], track.detection.xyxy):
                continue
            displacement = np.median(residual[agree], axis=0)
            frozen_box = np.array(warp_box(matrix, track.detection.xyxy))
            moved_box = _clip(frozen_box + np.tile(displacement, 2), w, h)
            if not _spans(new[agree], moved_box):
                continue
            track.votes.append((track.observed_ms, now, common @ displacement,
                                int(np.count_nonzero(agree))))
            while track.votes and now-track.votes[0][0] > POLICY["maxHistoryMs"]:
                track.votes.popleft()
            track.points = new[agree]
            track.detection = Detection(track.detection.label, track.detection.score, moved_box)
            track.observed_ms = now
            self._tracks.append(track)

    def _confirm(self, gray, detections, now):
        h, w = gray.shape
        source, target = {}, {}
        for i, track in enumerate(self._tracks):
            old = track.detection.xyxy
            for j, detection in enumerate(detections):
                if track.detection.label != detection.label and not (
                        track.bus_anchored and {track.detection.label, detection.label} <= {"bus", "truck"}):
                    continue
                new = detection.xyxy
                if not .58 <= box_diag(new)/box_diag(old) <= 1.75 or box_iou(old, new) < .22:
                    continue
                contained = _contained(track.points, _inset(new, .07))
                if np.mean(contained) < .75 or not _spans(track.points[contained], new):
                    continue
                source.setdefault(i, []).append((j, contained))
                target.setdefault(j, []).append(i)
        matched, proposals = {}, []
        for i, edges in source.items():
            if len(edges) != 1 or len(target[edges[0][0]]) != 1:
                continue
            j, use = edges[0]
            track, detection = self._tracks[i], detections[j]
            track.labels_changed |= detection.label != track.detection.label
            track.bus_anchored |= detection.label == "bus" and detection.score >= POLICY["busAnchorScore"]
            # A competitor covering the actual tracked points invalidates
            # identity even if it has a different semantic class.
            for k, other in enumerate(detections):
                if k != j:
                    use &= ~_contained(track.points, _inset(other.xyxy, .06))
            if np.count_nonzero(use) < track.seed_count * POLICY["minSurvival"] or not _spans(track.points[use], detection.xyxy):
                continue
            track.points = track.points[use]
            track.detection, track.detected_ms = detection, now
            track.observations += 1
            matched[j] = track
            candidate = self._candidate(track, now, w, h)
            if candidate is not None:
                proposals.append(candidate)
            # Refresh texture only on a real confirmed detector frame. A new
            # witness cohort never inherits an older cohort's motion votes.
            if len(track.points) < track.seed_count * .82:
                refreshed = _features(gray, detection, detections)
                if refreshed is not None and len(refreshed) > len(track.points):
                    track.points, track.seed_count = refreshed, len(refreshed)
                    track.votes.clear()
        self._tracks = []
        for j, detection in enumerate(detections):
            if j in matched:
                self._tracks.append(matched[j])
                continue
            points = _features(gray, detection, detections)
            if points is not None:
                anchor = detection.label == "bus" and detection.score >= POLICY["busAnchorScore"]
                self._tracks.append(_Track(self.next_id, detection, points, now, now, len(points), anchor))
                self.next_id += 1
        return proposals

    def _candidate(self, track, now, w, h):
        votes = track.votes
        if (track.observations < 3 or len(votes) < 6 or now-votes[0][0] < POLICY["minHistoryMs"]
                or votes[-1][1] != now):
            return None
        vectors = np.array([v[2] for v in votes])
        vector = np.sum(vectors, axis=0)
        net = float(np.linalg.norm(vector))
        travel = float(np.sum(np.linalg.norm(vectors, axis=1)))
        floor = max(math.hypot(w, h)*POLICY["minDisplacementDiagonal"],
                    box_diag(track.detection.xyxy)*POLICY["minDisplacementObjectDiagonal"])
        if net < floor or travel <= 0 or net/travel < POLICY["minDirectionCoherence"]:
            return None
        along = vectors @ (vector/net)
        windows = np.array_split(along, 3)
        if sum(np.sum(window) >= floor*.15 for window in windows) < 2:
            return None
        recent = sum(float(projection) for vote, projection in zip(votes, along) if now-vote[1] <= 120)
        if recent < floor*.20:
            return None
        direction = (("image-right" if vector[0]>0 else "image-left") if abs(vector[0])>=abs(vector[1])
                     else ("image-down" if vector[1]>0 else "image-up"))
        return {"trackId": track.id, "label": track.label, "direction": direction,
                "timeMs": now, "epoch": self.epoch, "netPixels": net, "travelPixels": travel,
                "durationMs": now-votes[0][0], "coherence": net/travel,
                "localEvidence": {"steps": len(votes), "minSupportingPoints": min(v[3] for v in votes),
                                  "confirmedDetections": track.observations, "detectorLabel": track.detection.label,
                                  "busAnchor": track.bus_anchored, "recentAlongPixels": recent}}

    def update(self, gray, matrix, at_ms, detections=None):
        """Current grayscale frame + vetted affine; None/[] detection differ.

        `None` means no detector acquisition at this timestamp. `[]` means
        acquisition ran and the target was not confirmed: clear its identity.
        Returns current track metadata and candidates; prediction-only frames
        never emit candidates. Image references are bounded to the prior frame.
        """
        if (not isinstance(gray, np.ndarray) or gray.ndim != 2 or gray.dtype != np.uint8
                or min(gray.shape) < 26 or max(gray.shape) > 768
                or not math.isfinite(at_ms) or at_ms < 0):
            self.reset()
            return [], []
        if matrix is not None:
            matrix = np.asarray(matrix, dtype=float)
        good_pair = (self._previous is not None and self._previous.shape == gray.shape
                     and 0 < at_ms-self._time_ms <= POLICY["maxFrameGapMs"]
                     and matrix is not None and matrix.shape == (2, 3) and np.isfinite(matrix).all()
                     and .72 <= np.linalg.det(matrix[:, :2]) <= 1.37)
        if not good_pair:
            self.reset()
        else:
            move = np.eye(3)
            move[:2] = matrix
            self._pose = move @ self._pose
            if not .3 <= np.linalg.det(self._pose[:2, :2]) <= 3.3:
                self.reset()
            else:
                self._propagate(gray, matrix, at_ms)
        self._previous, self._time_ms = gray, at_ms
        h, w = gray.shape
        proposals = self._confirm(gray, _boxes(detections, w, h), at_ms) if detections is not None else []
        tracks = [{"id": track.id, "observations": track.observations,
                   "detectorConfirmed": detections is not None,
                   **Detection(track.label, track.detection.score, track.detection.xyxy).record(w, h)}
                  for track in self._tracks]
        return tracks, proposals
