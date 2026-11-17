from argparse import Namespace
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/"scripts"))
import assist_scene_m3q_reference_study as study


class M3QReferenceStudyTests(unittest.TestCase):
    def test_external_h_maps_original_source_and_actual_axis_geometry(self):
        source = np.array([[2., 3.], [4., 5.]], np.float32)
        expected = source+np.array([4., -2.])
        pop = (source, expected, np.zeros(2), np.ones(2, bool), {})
        native_h = np.array([[1., 0., 8.], [0., 1., -8.], [0., 0., 1.]])
        scales = np.diag([.5, .25, 1.])
        result = study.score_population(pop, native_h, scales, scales, (20, 20))
        self.assertEqual(result["counts"]["acceptedCorrect"], 2)
        self.assertEqual(result["counts"]["acceptedWrong"], 0)
        self.assertEqual(result["points"][0]["sourceNative"], [4., 12.])

    def test_false_accept_missing_and_outside_reference_denominators_retained(self):
        a = np.array([[5., 5.], [6., 5.], [100., 100.], [7., 5.]])
        b = a.copy(); b[0] += 4; b[3] += 1
        pop = (a, b, np.zeros(4), np.array([True, False, True, True]), {})
        result = study.score_population(pop, np.eye(3), np.eye(3), np.eye(3), (20, 20))
        c = result["counts"]
        self.assertEqual(c["selected"], 4)
        self.assertEqual(c["acceptedCorrect"], 0)  # sqrt2 > fixed1.3, never relaxed
        self.assertEqual(c["acceptedWrong"], 2)
        self.assertEqual(c["missingInBounds"], 1)
        self.assertEqual(c["outsideReferenceImageBounds"], 1)
        self.assertEqual(c["acceptedOutsideReferenceImageBounds"], 1)

    def test_incomplete_reference_rejects_before_model_allocates(self):
        with tempfile.TemporaryDirectory(prefix="codex-tmp-m3q-reference-reject-") as temporary:
            p = Path(temporary)/"manifest.json"; p.write_text(json.dumps({"complete": False}))
            with patch("assist_scene_global_field.GlobalRaftSmall") as model:
                with self.assertRaises(ValueError): study.replay(Namespace(manifest=p))
                model.assert_not_called()

    def test_nonfinite_accepted_prediction_is_rejected(self):
        pop = (np.array([[5., 5.]]), np.array([[np.nan, np.nan]]), np.zeros(1), np.ones(1, bool), {})
        with self.assertRaises(ValueError): study.score_population(pop, np.eye(3), np.eye(3), np.eye(3), (20, 20))

    def test_projective_division_undefined_is_not_correct(self):
        a = np.array([[1., 2.]])
        h = np.array([[1., 0., 0.], [0., 1., 0.], [1., 0., -1.]])
        value = study.score_population((a, a, np.zeros(1), np.zeros(1, bool), {}), h, np.eye(3), np.eye(3), (20, 20))
        self.assertEqual(value["counts"]["invalidReferenceProjection"], 1)
        self.assertEqual(value["counts"]["acceptedCorrect"], 0)


if __name__ == "__main__": unittest.main()
