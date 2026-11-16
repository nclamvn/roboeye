"""Authored receipt/assignment tests; no model, image or GPU execution."""

from copy import deepcopy
import inspect
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/"scripts"))
import diagnose_assist_scene_m3k_misses as diagnostic
from test_assist_scene_m3k_study import sample


BOX = {"x": .2, "y": .2, "width": .2, "height": .2}


def report(ident=1, label="car", box=None):
    return {"id": ident, "label": label, "box": deepcopy(BOX if box is None else box)}


def target(ident="target", family="vehicle", box=None):
    return {"instance": ident, "classFamily": family,
            "box": deepcopy(BOX if box is None else box), "approach": "approaching"}


class M3KMissDiagnosisTests(unittest.TestCase):
    def test_full_match_graph_rejects_family_mismatch_low_iou_and_near_ties(self):
        matcher = diagnostic.legacy_score()
        self.assertEqual(diagnostic.matching_graph([report()], [target()], matcher)["hits"][0]["reportIndex"], 0)
        wrong = diagnostic.matching_graph([report(label="person")], [target()], matcher)
        self.assertEqual(wrong["unmatchedReportIndexes"], [0])
        far = {"x": .7, "y": .7, "width": .1, "height": .1}
        self.assertEqual(diagnostic.matching_graph([report(box=far)], [target()], matcher)["hits"], {})
        tied = diagnostic.matching_graph([report()], [target("one"), target("two")], matcher)
        self.assertEqual(tied["ambiguousReportIndexes"], [0])

    def test_duplicate_target_reports_are_all_ambiguous_not_one_arbitrary_hit(self):
        graph = diagnostic.matching_graph([report(1), report(2)], [target()], diagnostic.legacy_score())
        self.assertEqual(graph["hits"], {})
        self.assertEqual(set(graph["ambiguousReportIndexes"]), {0, 1})

    def test_source_reference_requires_exact_input_clip_token_clock(self):
        receipt, truth = sample()
        diagnostic._reference_index(truth, receipt)
        for case in ("input", "clip", "clock", "token", "duplicate"):
            with self.subTest(case=case):
                bad = deepcopy(truth)
                if case == "input": bad["inputSha256"] = "wrong"
                elif case == "clip": bad["clips"][0]["id"] = "wrong"
                elif case == "clock": bad["clips"][0]["frames"][0]["timestampUs"] += 1
                elif case == "token": bad["clips"][0]["frames"][0]["token"] = "wrong"
                else: bad["clips"][0]["frames"].append(deepcopy(bad["clips"][0]["frames"][0]))
                with self.assertRaises(ValueError): diagnostic._reference_index(bad, receipt)

    def test_all_positives_preserved_including_success_and_original_inputs_unchanged(self):
        receipt, truth = sample(); before = deepcopy((receipt, truth))
        result = diagnostic.diagnose(receipt, truth, truth)
        self.assertEqual(len(result["positiveCases"]), 1)
        self.assertEqual(set(result["positiveCases"][0]["lanes"]), {"C", "D"})
        self.assertEqual(result["summary"]["C"]["tp"], 1)
        self.assertEqual(result["summary"]["D"]["fn"], 0)
        self.assertEqual((receipt, truth), before)

    def test_false_negative_case_is_preserved_and_reproduces_full_scorer(self):
        receipt, truth = sample()
        receipt["clips"][0]["frames"][4]["C"]["events"] = []
        result = diagnostic.diagnose(receipt, truth, truth)
        self.assertEqual(result["positiveCases"][0]["lanes"]["C"]["outcome"], "fn")
        self.assertEqual(result["summary"]["C"]["fn"], 1)
        self.assertEqual(result["summary"]["D"]["tp"], 1)
        self.assertEqual(result["originalAllLaneTotals"]["C"]["fn"], 1)
        self.assertEqual(result["positiveCases"][0]["lanes"]["C"]["counterfactualDiagnostic"]["wouldRecoverWithDirectAnchorOrGapTolerance"], "unknown-not-measured")

    def test_missing_growth_is_unknown_and_lane_field_is_not_target_pixel_proof(self):
        receipt, _ = sample(); frame = receipt["clips"][0]["frames"][4]
        snapshot = {"survivingCohorts": [], "identity": {}, "windowEvidence": {"confirmed": False}}
        pixels = diagnostic._pixel_evidence(frame, "C", snapshot)
        self.assertGreater(pixels["laneReturnedFieldCount"], 0)
        self.assertFalse(pixels["targetAttributedPixelSupportObserved"])
        self.assertEqual(diagnostic._growth_evidence(snapshot)["status"], "unknown-not-serialized-for-this-case")
        self.assertIsNone(diagnostic._growth_evidence(snapshot)["values"])

    def test_accepted_current_cohort_update_is_separate_from_expansion(self):
        receipt, _ = sample(); frame = receipt["clips"][0]["frames"][4]
        snapshot = {"survivingCohorts": [{"cohortId": 9, "ageMs": 80., "validSamples": 2,
                                         "lastMs": frame["timeMs"], "confirmed": False}], "identity": {}}
        pixels = diagnostic._pixel_evidence(frame, "C", snapshot)
        self.assertTrue(pixels["targetAttributedPixelSupportObserved"])
        self.assertEqual(pixels["currentSurvivingCohortIdsWithAcceptedPixelUpdate"], [9])
        self.assertEqual(diagnostic._growth_evidence(snapshot)["status"], "unknown-not-serialized-for-this-case")
        snapshot["survivingCohorts"][0]["lastMs"] -= 80.
        self.assertFalse(diagnostic._pixel_evidence(frame, "C", snapshot)["targetAttributedPixelSupportObserved"])

    def test_sparse_source_gt_does_not_become_dense_detection_or_tracking_truth(self):
        receipt, truth = sample(); frames = receipt["clips"][0]["frames"]
        references = {truth["clips"][0]["frames"][0]["token"]: truth["clips"][0]["frames"][0]}
        target_ = truth["clips"][0]["frames"][0]["targets"][0]
        history = diagnostic.history_diagnostic(frames, 4, "C", target_["instance"], references, diagnostic.legacy_score())
        summary = history["summary"]
        self.assertEqual(summary["runtimeExposureCount"], 5)
        self.assertEqual(summary["exactSourceTargetSamples"], 1)
        self.assertEqual(summary["unlabelledExposureCount"], 4)
        self.assertTrue(summary["strictAdjacentDetectorContinuity"].startswith("unknown"))

    def test_no_source_means_unknown_not_zero_detector_misses_or_continuity(self):
        receipt, truth = sample(); result = diagnostic.diagnose(receipt, truth)
        summary = result["positiveCases"][0]["lanes"]["C"]["precedingSourceGtDiagnosticOnly"]["summary"]
        self.assertEqual(summary["exactSourceTargetSamples"], 0)
        self.assertIsNone(summary["detectorOverlapPresentAtEveryObservedSourceSample"])

    def test_no_replay_or_runtime_model_path_is_executed_by_diagnostic(self):
        source = inspect.getsource(diagnostic)
        self.assertNotIn("run_clip(", source)
        self.assertNotIn(".detect(", source)
        self.assertNotIn("TorchvisionRaftSmall(", source)
        self.assertNotIn("imread(", source)
        self.assertIn("wouldRecoverWithDirectAnchorOrGapTolerance", source)


if __name__ == "__main__":
    unittest.main()
