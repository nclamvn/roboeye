"""Authored analytic-GT checks; no pretrained model or real dataset execution."""

from copy import deepcopy
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock

import cv2
import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
import assist_scene_m3o_correspondence_audit as audit


class FakeBase:
    def __init__(self,shape):
        self.direction_calls=0; self.last_call={}; self.metadata={"kind":"analytic-test-provider","device":"cpu"}
        self.fields=tuple(np.zeros((*shape,2),np.float32) for _ in range(2))
    def __call__(self,p,q):
        self.direction_calls+=2;self.last_call={"status":"field-supported","modelDirectionCalls":2,"roiShape":list(p.shape),"wallMs":0.}
        return self.fields


class CorrespondenceAuditTests(unittest.TestCase):
    def test_analytic_geometry_is_independent_of_cycle(self):
        for name in ("static","translation","expansion","rotation","occlusion","periodic-static"):
            with self.subTest(name=name):
                case=audit.authored_case(name); fields=audit.analytic_fields(case["matrix"],case["old"].shape)
                report=audit.audit_fields(case,*fields)
                self.assertLess(report["allVisibleEpeMean"],1e-5)
                self.assertEqual(report["epeWithin1_3Fraction"],1.)
                self.assertLess(abs(report["growthBias"]),1e-6)
                self.assertEqual(report["originalPoints"],64);json.dumps(report,allow_nan=False)

    def test_wrong_reversible_periodic_alias_is_not_ground_truth(self):
        case=audit.authored_case("periodic-static")
        forward=np.zeros((*case["old"].shape,2),np.float32);forward[:,:,0]=8
        report=audit.audit_fields(case,forward,-forward)
        self.assertEqual(report["allVisibleEpeMean"],8.)
        self.assertEqual(report["cycleWithin1_3Fraction"],1.)
        self.assertEqual(report["epeWithin1_3Fraction"],0.)
        self.assertEqual(report["reversibleButWrongPoints"],64)

    def test_invalid_predictions_remain_in_ground_truth_denominator(self):
        case=audit.authored_case("static");forward,backward=audit.analytic_fields(case["matrix"],case["old"].shape)
        forward[:]=np.nan
        report=audit.audit_fields(case,forward,backward)
        self.assertEqual(report["gtVisiblePoints"],64);self.assertEqual(report["invalidPredictionPoints"],64)
        self.assertEqual(report["epeWithin1_3Fraction"],0.);self.assertIsNone(report["allVisibleEpeMean"])
        self.assertIsNone(report["fittedLinearLogGrowth"]);json.dumps(report,allow_nan=False)

    def test_authored_visibility_not_algorithm_conditioned(self):
        case=audit.authored_case("occlusion");initial=case["visible"].copy()
        fields=audit.analytic_fields(case["matrix"],case["old"].shape)
        audit.audit_fields(case,*fields)
        np.testing.assert_array_equal(initial,case["visible"])
        self.assertLess(int(initial.sum()),64)
        self.assertEqual(audit.authored_case("static")["metadata"],audit.authored_case("static")["metadata"])
        self.assertNotEqual(audit.authored_case("static",seed=1)["metadata"]["manifestSha256"],audit.authored_case("static",seed=2)["metadata"]["manifestSha256"])

    def test_refinement_uses_two_independent_full_resolution_calls_and_preserves_initial(self):
        case=audit.authored_case("static");base=FakeBase(case["old"].shape);provider=audit.VariationalRefinedRaft(base)
        before=[f.copy() for f in base.fields]
        result=provider(case["old"],case["new"])
        self.assertEqual(base.direction_calls,2);self.assertEqual(provider.direction_calls,2);self.assertEqual(provider.refinement_calls,2)
        for a,b in zip(before,base.fields):np.testing.assert_array_equal(a,b)
        for field in result:self.assertEqual(field.shape,(*case["old"].shape,2));self.assertTrue(np.isfinite(field).all())
        self.assertLessEqual(provider.last_call["refinementWallMs"],provider.last_call["wallMs"])
        metadata=provider.metadata;metadata["refinement"]["getAlpha"]=999
        self.assertEqual(provider.metadata["refinement"],audit.VR_DEFAULTS)

    def test_actual_cpu_dis_authored_input_no_learned_inference_claim(self):
        case=audit.authored_case("static");provider=audit.NativeDis();report=audit.audit_provider(provider,case)
        self.assertEqual(report["actualDirectionCalls"],2);self.assertEqual(report["lastCall"]["modelDirectionCalls"],0)
        self.assertEqual(report["actualRefinementCalls"],0);self.assertEqual(report["provider"]["device"],"cpu")
        self.assertLess(report["allVisibleEpeMean"],.05);json.dumps(report,allow_nan=False)

    def test_source_box_known_map_has_shared_sealed_inventory_and_original_denominator(self):
        old=audit.authored_case("static")["old"]
        matrix=np.array([[1.,0.,3.],[0.,1.,-2.]])
        case=audit.known_map_case(old,matrix,"authored-source-box",source_box=[60.,50.,77.,90.],
            source_metadata={"origin":"authored-test-not-real-object-flow"})
        self.assertEqual(case["selection"]["sourceBox"],[60.,50.,77.,90.])
        fields=audit.analytic_fields(matrix,old.shape)
        report=audit.audit_fields(case,*fields)
        self.assertEqual(report["originalPoints"],case["selection"]["seedPoints"])
        self.assertGreater(report["originalPoints"],0);self.assertLess(report["allVisibleEpeMean"],1e-5)
        base=FakeBase(old.shape);base.fields=fields
        run=audit.audit_provider(base,case)
        self.assertEqual(run["actualDirectionCalls"],2)
        self.assertEqual(run["patchChecks"]["raw"]["selectionSha256"],run["patchChecks"]["warped"]["selectionSha256"])
        self.assertEqual(run["patchChecks"]["raw"]["originalPoints"],report["originalPoints"])
        json.dumps(run,allow_nan=False)

    def test_empty_source_box_population_is_unknown_not_zero_error(self):
        old=audit.authored_case("static")["old"]
        case=audit.known_map_case(old,[[1.,0.,0.],[0.,1.,0.]],"empty-authored",source_box=[60.,60.,64.,64.])
        fields=audit.analytic_fields(case["matrix"],old.shape)
        report=audit.audit_fields(case,*fields)
        self.assertEqual(report["originalPoints"],0);self.assertEqual(report["gtVisiblePoints"],0)
        self.assertIsNone(report["allVisibleEpeMean"]);self.assertIsNone(report["epeWithin1_3Fraction"])
        self.assertIsNone(report["fittedLinearLogGrowth"])

    def test_case_drift_rejected_before_any_provider_call(self):
        case=audit.authored_case("static");case["new"][0,0]^=255
        base=FakeBase(case["old"].shape)
        with self.assertRaisesRegex(ValueError,"pixels changed"):audit.audit_provider(base,case)
        self.assertEqual(base.direction_calls,0)

    def test_metadata_is_defensive_and_refinement_cost_is_separate(self):
        case=audit.authored_case("static");provider=audit.VariationalRefinedRaft(FakeBase(case["old"].shape))
        metadata=provider.metadata;metadata["refinement"]["getAlpha"]=0
        self.assertEqual(provider.metadata["refinement"]["getAlpha"],20.)
        provider(case["old"],case["new"])
        self.assertGreaterEqual(provider.last_call["wallMs"],provider.last_call["refinementWallMs"])
        self.assertEqual(provider.last_call["baselineProvider"]["modelDirectionCalls"],2)

    def test_failure_is_not_fallback_and_partial_call_cost_is_retained(self):
        case=audit.authored_case("static");base=FakeBase(case["old"].shape);provider=audit.VariationalRefinedRaft(base)
        provider._refine=Mock();provider._refine.calc.side_effect=RuntimeError("authored failure")
        with self.assertRaisesRegex(RuntimeError,"authored failure"):provider(case["old"],case["new"])
        self.assertEqual(provider.direction_calls,2);self.assertEqual(provider.refinement_calls,1)
        self.assertEqual(provider.last_call["status"],"runtime-error")
        self.assertEqual(provider.last_call["refinementDirectionCalls"],1)

    def test_guards_reject_bad_shapes_modes_and_coordinates(self):
        case=audit.authored_case("static");provider=audit.NativeDis()
        with self.assertRaises(ValueError):provider(case["old"].astype(float),case["new"])
        self.assertEqual(provider.direction_calls,0)
        with self.assertRaises(ValueError):audit.authored_case("unregistered-case")
        with self.assertRaises(ValueError):audit.analytic_fields([[0,0,0],[0,0,0]],case["old"].shape)
        bad=np.zeros((*case["old"].shape,2),np.float64)
        with self.assertRaises(ValueError):audit.audit_fields(case,bad,bad)


if __name__=="__main__":unittest.main()
