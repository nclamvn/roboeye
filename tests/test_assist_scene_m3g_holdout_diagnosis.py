"""Attribution arithmetic only; not a product-quality acceptance test."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from diagnose_assist_scene_m3g_holdout import growth_checks


class HoldoutAttributionTests(unittest.TestCase):
    def evidence(self):
        return dict(angularLogGrowth=.10,angularLogMad=.01,robustPointGrowth=.10,
                    robustBoxGrowth=.09,currentAngularLogGrowth=.01)

    def test_no_growth_values_does_not_invent_checks(self):
        self.assertIsNone(growth_checks(None))
        self.assertIsNone(growth_checks({"reason":"warming-window"}))

    def test_consistent_values_pass_declared_checks(self):
        self.assertTrue(all(growth_checks(self.evidence()).values()))

    def test_mad_and_box_disagreement_remain_separate_vetoes(self):
        value=self.evidence()
        value.update(angularLogGrowth=.2259,angularLogMad=.12228,
                     robustPointGrowth=.22955,robustBoxGrowth=.08950)
        result=growth_checks(value)
        self.assertFalse(result["angularMadWithinFloor"])
        self.assertFalse(result["netExceedsGrowthAndThreeMad"])
        self.assertFalse(result["pointBoxAgreement"])
        self.assertTrue(result["currentGrowthPositive"])


if __name__=="__main__":unittest.main()
