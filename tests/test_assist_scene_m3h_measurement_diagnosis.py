"""Diagnostic arithmetic and observational tracing, not product certification."""
from pathlib import Path
import sys
import unittest
from types import SimpleNamespace

import cv2
import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from diagnose_assist_scene_m3h_measurement import finish_affine, inspect_calls, flow_record
from diagnose_assist_scene_approach import physical_trend
from assist_scene_motion import Detection


class MeasurementDiagnosisTests(unittest.TestCase):
    def test_support_trace_preserves_original_seed_denominator(self):
        image=np.random.default_rng(123).integers(0,255,(80,80),dtype=np.uint8)
        a=np.array([(x,y) for x in (10,30,50,65) for y in (10,30,60)],np.float32)
        back=a.copy(); back[0]+=3
        tube=SimpleNamespace(id=5,initial=20,points=a,box=Detection("car",.9,(0.,0.,80.,80.)))
        values={"p":image,"q":image,"a":a,"b":a,"back":back,
                "tube":tube,"ok":np.ones(12,bool),"rev":np.ones(12,bool),
                "global_b":a,"current":tube.box,"others":[],"homography":np.eye(3)}
        record=flow_record(values,(None,"insufficient-object-flow"),SimpleNamespace(id=7,born=0.))
        self.assertEqual(record["stages"]["sampledBothDirections"],12)
        self.assertEqual(record["stages"]["forwardBackward"],11)
        self.assertEqual(record["stages"]["outsideOtherBoxes"],11)
        self.assertEqual(record["requiredPreFitSupport"],12.)
        self.assertEqual(record["initialPoints"],20)
        self.assertFalse(record["identityProbe"])

    def test_affine_same_pairs_exposes_anisotropic_geometry(self):
        x,y=np.meshgrid(np.linspace(0,90,7),np.linspace(0,70,6))
        a=np.column_stack((x.ravel(),y.ravel())).astype(np.float32)
        b=a@np.array([[1.10,.12],[.02,.88]],np.float32).T+[4.,3.]
        similarity=np.array([[1.,0.,4.],[0.,1.,3.]])
        record={"_pairs":(a,b),"_similarity":similarity}
        finish_affine(record)
        result=record["diagnosticAffine"]
        self.assertEqual(result["inliers"],len(a))
        self.assertGreater(result["axisScaleRatio"],1.1)
        self.assertLess(result["affineResidual"]["medianPx"],.001)
        self.assertGreater(result["similarityResidual"]["medianPx"],2.)
        self.assertNotIn("_pairs",record)

    def test_absent_pairs_do_not_invent_geometry(self):
        record={"reason":"insufficient-object-flow"}
        finish_affine(record)
        self.assertNotIn("diagnosticAffine",record)

    def test_observational_profile_restores_prior_hook_even_on_failure(self):
        previous=sys.getprofile()
        def hook(*args): pass
        sys.setprofile(hook)
        try:
            with self.assertRaises(RuntimeError):
                with inspect_calls({"flow":[]}):
                    raise RuntimeError("test")
            self.assertIs(sys.getprofile(),hook)
        finally: sys.setprofile(previous)

    def test_range_closing_is_not_relabelled_as_optical_z_closing(self):
        history=[(0,0,10.,8.,6.),(300000,300000,9.5,8.1,5.),
                 (600000,600000,9.,8.2,4.)]
        result=physical_trend(history,600000)
        self.assertTrue(result["rangeClosingButOpticalZNotClosing"])
        self.assertLess(result["relativeRangeRatios"][-1],1.)
        self.assertGreater(result["opticalZRatios"][-1],1.)

    def test_short_reference_is_explicitly_unknown(self):
        self.assertEqual(physical_trend([(0,0,10.,8.,6.)],0)["status"],
                         "insufficient-reference-history")


if __name__=="__main__": unittest.main()
