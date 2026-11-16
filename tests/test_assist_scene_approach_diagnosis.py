"""Forensic arithmetic/profiling checks; not model or physical acceptance."""

from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/"scripts"))
from diagnose_assist_scene_approach import detections, nearest, physical_trend, scalar
from assist_scene_m3e_study import legacy_score


class ApproachDiagnosisTests(unittest.TestCase):
    def test_range_can_close_while_optical_z_is_fixed(self):
        # These are authored evaluation-only coordinates. Ratios explain why
        # Euclidean center proximity is not identical to optical expansion.
        history = [(0,0,10.,8.,6.),(320_000,320_000,9.,8.,4.12),
                   (640_000,640_000,8.5,8.,2.87)]
        answer = physical_trend(history,640_000)
        self.assertEqual(answer["status"],"valid")
        self.assertTrue(answer["rangeClosingButOpticalZNotClosing"])
        self.assertEqual(answer["expectedRigidFrontoParallelAngularScale"],1.)
        self.assertNotIn("metres",answer)

    def test_short_or_missing_reference_is_not_interpolated(self):
        self.assertEqual(physical_trend([(0,0,10.,8.,6.)],0)["status"],"insufficient-reference-history")
        self.assertEqual(physical_trend([],0)["status"],"missing-current-label")

    def test_match_respects_same_family_and_ambiguous_margin(self):
        c=legacy_score()
        b={"x":.3,"y":.2,"width":.1,"height":.2}
        t={"classFamily":"vehicle","box":b}
        track={"id":1,"label":"car","box":b}
        wrong={"id":2,"label":"person","box":b}
        hit,overlap,unique=nearest(t,[wrong,track],c)
        self.assertEqual(hit["id"],1);self.assertAlmostEqual(overlap,1);self.assertTrue(unique)
        hit,overlap,unique=nearest(t,[track,{**track,"id":3}],c)
        self.assertFalse(unique)
        self.assertEqual(nearest(t,[wrong],c),(None,None,False))

    def test_detections_roundtrip_and_scalar_trace_stays_bounded(self):
        b={"x":.3,"y":.2,"width":.1,"height":.2}
        row={"label":"car","score":.9,"box":b}
        d=detections([row],768,643)[0]
        np.testing.assert_allclose(d.xyxy,(230.4,128.6,307.2,257.2),rtol=0,atol=1e-10)
        self.assertIsNone(scalar(np.zeros((52,2))))
        self.assertIsNone(scalar(float("nan")))
        self.assertEqual(scalar(np.array([1.,2.])),[1.,2.])
