"""Deterministic synthetic controls for M3 algorithm; no actual detection."""

import sys
from pathlib import Path
import unittest

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from assist_scene_motion import Detection, MotionState, local_residual, registered


W, H = 480, 300
IDENTITY = np.array([[1., 0., 0.], [0., 1., 0.]])
PAN = np.array([[1., 0., 9.], [0., 1., -2.]])


def random_texture(seed, shape=(H, W)):
    noise = np.random.default_rng(seed).integers(0, 255, size=shape, dtype=np.uint8)
    return cv2.GaussianBlur(noise, (5, 5), 0)


def box(x, y=100, width=50, height=90, label="person"):
    return Detection(label, .9, (x, y, x+width, y+height))


class TestRegistration(unittest.TestCase):
    def test_recovers_pan_around_foreground_displacing_in_other_direction(self):
        a = random_texture(7811)
        b = cv2.warpAffine(a, PAN, (W, H))
        # The two large foreground patches induce incompatible camera changes
        # if included as background. Both boxes must be masked.
        a[80:210, 90:180] = random_texture(991, (130, 90))
        b[90:220, 170:260] = random_texture(991, (130, 90))
        matrix, info = registered(a, b, [box(90, 80, 90, 130)], [box(170, 90, 90, 130)])
        self.assertEqual(info["status"], "valid")
        self.assertGreaterEqual(info["gridCells"], 5)
        np.testing.assert_allclose(matrix, PAN, atol=.35)

    def test_textureless_cut_and_local_texture_fail_closed(self):
        a = random_texture(87)
        b = random_texture(169)
        self.assertIsNone(registered(a, b, [], [])[0])
        blank = np.full((H, W), 75, dtype=np.uint8)
        self.assertEqual(registered(blank, blank, [], [])[1]["status"], "low-texture")
        local = blank.copy()
        local[115:180, 195:285] = random_texture(74, (65, 90))
        matrix, info = registered(local, local, [], [])
        self.assertIsNone(matrix)
        self.assertIn(info["status"], {"localized-consensus", "low-texture", "too-few-consistent-points"})

    def test_near_full_box_masks_refuse_no_background(self):
        a = random_texture(17)
        full = [box(0, 0, W - 5, H - 5)]
        self.assertEqual(registered(a, a, full, full)[1]["status"], "insufficient-background")


class TestMotion(unittest.TestCase):
    def test_pan_only_counts_in_naive_not_compensated_same_identity(self):
        m = MotionState()
        known_id = m.update([box(100)], None, 0, W, H)[0][0]["id"]
        for i in range(1, 5):
            tracks, compensated, naive, bbox = m.update([box(100 + 9*i, 100 - 2*i)], PAN, 200*i, W, H)
            self.assertEqual(tracks[0]["id"], known_id)
            self.assertFalse(compensated or bbox)
            self.assertEqual(bool(naive), i >= 3)

    def test_actor_pan_against_raw_direction_preserves_compensated_change(self):
        m = MotionState()
        m.update([box(160)], None, 0, W, H)
        background = random_texture(51)
        texture = random_texture(67, (90, 50))

        def image(index):
            scene = cv2.warpAffine(background, np.array([[1., 0., 9.*index], [0., 1., -2.*index]]), (W, H))
            x, y = 160 + 3*index, 100 - 2*index
            scene[y:y+90, x:x+50] = texture
            return scene

        for i in range(1, 4):
            _, compensated, naive, bbox = m.update([box(160 + 3*i, 100 - 2*i)], PAN, 200*i, W, H,
                                                   image(i-1), image(i))
        self.assertEqual(compensated[0]["direction"], "image-left")
        self.assertEqual(naive[0]["direction"], "image-right")
        self.assertEqual(compensated[0]["trackId"], naive[0]["trackId"])
        self.assertEqual(compensated[0]["trackId"], bbox[0]["trackId"])
        self.assertGreaterEqual(compensated[0]["localEvidence"]["agreeingSteps"], 2)

    def test_frozen_foreground_plus_bbox_drift_is_diagnostic_only(self):
        m = MotionState()
        m.update([box(150)], None, 0, W, H)
        frozen = random_texture(361)
        frozen[100:190, 150:200] = random_texture(919, (90, 50))
        before = frozen
        for i in range(1, 4):
            current = cv2.warpAffine(frozen, np.array([[1., 0., 9.*i], [0., 1., -2.*i]]), (W, H))
            _, published, naive, bbox = m.update([box(150 + (9+6)*i, 100 - 2*i)], PAN, 200*i, W, H,
                                                  before, current)
            self.assertFalse(published)
            before = current
        self.assertEqual(bbox[0]["direction"], "image-right")
        self.assertTrue(naive)

    def test_no_rgb_texture_cannot_corroborate_bbox_proposal(self):
        blank = np.full((H, W), 127, dtype=np.uint8)
        self.assertIsNone(local_residual(blank, blank, box(100).xyxy, box(110).xyxy,
                                         IDENTITY, np.array([10., 0.])))
        m = MotionState()
        m.update([box(100)], None, 0, W, H)
        for i in range(1, 4):
            _, published, _, raw = m.update([box(100+10*i)], IDENTITY, 200*i, W, H)
        self.assertTrue(raw)
        self.assertFalse(published)

    def test_loss_cut_class_change_and_time_gap_cannot_republish(self):
        for action in ("cut", "loss", "class", "gap"):
            with self.subTest(action=action):
                m = MotionState()
                m.update([box(100)], None, 0, W, H)
                for i in range(1, 4):
                    _, _, _, bbox = m.update([box(100 + 8*i)], IDENTITY, 200*i, W, H)
                self.assertTrue(bbox)
                boxes = [] if action == "loss" else [box(132, label="car" if action == "class" else "person")]
                matrix = None if action == "cut" else IDENTITY
                stamps = 1000 if action == "gap" else 800
                _, comp, naive, bbox = m.update(boxes, matrix, stamps, W, H)
                self.assertFalse(comp or naive or bbox)
                tracks, comp, naive, bbox = m.update([box(135)], IDENTITY, stamps + 200, W, H)
                self.assertNotEqual(tracks[0]["id"], 1)
                self.assertFalse(comp or naive or bbox)

    def test_stationary_after_a_pulse_and_oscillation_do_not_keep_notice(self):
        m = MotionState()
        m.update([box(100)], None, 0, W, H)
        for i, x in enumerate((108, 116, 124, 124, 124), 1):
            _, _, _, bbox = m.update([box(x)], IDENTITY, 200*i, W, H)
        self.assertFalse(bbox)
        m = MotionState()
        m.update([box(100)], None, 0, W, H)
        for i, x in enumerate((110, 100, 110, 100, 110), 1):
            self.assertFalse(m.update([box(x)], IDENTITY, 200*i, W, H)[3])

    def test_same_class_ambiguous_duplicate_match_drops_identity(self):
        m = MotionState()
        m.update([box(100)], None, 0, W, H)
        tracks, comp, naive, bbox = m.update([box(98), box(102)], IDENTITY, 200, W, H)
        self.assertTrue(all(item["id"] != 1 for item in tracks))
        self.assertFalse(comp or naive or bbox)


if __name__ == "__main__":
    unittest.main()
