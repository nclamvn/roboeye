"""M3H: independently observed object identities and finite feature cohorts.

An identity is not an optical measurement. A rejected cohort never renews or
coasts a warning. Each measurement retains its own real point correspondences,
age and support denominator; new seeds cannot inherit an older cohort's history.
This Mac experiment emits only relative optical expansion, never metric range.
"""

from collections import deque
from dataclasses import dataclass
from types import MappingProxyType
import math

import cv2
import numpy as np

import assist_scene_window_loom as window
from assist_scene_dense_window import DenseWindowLoom, POLICY as DENSE_POLICY, _sample
from assist_scene_scale_approach_m3e import _native_transform


POLICY = MappingProxyType({**DENSE_POLICY,
    "maxCohortsPerIdentity": 3, "seedCadenceMs": 160.,
    "identityPatchSide": 32, "identityPatchStdFloor": 3.,
    "identityPatchCorrelation": .70, "missingIdentityHoldMs": 0.,
    "identityInset": .12, "identityBlurKernel": 3, "identityBlurSigma": .8,
})
base = window.base


@dataclass
class Cohort:
    id: int
    born: float
    tube: object


@dataclass
class Identity:
    id: int
    box: object
    appearance: object
    born: float
    last_seed: float
    cohorts: list


def _appearance(raw, box, transform):
    rect = base._warp_rect(box.xyxy, transform)
    size = base._size(rect)
    a = np.maximum(0, np.ceil(rect[:2]+POLICY["identityInset"]*size)).astype(int)
    b = np.minimum(raw.shape[::-1], np.floor(rect[2:]-POLICY["identityInset"]*size)).astype(int)
    if min(b-a) < 4:
        return None
    patch = cv2.resize(raw[a[1]:b[1], a[0]:b[0]],
                       (POLICY["identityPatchSide"],)*2, interpolation=cv2.INTER_AREA).astype(np.float32)
    if float(np.std(patch)) < POLICY["identityPatchStdFloor"]:
        return None
    # Identity uses coarse surface appearance, not the very corner texture
    # whose lifecycle is being measured separately. Smoothing reduces sampling
    # and local feature-turnover sensitivity without reducing the NCC floor.
    patch = cv2.GaussianBlur(patch, (POLICY["identityBlurKernel"],)*2, POLICY["identityBlurSigma"])
    patch -= np.mean(patch)
    norm = np.linalg.norm(patch)
    return None if norm < 1e-6 else patch / norm


def _correlation(old, new):
    return None if old is None or new is None else float(np.clip(np.sum(old*new), -1., 1.))


class CohortWindowLoom(DenseWindowLoom):
    """ID association and measurement cohorts have separate lifecycle owners."""

    def __init__(self, *, native_detail=True):
        super().__init__(native_detail=native_detail)
        self._next_cohort = 1

    def _reset(self):
        super()._reset()
        # Cohort identifiers are monotonic for this object, including epochs.
        if not hasattr(self, "_next_cohort"):
            self._next_cohort = 1

    def _field(self, old, new, old_box, box, transform):
        tile = window._tile(old, new, old_box.xyxy, box.xyxy, transform)
        if tile is None:
            return None, "invalid-object-crop"
        p, q, mapping = tile
        if min(p.shape) < 2*POLICY["densePatchSize"]:
            return None, "insufficient-dense-support"
        try:
            forward = self._dis.calc(p, q, None)
            backward = self._dis.calc(q, p, None)
        except cv2.error:
            return None, "dense-flow-unavailable"
        return (p, q, mapping, forward, backward), "field-supported"

    def _cohort_flow(self, field, cohort, box, homography, others):
        p, q, mapping, forward, backward = field
        tube = cohort.tube
        a = base._project(tube.points, mapping).astype(np.float32)
        delta, ok = _sample(forward, a)
        b = a+delta
        reverse, rev = _sample(backward, b)
        return window._validate_flow(p, q, a, b, b+reverse, ok, rev,
                                     tube, box, homography, mapping, others)

    def _seed_cohort(self, identity, raw, transform, others, at):
        points = self._new_points(raw, identity.box.xyxy, others, transform)
        if points is None:
            return None
        tube = window.Tube(identity.box, identity.id, points, len(points),
                           deque([(at, points.copy(), base._size(identity.box.xyxy))],
                                 maxlen=POLICY["maxHistory"]))
        cohort = Cohort(self._next_cohort, at, tube)
        self._next_cohort += 1
        return cohort

    def update(self, frame, t_ms, gray, boxes, *, native_gray=None):
        def result(status, diagnostics=None, tracks=None, events=None):
            return {"status": status, "diagnostics": diagnostics or {}, "tracks": tracks or [],
                    "events": events or [], "epoch": self.epoch}
        if (not isinstance(gray, np.ndarray) or gray.dtype != np.uint8 or gray.ndim != 2
                or not 32 <= min(gray.shape) <= max(gray.shape) <= 768):
            self._reset(); return result("invalid-image")
        if type(t_ms) not in (int, float) or not math.isfinite(t_ms) or t_ms < 0:
            self._reset(); return result("invalid-stream-clock")
        h, w = gray.shape
        frame, status = base._frame_view(frame, w, h)
        boxes = base._boxes(boxes, w, h)
        if frame is None or boxes is None:
            self._reset(); return result(status if frame is None else "invalid-detections")
        native = _native_transform(native_gray, gray.shape) if self.native_detail else None
        raw = native_gray if native is not None else gray
        transform = native if native is not None else np.eye(3)
        q = {"trackReasons": {}, "windowEvidence": {}, "identityDecisions": {},
             "cohorts": {}, "retiredCohorts": {}, "nativeDetail": native is not None}
        prior = []; homography = None; status = "first-frame"; old_image = None
        if self._previous is not None:
            old_frame, old_at, old_image, prior = self._previous
            if old_image.shape != gray.shape:
                status = "image-geometry-changed"
            elif frame.get("token") is not None and frame.get("token") == old_frame.get("token"):
                self._reset(); return result("duplicate-frame")
            elif t_ms <= old_at or abs((t_ms-old_at)-(frame["timestampUs"]-old_frame["timestampUs"])/1000) > 1.:
                self._reset(); return result("stream-clock-mismatch")
            else:
                pair, pose = base.pose_pair(old_frame, frame, w, h)
                q["pose"] = pose; status = pose["status"]
                if pair is not None:
                    homography = pair.homography
                elif status == "epipolar-baseline-too-small" and pose["translationM"] < base.POLICY["maxNearRotationBaselineM"]:
                    k = frame["intrinsics"]
                    rotation = frame["cameraToWorld"][:3,:3].T @ old_frame["cameraToWorld"][:3,:3]
                    homography = k @ rotation @ np.linalg.inv(k); status = "valid"
                if homography is not None:
                    valid, bg = base._background(pair, homography, old_image, gray, [p.box for p in prior], boxes)
                    q["background"] = bg
                    ambiguous = self._update_common_scale(t_ms, bg)
                    if not valid or ambiguous:
                        homography = None
                        status = "scale-ambiguous" if ambiguous else "insufficient-background-agreement"
            if homography is None:
                self._reset(); prior = []

        # Geometric association has no dependence on any cohort's survival.
        links = window._best_links(prior, boxes, homography, {}) if homography is not None else {}
        native_pair = native is not None and self._native is not None and self._native.shape == raw.shape
        old_raw = self._native if native_pair else old_image
        pair_transform = transform if native_pair else np.eye(3)
        active = []; tracks = []; events = []; retired_count = 0; seeded_count = 0; kept_count = 0
        linked_old = set()
        for j, box in enumerate(boxes):
            others = [b for index, b in enumerate(boxes) if index != j]
            appearance = _appearance(raw, box, transform)
            old = prior[links[j]] if j in links else None
            corr = _correlation(old.appearance, appearance) if old is not None else None
            kept = corr is not None and corr >= POLICY["identityPatchCorrelation"]
            small = window._too_small(box.xyxy, gray.shape, native)
            identity_field = None
            identity_reason = "fresh-appearance-and-reciprocal-box" if kept else "new-or-appearance-unverified"
            probe = {"attempted": False}
            if (not kept and old is not None and not small
                    and not window._too_small(old.box.xyxy, gray.shape,
                                              pair_transform if native_pair else None)):
                # A detector rectangle can change how a coarse appearance ROI
                # is sampled even when actual pixels still identify the object.
                # This disposable one-pair certificate starts from PREVIOUS
                # exposure pixels, never an aged measurement population. Its
                # points/time/history are not inserted into any cohort.
                probe["attempted"] = True
                probe.update(previousMs=old_at, currentMs=t_ms)
                previous_others = [o.box for index, o in enumerate(prior) if index != links[j]]
                seeds = self._new_points(old_raw, old.box.xyxy, previous_others, pair_transform)
                probe["seedPoints"] = 0 if seeds is None else len(seeds)
                if seeds is not None:
                    identity_field, failure = self._field(old_raw, raw if native_pair else gray,
                                                          old.box, box, pair_transform)
                    if identity_field is not None:
                        disposable = window.Tube(old.box, old.id, seeds, len(seeds), deque())
                        matched, failure = self._cohort_flow(identity_field, Cohort(0, old_at, disposable),
                                                             box, homography, others)
                        probe["supportedPoints"] = 0 if matched is None else len(matched[1])
                        if matched is not None:
                            kept = True
                            identity_reason = "fresh-one-pair-pixel-identity"
                    probe["reason"] = failure
                else:
                    probe["reason"] = "insufficient-identity-seeds"
            if kept:
                identity = Identity(old.id, box, appearance, old.born, old.last_seed, [])
                linked_old.add(links[j]); kept_count += 1
            else:
                identity = Identity(self._next_id, box, appearance, t_ms, -float("inf"), [])
                self._next_id += 1
            key = str(identity.id)
            q["identityDecisions"][key] = {"kept": bool(kept), "appearanceCorrelation": corr,
                "reason": identity_reason, "freshPair": probe, "ageMs": t_ms-identity.born}
            retired = []; measurements = []; reason = "new-identity"
            field = None
            if kept and old.cohorts and not small:
                if identity_field is not None:
                    field = identity_field
                else:
                    field, reason = self._field(old_raw, raw if native_pair else gray, old.box, box, pair_transform)
            for cohort in old.cohorts if kept else ():
                age = t_ms-cohort.born
                if small:
                    failure = "small-or-truncated"
                elif age > POLICY["maxWindowMs"]:
                    failure = "cohort-expired"
                elif field is None:
                    failure = reason
                else:
                    answer, failure = self._cohort_flow(field, cohort, box, homography, others)
                    if answer is not None:
                        indexes, points = answer
                        history = deque(((at, p[indexes], size) for at, p, size in cohort.tube.history),
                                        maxlen=POLICY["maxHistory"])
                        history.append((t_ms, points.copy(), base._size(box.xyxy)))
                        tube = window.Tube(box, identity.id, points, cohort.tube.initial, history)
                        current = Cohort(cohort.id, cohort.born, tube)
                        evidence = self._cumulative_evidence(tube, frame["intrinsics"])
                        identity.cohorts.append(current)
                        measurements.append((current, evidence))
                        continue
                retired.append({"cohortId": cohort.id, "ageMs": age, "reason": failure})

            # Resolve disagreement before rotating cohorts: lifecycle cleanup
            # must never erase a conflicting current measurement to allow alert.
            conflict = any("angularLogGrowth" in e and
                           (e["currentAngularLogGrowth"] <= 0 or e["robustPointGrowth"] <= 0
                            or e["robustBoxGrowth"] <= 0 or e["angularLogMad"] > POLICY["maxAngularLogMad"]
                            or abs(e["robustPointGrowth"]-e["robustBoxGrowth"]) > POLICY["maxGrowthDisagreement"])
                           for c, e in measurements if t_ms-c.born >= POLICY["minWindowMs"]
                           and len(c.tube.history) >= POLICY["minFrames"])
            # A finite seed cohort is renewed, never patched into an old path.
            due = t_ms-identity.last_seed >= POLICY["seedCadenceMs"]
            if due and not small:
                if len(identity.cohorts) >= POLICY["maxCohortsPerIdentity"]:
                    oldest = min(identity.cohorts, key=lambda c: c.born)
                    # Merely being 320ms old does not establish enough growth.
                    # Do not discard a slow, still valid measurement in favour
                    # of a younger cohort that has not yet passed its floors.
                    if any(c.id != oldest.id and e["confirmed"] for c, e in measurements):
                        identity.cohorts.remove(oldest)
                        measurements = [(c, e) for c, e in measurements if c.id != oldest.id]
                        retired.append({"cohortId": oldest.id, "ageMs": t_ms-oldest.born, "reason": "cohort-rotation"})
                if len(identity.cohorts) < POLICY["maxCohortsPerIdentity"]:
                    new = self._seed_cohort(identity, raw, transform, others, t_ms)
                    identity.last_seed = t_ms
                    if new is not None:
                        identity.cohorts.append(new); seeded_count += 1
            if small:
                reason = "small-or-truncated"
            confirmed = [(c, e) for c, e in measurements if e["confirmed"]]
            if confirmed and not conflict:
                selected, evidence = max(confirmed, key=lambda ce: ce[1]["observationMs"])
                reason = "cohort-expansion-supported"
                events.append({"kind": "relative-optical-approach", "trackId": identity.id, "label": box.label,
                    "epoch": self.epoch, "timeMs": t_ms, "observationMs": evidence["observationMs"],
                    "angularLogGrowth": evidence["angularLogGrowth"], "points": len(selected.tube.points),
                    "supportingCohortIds": [selected.id]})
                q["windowEvidence"][key] = {**evidence, "supportingCohortIds": [selected.id]}
            else:
                reason = "cohort-disagreement" if conflict else ("no-supported-mature-cohort" if kept else reason)
                q["windowEvidence"][key] = {"confirmed": False, "reason": reason}
            evidence_by_id = {c.id: e for c, e in measurements}
            q["cohorts"][key] = [{"cohortId": c.id, "bornMs": c.born, "ageMs": t_ms-c.born,
                "initialPoints": c.tube.initial, "currentPoints": len(c.tube.points),
                "validSamples": len(c.tube.history), "lastMs": c.tube.history[-1][0],
                "mature": bool(t_ms-c.born >= POLICY["minWindowMs"] and len(c.tube.history) >= POLICY["minFrames"]),
                "confirmed": bool(evidence_by_id.get(c.id, {}).get("confirmed", False)),
                "reason": evidence_by_id.get(c.id, {}).get("reason", "new-cohort")}
                for c in identity.cohorts]
            q["retiredCohorts"][key] = retired; retired_count += len(retired)
            q["trackReasons"][key] = reason
            active.append(identity); tracks.append({"id": identity.id, **box.record(w, h)})

        # No missing-detection coasting: unobserved objects and all their cohorts
        # are retired. A later detection must establish a new measurement age.
        q["unobservedIdentityIds"] = [old.id for i, old in enumerate(prior) if i not in linked_old]
        q["identityRetirements"] = [{"id": old.id, "reason": "not-currently-reidentified",
            "cohortCount": len(old.cohorts)} for i, old in enumerate(prior) if i not in linked_old]
        retired_count += sum(r["cohortCount"] for r in q["identityRetirements"])
        q["bounds"] = {"identityCount": len(active), "cohortCount": sum(len(o.cohorts) for o in active),
            "cohortPoints": sum(len(c.tube.points) for o in active for c in o.cohorts),
            "retainedIdentityCount": kept_count, "retiredCohortCount": retired_count,
            "seededCohortCount": seeded_count}
        self._previous = frame, t_ms, gray.copy(), active
        self._native = raw.copy() if native is not None else None
        return result(status, q, tracks, events)
