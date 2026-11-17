"""Authored tiny structural fixtures, not actual M3W renders/quality evidence."""
import copy
import importlib.util
import tempfile
import unittest
from datetime import date
from pathlib import Path

import numpy as np

SPEC = importlib.util.spec_from_file_location("m3w_controls", Path(__file__).resolve().parents[1] / "scripts/assist_scene_m3w_controls.py")
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)


class ControlsTests(unittest.TestCase):
    def test_fixed_inventory_and_holdout_are_not_reselected(self):
        self.assertEqual(len(m.MOTIONS), 6)
        self.assertNotEqual(m.planes("analysis"), m.planes("holdout"))
        self.assertEqual(m.planes("holdout")[0]["boundsXY"], [.35, -1.3, 2, 1.5])
        self.assertEqual(m.OFFSETS_US, [-40000, -10000, 10000, 40000])
        self.assertTrue(all(np.isfinite(p["z"]) for p in m.planes("analysis")))

    def test_identity_and_hardcoded_lateral_pose(self):
        p = m.pose(m.trajectory("analysis", "stationary"), m.TARGET_US)
        np.testing.assert_array_equal(p["cameraToWorld"], np.eye(4))
        p = m.pose(m.trajectory("analysis", "lateral"), m.TARGET_US)
        self.assertAlmostEqual(p["cameraToWorld"][0][3], .04)
        self.assertEqual(p["poseTimestampUs"], m.TARGET_US)

    def test_constant_body_twist_has_group_increments(self):
        s = m.trajectory("analysis", "constant-body-twist")
        t0, t1, t2 = [np.array(m.pose(s, t)["cameraToWorld"]) for t in (960000, 1060000, 1160000)]
        np.testing.assert_allclose(np.linalg.inv(t0) @ t1, np.linalg.inv(t1) @ t2, atol=2e-15)
        naive = np.asarray(s["bodyLinear"]) * .16
        self.assertGreater(np.linalg.norm(t2[:3, 3]-naive), 1e-4)

    def test_polynomial_motion_changes_group_increment(self):
        s = m.trajectory("analysis", "accelerating")
        ts = [np.array(m.pose(s, t)["cameraToWorld"]) for t in (1000000, 1100000, 1200000)]
        self.assertGreater(np.max(np.abs(np.linalg.inv(ts[0]) @ ts[1]-np.linalg.inv(ts[1]) @ ts[2])), .01)

    def test_all_fixed_clock_poses_are_rigid_and_have_true_timestamps(self):
        for split in ("analysis", "holdout"):
            for motion in m.MOTIONS:
                for stamp in (960000, 990000, 1000000, 1010000, 1040000, 1060000, 1090000, 1100000, 1110000, 1140000):
                    p = m.pose(m.trajectory(split, motion), stamp)
                    t = np.asarray(p["cameraToWorld"])
                    np.testing.assert_allclose(t[:3, :3].T @ t[:3, :3], np.eye(3), atol=3e-15)
                    self.assertAlmostEqual(np.linalg.det(t[:3, :3]), 1.)
                    self.assertEqual(p["poseTimestampUs"], stamp)

    def test_nominal_lateral_positive_is_not_baseline_ray_degenerate(self):
        # .025 is sin(ray, baseline), not sin(two viewing rays). At the
        # principal ray lateral translation is perpendicular, and far-plane
        # image displacement remains above the frozen1.3pixel floor.
        for split in ("analysis", "holdout"):
            t = np.asarray(m.pose(m.trajectory(split, "lateral"), m.TARGET_US)["cameraToWorld"])
            dx = abs(t[0, 3])*m.K[0][0]/m.planes(split)[-1]["z"]
            self.assertGreater(dx, 1.3)
            self.assertEqual(t[2, 3], 0)

    def test_nearest_positive_finite_plane_and_infinite_xy_background(self):
        ps = [{"id": "box", "z": 2, "boundsXY": [-.2, -.2, .2, .2]}, {"id": "far", "z": 4, "boundsXY": None}, {"id": "behind", "z": -1, "boundsXY": None}]
        ids, world = m.cast(ps, np.eye(4), [3, 3], [[1, 0, 1], [0, 1, 1], [0, 0, 1]])
        self.assertEqual(ids[1, 1], 0)
        self.assertEqual(ids[0, 0], 1)
        np.testing.assert_array_equal(world[1, 1], [0, 0, 2])
        np.testing.assert_array_equal(world[0, 0], [-4, -4, 4])

    def test_bilinear_material_sampling_tiny_fixture(self):
        tex = np.array([[[0, 0, 0], [100, 100, 100]], [[200, 200, 200], [100, 100, 100]]], dtype=np.uint8)
        ps = [{"id": "flat", "z": 2, "boundsXY": None, "uvScale": [0, 0], "uvOffset": [.5, .5]}]
        out = m.render(tex, ps, np.eye(4), [2, 2], [[1, 0, 0], [0, 1, 0], [0, 0, 1]])
        np.testing.assert_array_equal(out, np.full((2, 2, 3), 100, dtype=np.uint8))

    def test_publication_rejects_wrong_plan_before_output(self):
        with tempfile.TemporaryDirectory(prefix=f"codex-tmp-m3w-{date.today():%Y%m%d}-") as tmp:
            plan, out = Path(tmp)/"p.json", Path(tmp)/"generated"
            m.write_json(plan, {"wrong": "fixture"})
            with self.assertRaisesRegex(ValueError, "Plan seal"):
                m.publish(plan, "0"*64, out)
            self.assertFalse(out.exists())


if __name__ == "__main__":
    unittest.main()
