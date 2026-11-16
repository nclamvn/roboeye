"""Pure authored QA counts and binding tests, no model/GPU execution."""

from copy import deepcopy
from hashlib import sha256
from pathlib import Path
import sys
import unittest

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/"scripts"))
import diagnose_assist_scene_m3m_pixels as diagnosis
from assist_scene_motion import Detection


class PixelDiagnosisTests(unittest.TestCase):
    def setUp(self):
        self.image = cv2.GaussianBlur(np.random.default_rng(65099).integers(0, 256, (100, 120), np.uint8), (3, 3), .5)
        self.box = Detection("car", .9, (20., 20., 100., 80.))
        self.zero = np.zeros((100, 120, 2), np.float32)

    def test_identity_actual_pixels_pass_all_original_seeds(self):
        counts = diagnosis.analyze_population(self.image, self.image, self.box, self.zero, self.zero)
        self.assertEqual((counts["seedPoints"], counts["fbPass"], counts["nccPass"], counts["fbAndNcc"]), (64, 64, 64, 64))
        self.assertEqual(counts["nccConditionalOnFb"], 1.)

    def test_forward_backward_failure_is_separate_from_photometry(self):
        wrong = self.zero.copy(); wrong[:, :, 0] = 4.
        counts = diagnosis.analyze_population(self.image, self.image, self.box, self.zero, wrong)
        self.assertEqual(counts["fbPass"], 0); self.assertEqual(counts["nccPass"], 64)
        self.assertIsNone(counts["nccConditionalOnFb"])

    def test_photometric_texture_failure_is_not_filtered_out_of_denominator(self):
        counts = diagnosis.analyze_population(self.image, np.full_like(self.image, 127), self.box, self.zero, self.zero)
        self.assertEqual(counts["fbPass"], 64); self.assertEqual(counts["nccPass"], 0)
        self.assertEqual(counts["fbAndInteriorButLowTexture"], 64)
        self.assertEqual(counts["seedPoints"], 64)

    def test_pixel_hash_and_selector_tampering_fail_closed(self):
        fingerprint = sha256(self.image.tobytes()).hexdigest()
        row = {"height": 100, "width": 120, "workingPixelsSha256": fingerprint}
        diagnosis.verify_pixels(self.image, row, fingerprint)
        with self.assertRaises(ValueError): diagnosis.verify_pixels(self.image, row, "b"*64)
        old = {"index": 0, "token": "old", "timeMs": 0., "sourceSha256": "a"*64, "workingPixelsSha256": fingerprint}
        current = {"index": 1, "token": "now", "timeMs": 80., "sourceSha256": "b"*64, "workingPixelsSha256": fingerprint}
        selected = {"token": "old", "timeMs": 0., "sourceSha256": "a"*64}
        field = {"fieldId": "old->now", "startToken": "old", "endToken": "now", "startMs": 0., "endMs": 80.,
            "startSha256": "a"*64, "endSha256": "b"*64, "modelDirectionCalls": 2,
            "oldWorkingPixelsSha256": fingerprint, "newWorkingPixelsSha256": fingerprint}
        current["C"] = {"diagnostics": {"snapshotSelection": {"fresh": selected}, "globalFields": [field]}}
        receipt = {"clips": [{"id": "clip", "frames": [old, current]}]}
        self.assertEqual(diagnosis.select_field(receipt, "clip", 1, "fresh")[0], old)
        for case in ("clock", "source", "pixel", "calls"):
            with self.subTest(case=case):
                bad = deepcopy(receipt); observed = bad["clips"][0]["frames"][1]["C"]["diagnostics"]["globalFields"][0]
                observed[{"clock": "endMs", "source": "startSha256", "pixel": "oldWorkingPixelsSha256", "calls": "modelDirectionCalls"}[case]] = None
                with self.assertRaises(ValueError): diagnosis.select_field(bad, "clip", 1, "fresh")


if __name__ == "__main__": unittest.main()
