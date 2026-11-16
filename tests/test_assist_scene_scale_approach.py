"""Authored synthetic mechanisms, not a detector/phone performance benchmark."""

from copy import deepcopy
import json
import math
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/"scripts"))
from assist_scene_motion import Detection
from assist_scene_scale_approach import POLICY, ScaleApproach, _local_evidence


W, H = 480, 360
K = [[330, 0, W/2], [0, 330, H/2], [0, 0, 1]]
X, Y = 255., 155.


def texture(seed, shape):
    array = np.random.default_rng(seed).integers(0, 256, shape, np.uint8)
    return cv2.GaussianBlur(array, (5, 5), .9)


BG = texture(20261114, (H, W))
OBJ = texture(651504, (115, 105))


def warp(img, scale, center):
    matrix = cv2.getRotationMatrix2D(center, 0., scale)
    return cv2.warpAffine(img, matrix, (W, H), borderMode=cv2.BORDER_REFLECT101)


def scene(scale=1., *, box_scale=None, x=X, y=Y, background=None, label="car", occluded=False):
    background = BG if background is None else background
    bw, bh = 82*scale, 87*scale
    left, top, right, bottom = map(round, (x-bw/2, y-bh/2, x+bw/2, y+bh/2))
    img = background.copy()
    src = cv2.resize(OBJ, (right-left, bottom-top), interpolation=cv2.INTER_LINEAR)
    if occluded:
        src[:, :src.shape[1]*2//3] = 127
    lx, ly, rx, ry = max(0, left), max(0, top), min(W, right), min(H, bottom)
    img[ly:ry, lx:rx] = src[ly-top:ry-top, lx-left:rx-left]
    bs = scale if box_scale is None else box_scale
    bw, bh = 82*bs, 87*bs
    return img, Detection(label, .92, (max(0, x-bw/2), max(0, y-bh/2), min(W, x+bw/2), min(H, y+bh/2)))


def frame(i, translation=(0., 0., 0.), *, intrinsics=None, skew=0, epoch=None):
    pose = np.eye(4)
    pose[:3, 3] = translation
    at = 2_000_000+i*100_000
    result = {"token": f"source-{i}", "timestampUs": at, "poseTimestampUs": at+skew,
              "cameraToWorld": pose.tolist(), "intrinsics": deepcopy(K if intrinsics is None else intrinsics)}
    if epoch is not None:
        result["epoch"] = epoch
    return result


def run(state, i, *, scale=1., boxes=None, metadata=None, **scene_kw):
    img, obj = scene(scale, **scene_kw)
    return state.update(frame(i) if metadata is None else metadata, 100*i, img, [obj] if boxes is None else boxes)


class M3DScaleApproachTests(unittest.TestCase):
    def setUp(self):
        cv2.setNumThreads(1)
        cv2.setRNGSeed(6504)
        self.state = ScaleApproach()

    def test_local_real_growth_needs_three_current_pairs_and_preserves_no_metric_contract(self):
        results = [run(self.state, i, scale=1.04**i) for i in range(5)]
        self.assertEqual([len(item["events"]) for item in results], [0, 0, 0, 1, 1], results)
        event = results[-1]["events"][0]
        self.assertEqual(event["kind"], "relative-optical-approach")
        self.assertEqual(event["epoch"], results[-1]["epoch"])
        self.assertEqual(event["timeMs"], 400)
        self.assertEqual(event["trackId"], results[-1]["tracks"][0]["id"])
        self.assertEqual(event["label"], "car")
        self.assertGreaterEqual(event["pointLogGrowth"], POLICY["minNetLogGrowth"])
        self.assertNotIn("metres", json.dumps(results, allow_nan=False))

    def test_static_and_detector_only_size_jitter_never_confirm(self):
        for i, bs in enumerate([1., 1., 1.03, .97, 1.10, 1.15, 1.20, 1.26]):
            result = run(self.state, i, box_scale=bs)
            self.assertEqual(result["events"], [])
            if i:
                self.assertEqual(result["status"], "valid")

    def test_image_points_expand_but_unconfirmed_detector_box_never_confirms(self):
        for i in range(5):
            result = run(self.state, i, scale=1.04**i, box_scale=1.)
            self.assertEqual(result["events"], [])

    def test_lateral_motion_has_no_expansion_event(self):
        for i in range(5):
            result = run(self.state, i, x=X+5*i)
            self.assertEqual(result["events"], [])

    def test_known_intrinsics_change_is_rejected_even_with_growth(self):
        run(self.state, 0)
        zoomed = deepcopy(K)
        zoomed[0][0] *= 1.04
        zoomed[1][1] *= 1.04
        result = run(self.state, 1, scale=1.04, metadata=frame(1, intrinsics=zoomed))
        self.assertEqual(result["status"], "calibration-changed")
        self.assertEqual(result["events"], [])

    def test_global_zoom_with_nominally_unchanged_pose_is_vetoed(self):
        for i in range(6):
            s = 1.037**i
            image, box = scene()
            img = warp(image, s, (W/2, H/2))
            b = Detection(box.label, box.score, tuple(v*s + (1-s)*c for v,c in zip(box.xyxy, (W/2,H/2,W/2,H/2))))
            result = self.state.update(frame(i), 100*i, img, [b])
            self.assertFalse(result["events"])
            if i:
                self.assertIn(result["status"], {"scale-ambiguous", "insufficient-background-agreement"})

    def test_slow_global_zoom_cannot_accumulate_votes_under_forward_pose(self):
        for i in range(9):
            s = 1.012**i
            image, box = scene()
            img = warp(image, s, (W/2, H/2))
            b = Detection(box.label, box.score, tuple(v*s + (1-s)*c for v,c in zip(box.xyxy, (W/2,H/2,W/2,H/2))))
            result = self.state.update(frame(i, (0.,0.,.06*i)), 100*i, img, [b])
            self.assertFalse(result["events"], result)

    def test_camera_forward_different_depths_does_not_force_global_scale_veto(self):
        results = []
        for i in range(5):
            delta = .10*i
            near, far = 4.2/(4.2-delta), 9.5/(9.5-delta)
            bg = warp(BG, near, (W/2, H/2))
            bg[:, W//2:] = warp(BG, far, (W/2,H/2))[:, W//2:]
            s = 2.9/(2.9-delta)
            results.append(run(self.state, i, scale=s, background=bg, x=W/2+(X-W/2)*s,
                               y=H/2+(Y-H/2)*s, metadata=frame(i, (0., 0., delta))))
        self.assertEqual([v["status"] for v in results], ["first-frame"]+["valid"]*4, results)
        self.assertTrue(results[-1]["events"], results)

    def test_small_pose_baseline_with_independently_static_background_uses_near_static_control(self):
        for i in range(4):
            result = run(self.state, i, scale=1.04**i, metadata=frame(i, (.005*i, 0., 0.)))
        self.assertEqual(result["status"], "valid")
        self.assertEqual(result["diagnostics"]["pose"]["control"], "near-static-rotation")
        self.assertTrue(result["events"], result)

    def test_no_static_control_missing_pose_and_timestamp_skew_fail_closed(self):
        for i in range(4):
            result = run(self.state, i, scale=1.04**i, background=np.zeros_like(BG))
        self.assertEqual(result["status"], "insufficient-background-agreement")
        self.assertFalse(result["events"])
        absent = frame(4)
        del absent["cameraToWorld"]
        result = run(self.state, 4, metadata=absent)
        self.assertEqual(result["status"], "missing-frame-pose")
        run(self.state, 5)
        result = run(self.state, 6, metadata=frame(6, skew=30_000))
        self.assertEqual(result["status"], "pose-skew")
        self.assertFalse(result["events"])

    def test_scene_cut_clears_history_even_with_matching_pose_and_detector_box(self):
        for i in range(4):
            result = run(self.state, i, scale=1.04**i)
        self.assertTrue(result["events"])
        cut = run(self.state, 4, scale=1.04**4, background=texture(339601, (H, W)))
        self.assertFalse(cut["events"])
        self.assertGreater(cut["epoch"], result["epoch"])
        self.assertEqual(cut["status"], "insufficient-background-agreement")

    def test_lost_box_or_no_current_growth_cannot_hold_the_notice(self):
        for i in range(4):
            result = run(self.state, i, scale=1.04**i)
        self.assertTrue(result["events"])
        self.assertFalse(run(self.state, 4, scale=1.04**3)["events"])
        self.assertFalse(run(self.state, 5, scale=1.04**4, boxes=[])["events"])
        self.assertFalse(run(self.state, 6, scale=1.04**5)["events"])
        self.assertFalse(run(self.state, 7, scale=1.04**6)["events"])

    def test_border_and_overlapping_detections_are_censored(self):
        for i in range(4):
            border = run(self.state, i, scale=1.04**i, x=22)
            self.assertFalse(border["events"])
            self.assertIn("small-or-truncated", border["diagnostics"]["trackReasons"].values())
        self.state = ScaleApproach()
        for i in range(4):
            img, box = scene(1.04**i)
            overlapping = Detection("person", .9, box.xyxy)
            result = self.state.update(frame(i), 100*i, img, [box, overlapping])
            self.assertFalse(result["events"])
            self.assertIn("overlap-occlusion-ambiguous", result["diagnostics"]["trackReasons"].values())

    def test_same_class_competing_associations_refuse_both_labels(self):
        run(self.state, 0)
        img, box = scene(1.04)
        competitor = Detection("car", .9, tuple(v+3 if j%2==0 else v for j,v in enumerate(box.xyxy)))
        result = self.state.update(frame(1), 100, img, [box, competitor])
        self.assertFalse(result["events"])
        self.assertEqual(set(result["diagnostics"]["trackReasons"].values()), {"association-ambiguous"})

    def test_big_partial_occlusion_breaks_photometric_flow_and_no_stale_notice(self):
        for i in range(4):
            result = run(self.state, i, scale=1.04**i)
        self.assertTrue(result["events"])
        blocked = run(self.state, 4, scale=1.04**4, occluded=True)
        self.assertFalse(blocked["events"], blocked)

    def test_dropped_roi_seeds_are_not_erased_from_occlusion_denominator(self):
        img, box = scene()
        newer, new_box = scene(1.04)
        xx, yy = np.meshgrid(np.linspace(230, 280, 6), np.linspace(130, 180, 6))
        starts = np.stack((xx, yy), axis=-1).astype(np.float32).reshape(-1,1,2)
        ends = (starts-[X,Y])*1.04+[X,Y]
        success = np.r_[np.ones(24), np.zeros(12)].astype(np.uint8).reshape(-1,1)
        # 24 widespread, perfectly growing survivors look unanimous if the
        # disappeared third is ignored. This must refuse before fitting.
        with patch("assist_scene_scale_approach.cv2.goodFeaturesToTrack", return_value=starts), \
             patch("assist_scene_scale_approach.cv2.calcOpticalFlowPyrLK", return_value=(ends,success,None)):
            evidence, reason = _local_evidence(img, newer, box.xyxy, new_box.xyxy, box.xyxy, np.eye(3))
        self.assertIsNone(evidence)
        self.assertEqual(reason, "insufficient-object-flow")

    def test_duplicate_gap_and_epoch_changes_do_not_reuse_stale_hysteresis(self):
        first = run(self.state, 0)
        repeated = self.state.update(frame(0), 100, BG, [])
        self.assertEqual(repeated["status"], "duplicate-frame")
        self.assertGreater(repeated["epoch"], first["epoch"])
        self.assertEqual(run(self.state, 1)["status"], "first-frame")
        gap = run(self.state, 8)
        self.assertEqual(gap["status"], "pose-interval")
        epoch = run(self.state, 9, metadata=frame(9, epoch=2))
        self.assertEqual(epoch["status"], "pose-epoch-mismatch")
        self.assertFalse(epoch["events"])

    def test_unordered_clock_malformed_inputs_and_oversize_fail_closed(self):
        run(self.state, 0)
        mismatch = self.state.update(frame(1), 199, BG, [])
        self.assertEqual(mismatch["status"], "stream-clock-mismatch")
        self.assertFalse(mismatch["events"])
        self.assertEqual(self.state.update(frame(2), 200, BG, None)["status"], "invalid-detections")
        self.assertEqual(self.state.update(frame(2), 200, np.zeros((20, 20), np.uint8), [])["status"], "invalid-image")
        self.assertEqual(self.state.update(frame(2), math.nan, BG, [])["status"], "invalid-stream-clock")
        self.assertEqual(self.state.update(frame(2), 200, BG, [scene()[1]]*13)["status"], "invalid-detections")


if __name__ == "__main__":
    unittest.main()
