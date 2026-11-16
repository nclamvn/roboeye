"""Analytic geometry controls, not physical accuracy or held-out motion truth."""

import math
from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from assist_scene_pose_motion import POLICY, point_residuals, pose_pair, pose_warp


W, H = 640, 480
K = np.array([[500., 0, 320], [0, 500., 240], [0, 0, 1]])


def rotation(axis, degrees):
    a = math.radians(degrees)
    c, s = math.cos(a), math.sin(a)
    if axis == "z":
        return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1.]])
    if axis == "y":
        return np.array([[c, 0, s], [0, 1., 0], [-s, 0, c]])
    return np.array([[1., 0, 0], [0, c, -s], [0, s, c]])


def frame(stamp, *, rot=None, center=(0., 0., 0.), k=K, skew=0):
    pose = np.eye(4)
    if rot is not None:
        pose[:3, :3] = rot
    pose[:3, 3] = center
    return {"timestampUs": stamp, "poseTimestampUs": stamp+skew, "intrinsics": k.tolist(),
            "cameraToWorld": pose.tolist(), "epoch": 3}


def project(record, xyz):
    tf = np.asarray(record["cameraToWorld"])
    camera = (xyz-tf[:3, 3]) @ tf[:3, :3]
    p = camera @ np.asarray(record["intrinsics"]).T
    return p[:, :2]/p[:, 2:3]


class PoseMotionTests(unittest.TestCase):
    def setUp(self):
        self.first, self.last = frame(1_000_000), frame(1_083_333)

    def pair(self, a, b):
        result, info = pose_pair(a, b, W, H)
        self.assertIsNotNone(result, info)
        self.assertEqual(info["status"], "valid")
        return result

    def refused(self, a, b, reason):
        result, info = pose_pair(a, b, W, H)
        self.assertIsNone(result, info)
        self.assertEqual(info["status"], reason)

    def test_exact_rotation_composition_and_projection_sign(self):
        centre = (12, 47, 52)
        a = frame(1_000_000, rot=rotation("z", 7), center=centre)
        b = frame(1_083_333, rot=rotation("z", 16), center=centre)
        xyz = np.array([[12, 47, 56], [13, 48, 57], [11.5, 45.8, 58]])
        pair = self.pair(a, b)
        self.assertEqual(pair.mode, "rotation")
        source, expected = project(a, xyz), project(b, xyz)
        residual, usable = point_residuals(pair, source, expected)
        np.testing.assert_array_equal(usable, [True, True, True])
        np.testing.assert_allclose(residual, 0, atol=1e-10)
        matrix, diagnostics = pose_warp(a, b, W, H)
        self.assertEqual(diagnostics["status"], "valid")
        self.assertLess(diagnostics["maxErrorBoundPx"], 1e-10)
        np.testing.assert_allclose(source @ matrix[:, :2].T + matrix[:, 2], expected, atol=1e-10)

    def test_true_projective_yaw_has_exact_H_but_not_similarity(self):
        b = frame(1_083_333, rot=rotation("y", 8))
        points = np.array([[-.5, 0, 2], [.5, .3, 2.3], [0, .4, 4]])
        pair = self.pair(self.first, b)
        residual, usable = point_residuals(pair, project(self.first, points), project(b, points))
        self.assertTrue(usable.all())
        np.testing.assert_allclose(residual, 0, atol=1e-10)
        matrix, info = pose_warp(self.first, b, W, H)
        self.assertIsNone(matrix)
        self.assertEqual(info["status"], "projective-warp-not-global-similarity")
        self.assertGreater(info["maxErrorBoundPx"], info["maxApproxPx"])

    def test_global_bound_dominates_dense_yaw_projection_errors(self):
        b = frame(1_083_333, rot=rotation("y", .08))
        pair = self.pair(self.first, b)
        matrix, info = pose_warp(self.first, b, W, H)
        self.assertEqual(info["status"], "valid")
        a, b = np.meshgrid(np.linspace(0, W-1, 51), np.linspace(0, H-1, 49))
        x = np.column_stack((a.ravel(), b.ravel(), np.ones(a.size)))
        expected = x @ pair.homography.T
        error = np.linalg.norm(x @ matrix.T-expected[:, :2]/expected[:, 2:3], axis=1)
        self.assertLessEqual(float(error.max()), info["maxErrorBoundPx"]+1e-12)

    def test_static_points_at_different_depths_under_translation_plus_rotation(self):
        a = frame(1_000_000, rot=rotation("x", 3), center=(.2, .4, .3))
        b = frame(1_083_333, rot=rotation("y", 4), center=(.5, .43, .7))
        xyz = np.array([[-.3, 1, 3], [1.1, .4, 7], [2.7, -.4, 33]])
        pair = self.pair(a, b)
        self.assertEqual(pair.mode, "epipolar")
        p0, p1 = project(a, xyz), project(b, xyz)
        residual, usable = point_residuals(pair, p0, p1)
        self.assertTrue(usable.all())
        np.testing.assert_allclose(residual, 0, atol=1e-10)
        self.assertEqual(np.linalg.matrix_rank(pair.fundamental), 2)
        matrix, info = pose_warp(a, b, W, H)
        self.assertIsNone(matrix)
        self.assertEqual(info["status"], "translation-needs-epipolar")

    def test_lateral_translation_detects_only_cross_line_displacement(self):
        pair = self.pair(self.first, frame(1_083_333, center=(.3, 0, 0)))
        # Lateral translation produces horizontal static epipolar lines.
        source = [[330, 220], [330, 220]]
        result, usable = point_residuals(pair, source, [[140, 220], [318, 233]])
        self.assertTrue(usable.all())
        np.testing.assert_allclose(result, [0, 13], atol=1e-10)
        self.assertLess(result[0], pair.floor_px)
        self.assertGreater(result[1], pair.floor_px)

    def test_forward_translation_epipole_near_points_refused(self):
        pair = self.pair(self.first, frame(1_083_333, center=(0, 0, .4)))
        res, usable = point_residuals(pair, [[320, 240], [322, 242], [380, 240]],
                                            [[335, 260], [372, 240], [410, 240]])
        np.testing.assert_array_equal(usable, [False, False, True])
        self.assertTrue(np.isnan(res[:2]).all())
        self.assertLess(res[2], 1e-10)

    def test_tiny_translation_is_neither_rotation_nor_good_epipolar(self):
        self.refused(self.first, frame(1_083_333, center=(.004, 0, 0)), "epipolar-baseline-too-small")
        self.refused(self.first, frame(1_083_333, center=(10, 0, 0)), "pose-translation-too-large")

    def test_timestamp_absence_nonmonotonic_interval_or_stale_pose(self):
        self.refused(self.first, {k:v for k,v in self.last.items() if k!="poseTimestampUs"}, "missing-frame-pose")
        self.refused(self.first, {**self.last, "timestampUs": True}, "invalid-pose-clock")
        self.refused(self.first, {**self.last, "poseTimestampUs": 1_000_000}, "pose-interval")
        self.refused(self.first, frame(1_064_999), "pose-interval")
        self.refused(self.first, frame(1_300_001), "pose-interval")
        self.refused(self.first, frame(1_083_333, skew=-20_001), "pose-skew")
        self.refused(self.first, frame(1_083_333, skew=20_001), "pose-skew")
        self.pair(self.first, frame(1_065_000, skew=20_000))

    def test_sync_uncertainty_floor_increases_with_known_rotation_and_skew(self):
        pure = self.pair(self.first, frame(1_083_333, rot=rotation("z", 6)))
        skewed = self.pair(self.first, frame(1_083_333, rot=rotation("z", 6), skew=15_000))
        self.assertGreater(skewed.floor_px, pure.floor_px)
        self.assertGreaterEqual(pure.floor_px, POLICY["minFloorPixels"])

    def test_pose_epoch_calibration_and_bad_transform_rejected(self):
        self.refused(self.first, {**self.last, "epoch": 4}, "pose-epoch-mismatch")
        self.refused(self.first, {k:v for k,v in self.last.items() if k!="epoch"}, "pose-epoch-mismatch")
        zoom = K.copy()
        zoom[0, 0] = 550
        self.refused(self.first, frame(1_083_333, k=zoom), "calibration-changed")
        self.refused(self.first, {**self.last, "intrinsics": None}, "invalid-intrinsics")
        reflected = np.eye(3)
        reflected[0, 0] = -1
        self.refused(self.first, frame(1_083_333, rot=reflected), "invalid-camera-transform")
        self.refused(self.first, frame(1_083_333, rot=rotation("z", 30)), "pose-rotation-too-large")
        self.refused(self.first, {**self.last, "cameraToWorld": [[1, 0]]}, "invalid-camera-transform")
        self.refused(self.first, frame(1_083_333, center=(float("nan"), 0, 0)), "invalid-camera-transform")

    def test_bad_correspondences_fail_closed_per_point(self):
        pair = self.pair(self.first, self.last)
        res, usable = point_residuals(pair, [[321, 243], [-1, 14], [25, 16]],
                                            [[321, 243], [15, 14], [float("nan"), 16]])
        np.testing.assert_array_equal(usable, [True, False, False])
        self.assertEqual(res[0], 0.)
        self.assertTrue(np.isnan(res[1:]).all())
        self.assertEqual(point_residuals(pair, [[3, 4]], [[1]])[0].size, 0)
        self.assertEqual(point_residuals(pair, [[3, 4]] * 257, [[3, 4]] * 257)[0].size, 0)


if __name__ == "__main__":
    unittest.main()
