"""Authored diagnostic joins, not inference or real-data product evidence."""

from copy import deepcopy
from pathlib import Path
from contextlib import redirect_stderr
import inspect
import io
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/"scripts"))
import assist_scene_m3o_study as study


def sample():
    target = {"instance": "p1", "classFamily": "person", "approach": "approaching", "box": {"x": .2, "y": .2, "width": .2, "height": .4}}
    track = {"id": 1, "label": "person", "score": .9, "box": target["box"]}
    diagnostic = {"trackReasons": {"1": "no-fresh-source-exposure"}, "windowEvidence": {"1": {"fresh": None, "anchor": None}}, "comparisons": []}
    frame = {"index": 4, "token": "current", "timestampUs": 400000, "timeMs": 400., "sourceSha256": "a"*64,
        "detections": [{k: v for k, v in track.items() if k != "id"}], "T": {"status": "valid", "tracks": [track]}}
    for lane in "ABC": frame[lane] = {"diagnostics": deepcopy(diagnostic)}
    return ({"study": "M3N", "developmentOnly": False, "inputSha256": "b"*64, "clips": [{"id": "authored", "frames": [frame]}]},
        {"inputSha256": "b"*64, "clips": [{"id": "authored", "frames": [{"token": "current", "timestampUs": 400000, "targets": [target]}]}]})


class M3ODiagnosisTests(unittest.TestCase):
    def test_full_positive_case_kept_and_missing_growth_unknown(self):
        receipt, truth = sample()
        with patch.object(study.frozen, "receipt_contract"):
            result = study.diagnose(receipt, truth)
        self.assertEqual(result["summary"]["positiveTargetKeyframes"], 1)
        self.assertEqual(result["summary"]["currentRawCriterionMatch"], 1)
        self.assertEqual(result["cases"][0]["lanes"]["C"]["firstVeto"], "no-fresh-source-exposure")
        self.assertIn("UNKNOWN", result["cases"][0]["lanes"]["C"]["growthUnavailable"])
        self.assertEqual(result["actualNewModelDirectionCalls"], 0)

    def test_matching_preserves_full_competing_target_ambiguity(self):
        receipt, truth = sample(); target = deepcopy(truth["clips"][0]["frames"][0]["targets"][0]); target["instance"] = "p2"
        truth["clips"][0]["frames"][0]["targets"].append(target)
        with patch.object(study.frozen, "receipt_contract"):
            result = study.diagnose(receipt, truth)
        self.assertEqual(result["summary"]["currentRawCriterionFailure"], 2)
        self.assertEqual(len(result["cases"]), 2)
        self.assertEqual(result["cases"][0]["rawAmbiguousReportIndices"], [0])

    def test_duplicate_report_assignment_is_not_detector_success(self):
        receipt, truth = sample(); frame = receipt["clips"][0]["frames"][0]
        frame["detections"].append(deepcopy(frame["detections"][0]))
        with patch.object(study.frozen, "receipt_contract"):
            result = study.diagnose(receipt, truth)
        self.assertEqual(result["summary"]["currentRawCriterionFailure"], 1)

    def test_18px_geometry_is_distinct_from_ncc_failure(self):
        box = [10., 10., 23.289, 40.]
        value = study.geometry(box, {"width": 768, "height": 643})
        self.assertTrue(value["belowFrozen18px"])
        self.assertFalse(value["violatesFrozen4pxEdge"])
        self.assertIsNone(value["nccAttempted"])

    def test_changed_clock_or_truth_binding_fails(self):
        for case in ("clock", "hash"):
            receipt, truth = sample()
            if case == "clock": truth["clips"][0]["frames"][0]["timestampUs"] += 1
            else: truth["inputSha256"] = "c"*64
            with patch.object(study.frozen, "receipt_contract"):
                with self.assertRaises(ValueError): study.diagnose(receipt, truth)


def runtime_sample():
    from test_assist_scene_m3n_study import sample as n_sample
    from assist_scene_m3o_correspondence_audit import VR_DEFAULTS, NativeDis
    receipt, truth = n_sample()
    base = receipt.pop("globalFlowModel")
    receipt.update(study="M3O", policies=study.policy_snapshot(), codeSha256={n: study.sha256(study.HERE/n) for n in study.CODE},
        providers={"A": base, "B": {"kind": study.KINDS["B"], "algorithm": "raft-small-global-plus-opencv-variational-defaults",
            "baseline": deepcopy(base), "refinement": VR_DEFAULTS, "modelSharing": "same-sequential-global-provider", "opencv": study.cv2.__version__},
            "C": NativeDis().metadata}, detectorProvenance={"kind": "actual-local-CoreML-no-cached-observations"},
        actualCalls={"raft": 0, "refinement": 0, "dis": 0})
    for clip in receipt["clips"]:
        for frame in clip["frames"]:
            for lane in "ABC": frame[lane] = deepcopy(frame["C"])
            frame["actualCalls"] = {lane: {"raft": 0, "refinement": 0, "dis": 0} for lane in "ABC"}
        clip["actualCalls"] = study.sum_calls(clip["frames"])
    return receipt, truth


class M3ORunnerTests(unittest.TestCase):
    def test_full_scoring_keeps_frozen_matching_and_detector_gt_separate(self):
        receipt, truth = runtime_sample(); result = study.score(receipt, truth)
        self.assertEqual(result["study"], "M3O")
        self.assertEqual(result["noMetreChecks"], 35)
        self.assertEqual(result["totals"]["A"]["fn"], 7)
        metrics = study.detector_gt_metrics(receipt, truth)
        self.assertEqual(metrics["matchingIoU"], .35)
        self.assertIn("Sparse", metrics["limits"])

    def test_provider_defaults_source_and_counter_tampering_rejected(self):
        for case in ("code", "model", "vr", "dis", "trial-calls", "row-model", "hidden-dis"):
            receipt, _ = runtime_sample()
            if case == "code": receipt["codeSha256"] = {}
            elif case == "model": receipt["providers"]["A"]["weightsSha256"] = "wrong"
            elif case == "vr": receipt["providers"]["B"]["refinement"] = {}
            elif case == "dis": receipt["providers"]["C"]["parameters"] = {}
            elif case == "trial-calls": receipt["actualCalls"]["raft"] += 2
            elif case == "row-model": receipt["clips"][0]["frames"][0]["actualCalls"]["C"]["raft"] = 2
            else: receipt["clips"][0]["frames"][0]["actualCalls"]["C"]["dis"] = 2
            with self.subTest(case=case):
                with self.assertRaises(ValueError): study.receipt_contract(receipt)

    def test_paired_product_does_not_double_other_lanes_or_cpu_refinement(self):
        receipt, truth = runtime_sample(); frames = receipt["clips"][0]["frames"]
        frames[0]["timingsMs"].update(T=5., A=7., B=5000., C=9000.)
        result = study.score(receipt, truth)
        expected = study._percentiles([f["detectorObservationMs"]+sum(f["timingsMs"][k] for k in ("fullPreparation", "sharedPrep", "T", "A")) for f in frames])
        self.assertEqual(result["stageMs"]["APairedProduct"], expected)

    def test_actual_dis_directions_cannot_masquerade_as_learned(self):
        from assist_scene_global_field import geometry
        row = {"height": 160, "width": 224}
        field = {"providerKind": study.KINDS["C"], "modelDirectionCalls": 2, "fieldShapes": [[160,224,2]]*2,
            "fieldSha256": {"forward": "a"*64, "backward": "b"*64}, "wallMs": 10.,
            "provider": {"status": "field-supported", "outputShape": [160,224,2], "wallMs": 9., "device": "cpu",
                "roiShape": [160,224], "modelDirectionCalls": 0, "directionCalls": 2, "refinementDirectionCalls": 0}}
        study.provider_contract(field, row, "C")
        field["provider"]["modelDirectionCalls"] = 2
        with self.assertRaises(ValueError): study.provider_contract(field, row, "C")

    def test_failure_counters_are_separate_and_available_from_start(self):
        providers = {"A": SimpleNamespace(direction_calls=10), "B": SimpleNamespace(refinement_calls=6), "C": SimpleNamespace(direction_calls=4)}
        def fail(*args):
            providers["A"].direction_calls += 2; providers["B"].refinement_calls += 1
            raise RuntimeError("authored partial refinement")
        with patch.object(study, "_run_clip", side_effect=fail), redirect_stderr(io.StringIO()):
            with self.assertRaises(RuntimeError) as error:
                study.run_clip({"id": "authored"}, None, None, None, None, providers, clip_index=0)
        self.assertEqual(error.exception.m3o_failure["actualClipCalls"], {"raft": 2, "refinement": 1, "dis": 0})
        self.assertEqual(error.exception.m3o_failure["completedValidatedRows"], 0)

    def test_runtime_has_no_truth_cache_or_cross_lane_guard_spoof(self):
        for function in (study.run_clip, study._run_clip, study.replay):
            self.assertNotIn("truth", inspect.signature(function).parameters)
            self.assertNotIn("cached_observation", inspect.getsource(function))
            self.assertNotIn("cached", inspect.signature(function).parameters)
        self.assertNotIn("frozen.global_contract", inspect.getsource(study.global_contract))

    def test_authored_dis_positive_provider_specific_independent_contracts(self):
        # Actual CPU DIS/texture proofs, deliberately mocked provider metadata.
        # This is NOT actual RAFT/VR/default-DIS product quality evidence.
        from test_assist_scene_m3n_study import M3NStudyTests
        current, history = M3NStudyTests().authored_positive_history()
        def adapt(source):
            row = deepcopy(source)
            for lane in "ABC":
                row[lane] = deepcopy(source["C"]); row["timingsMs"][lane] = source["timingsMs"]["C"]
                row["flowDirectionCalls"][lane] = source["flowDirectionCalls"]["C"]
                for field in row[lane]["diagnostics"]["globalFields"]:
                    field["providerKind"] = study.KINDS[lane]
                    if lane == "B": field["provider"].update(baselineProvider=deepcopy(field["provider"]), refinementDirectionCalls=2, refinementWallMs=0.)
                    if lane == "C": field["provider"].update(device="cpu", modelDirectionCalls=0, directionCalls=2, refinementDirectionCalls=0)
            return row
        row, prior = adapt(current), [adapt(f) for f in history]
        for lane in "ABC":
            study.global_contract(row, prior, lane)
            for case in ("provider", "timing", "points", "source", "clock", "missing"):
                bad = deepcopy(row); d = bad[lane]["diagnostics"]
                if case == "provider": d["globalFields"][0]["providerKind"] = "spoof"
                elif case == "timing": bad["timingsMs"][lane] = .00001
                elif case == "points": d["comparisons"][0]["forward"]["assignedPoints"] = 0
                elif case == "source": d["globalFields"][0]["startSha256"] = "c"*64
                elif case == "clock": bad["sourcePoseTimestampUs"] -= 30000
                else: d["globalFields"] = []; bad[lane]["events"] = []
                with self.subTest(lane=lane,case=case):
                    with self.assertRaises(ValueError): study.global_contract(bad, prior, lane)


if __name__ == "__main__": unittest.main()
