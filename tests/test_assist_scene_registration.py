"""Synthetic rendering controls for the causal high-rate RGB warp."""

import sys
from pathlib import Path
from unittest.mock import patch
import unittest

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from assist_scene_motion import Detection
from assist_scene_registration import BackgroundChain


W, H = 480, 300


def texture(seed, shape=(H, W)):
    source = np.random.default_rng(seed).integers(0, 255, size=shape, dtype=np.uint8)
    return cv2.GaussianBlur(source, (5, 5), 0)


def translate(image, x, y=0):
    return cv2.warpAffine(image, np.array([[1., 0., x], [0., 1., y]]), (W, H))


class TestCausalChain(unittest.TestCase):
    def test_two_masks_preserve_background_during_object_motion(self):
        source = texture(6144)
        actor = texture(906, (110, 95))
        chain = BackgroundChain()
        for i in range(6):
            gray = translate(source, i*5, -i*2)
            x = 100 + 8*i
            gray[80:190, x:x+95] = actor
            boxes = [Detection("bus", .9, (x, 80, x+95, 190))] if i in (0, 5) else None
            matrix, q = chain.push(gray, i*40, boxes)
            if i in (1, 2, 3, 4):
                self.assertIsNone(matrix)
                self.assertIsNotNone(chain.last_step)
        self.assertEqual(q["status"], "valid")
        self.assertEqual(q["chainSteps"], 5)
        self.assertFalse(q["rejectedSteps"])
        np.testing.assert_allclose(matrix, [[1., 0., 25], [0., 1., -10]], atol=.45)

    def test_a_cut_mid_interval_cannot_be_bridged_by_matching_endpoints(self):
        a, b = texture(707), texture(344)
        chain = BackgroundChain()
        chain.push(a, 0, [])
        chain.push(b, 40)
        self.assertIsNone(chain.last_step)
        self.assertGreater(chain.epoch, 0)
        chain.push(a, 80)
        self.assertIsNone(chain.last_step)
        matrix, q = chain.push(a, 120, [])
        self.assertIsNone(matrix)
        self.assertEqual(q["status"], "interrupted-chain")
        self.assertIsNotNone(chain.push(a, 160, [])[0])

    def test_separate_regional_warps_do_not_authorize_a_single_plane(self):
        a = texture(12)
        b = translate(a, 2)
        # A full grid cell belongs to a different image plane; the larger
        # plane alone would still clear the global inlier ratio.
        b[:130, :145] = translate(a, -7)[:130, :145]
        chain = BackgroundChain()
        chain.push(a, 0, [])
        matrix, q = chain.push(b, 40, [])
        self.assertIsNone(matrix)
        self.assertIsNone(chain.last_step)
        self.assertEqual(q["step"]["status"], "regional-warp-disagreement")

    def test_sparse_model_disagreement_is_veto_without_fallback(self):
        a = texture(121)
        b = translate(a, 2)
        chain = BackgroundChain()
        chain.push(a, 0, [])
        with patch("assist_scene_registration.registered", return_value=(np.array([[1., 0., 13.], [0., 1., 0.]]), {"status":"valid"})):
            matrix, q = chain.push(b, 40, [])
        self.assertIsNone(matrix)
        self.assertEqual(q["status"], "endpoint-model-disagreement")
        self.assertIsNone(chain.last_step)

    def test_gap_and_foreground_coverage_abstain(self):
        a = texture(121)
        chain = BackgroundChain()
        chain.push(a, 0, [])
        matrix, q = chain.push(a, 80, [])
        self.assertIsNone(matrix)
        self.assertEqual(q["step"]["status"], "source-time-discontinuity")

        chain = BackgroundChain()
        full = [Detection("bus", .9, (0, 0, W-5, H-5))]
        chain.push(a, 0, full)
        self.assertIsNone(chain.push(a, 40)[0])
        self.assertIsNone(chain.last_step)
        matrix, q = chain.push(a, 80, [])
        self.assertIsNone(matrix)
        self.assertEqual(q["rejectedSteps"][0]["reason"], "insufficient-background")


if __name__ == "__main__":
    unittest.main()
