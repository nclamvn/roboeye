import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from assist_scene_camera_guard import CameraScaleGuard
from assist_scene_motion_m3b import present


class TestCameraScaleGuard(unittest.TestCase):
    def test_expansion_and_zoom_out_fail_closed(self):
        for scale in (1.045, .956):
            with self.subTest(scale=scale):
                guard = CameraScaleGuard()
                self.assertFalse(guard.update(200, scale))
                self.assertTrue(guard.update(400, scale))
                self.assertTrue(guard.update(600, scale))

    def test_oscillation_gap_and_missing_model_never_reuse_evidence(self):
        guard = CameraScaleGuard()
        self.assertFalse(guard.update(0, 1.06))
        self.assertFalse(guard.update(200, 1/1.06))
        self.assertFalse(guard.update(800, 1.06))
        self.assertFalse(guard.update(1000, None))
        self.assertFalse(guard.update(1200, 1.06))
        self.assertTrue(guard.update(1400, 1.06))
        self.assertFalse(guard.update(1400, 1.06))

    def test_stale_candidate_is_not_restamped(self):
        tracker = type("Tracker", (), {"epoch": 3})()
        old = {"trackId": 7, "label": "bus", "timeMs": 400, "epoch": 2}
        track = {"id": 7, "label": "bus"}
        self.assertEqual(present(True, tracker, 600, [track], [old])["events"], [])


if __name__ == "__main__":
    unittest.main()
