"""M3L authored runner/receipt controls; not real registration/model quality."""

from copy import deepcopy
import inspect
import importlib
from pathlib import Path
import sys
from time import perf_counter
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/"scripts"))
import assist_scene_m3l_study as study
from test_assist_scene_m3k_audit import sample as previous_sample


def sample():
    receipt = previous_sample()
    receipt.update(study="M3L", developmentOnly=False, policies=study.policy_snapshot(),
        maxWallSeconds=study.MAX_SECONDS, replayWallMs=100.,
        codeSha256={name: study.sha256(study.HERE/name) for name in study.CODE},
        learnedFlowModel=receipt["learnedFlow"],
        detectorProvenance={"kind": "actual-local-CoreML-and-PyTorch", "cacheSha256": None,
                            "baselineTimings": "actual current execution"})
    for clip in receipt["clips"]:
        clip.update(detectorCalls=len(clip["frames"]), detectorBatches=1, detectorBatchWallMs=10.,
                    stageWallMs=2., studyWallMs=100.)
        for frame in clip["frames"]:
            frame["B"] = frame.pop("C")
            frame["C"] = deepcopy(frame["A"])
            frame["C"]["events"] = []
            frame["C"]["diagnostics"].update(sourceStatus=frame["A"]["status"], windowEvidence={})
            frame["learnedFlow"] = {"B": frame["learnedFlow"]["C"]}
            frame["flowDirectionCalls"] = {"B": frame["flowDirectionCalls"]["C"]}
            frame["oldObservation"] = {"width": frame["width"], "height": frame["height"], "orientation": 1,
                                       "tracks": deepcopy(frame["detections"]), "detectionMs": frame["detectorObservationMs"]}
            frame["timingsMs"] = {name: 2. for name in study.TIMINGS}
            frame["cameraIntrinsics"] = np.eye(3).tolist()
            frame["cameraToWorld"] = np.eye(4).tolist()
            frame.update(nativeWidth=600, nativeHeight=300)
        clip["flowDirectionCalls"] = sum(f["flowDirectionCalls"]["B"] for f in clip["frames"])
    truth = {"schemaVersion": 1, "inputSha256": receipt["inputSha256"], "clips": []}
    for clip in receipt["clips"]:
        truth["clips"].append({"id": clip["id"], "frames": [{"token": f["token"], "timestampUs": f["timestampUs"],
            "targets": [{"instance": "target", "box": deepcopy(f["detections"][0]["box"]), "classFamily": "vehicle", "approach": "approaching"}]}
            for f in clip["frames"]]})
    return receipt, truth


class M3LStudyTests(unittest.TestCase):
    def setUp(self):
        # Pair-value floors are the separately tested direct engine's job.
        # These authored controls isolate stream/source/receipt contracts.
        actual = importlib.import_module("assist_scene_direct_window")
        self.direct = SimpleNamespace(POLICY=dict(actual.POLICY), window=actual.window,
                                      _eligible=actual._eligible, _pair_score=actual._pair_score,
                                      validate_pair_proof=Mock(), validate_association_proof=Mock())
        self.enterContext(patch.dict(sys.modules, {"assist_scene_direct_window": self.direct}))
        self.enterContext(patch.object(study, "CODE", tuple(n for n in study.CODE if (study.HERE/n).is_file())))

    def test_shared_detector_and_no_metric_checks(self):
        receipt, truth = sample()
        result = study.score(receipt, truth)
        self.assertEqual(result["noMetreChecks"], 28)
        self.assertEqual(result["frames"], 7)
        self.assertEqual(result["totals"]["C"]["tp"], 0)

    def test_deadline_fails_loud_before_any_staging_or_inference(self):
        with self.assertRaises(TimeoutError):
            study.run_clip({}, None, None, None, None, deadline=perf_counter()-1.)
        receipt, _ = sample(); receipt["replayWallMs"] = 1800001.
        with self.assertRaises(ValueError): study.receipt_contract(receipt)

    def test_current_detection_binding_rejects_impossible_warning_track(self):
        receipt, truth = sample(); row = receipt["clips"][0]["frames"][4]
        row["detections"] = []
        row["oldObservation"]["tracks"] = []
        with self.assertRaisesRegex(ValueError, "not backed"):
            study.score(receipt, truth)

    def test_c_cannot_change_current_identity_epoch_or_camera_gate(self):
        for case in ("identity", "epoch", "status"):
            with self.subTest(case=case):
                receipt, _ = sample(); frame = receipt["clips"][0]["frames"][4]
                if case == "identity": frame["C"]["tracks"][0]["id"] = 99
                elif case == "epoch": frame["C"]["epoch"] += 1
                else: frame["C"]["diagnostics"]["sourceStatus"] = "wrong"
                with self.assertRaises(ValueError): study.track_contract(frame)

    def direct_sample(self):
        receipt, truth = sample(); frames = receipt["clips"][0]["frames"]
        current, old, last = frames[4], frames[0], frames[3]
        # This fixture intentionally has independently changing earlier IDs.
        old["A"]["tracks"][0]["id"] = 88
        ident = current["A"]["tracks"][0]["id"]
        def pair(origin):
            def pixels(exposure):
                b = exposure["detections"][0]["box"]
                return [b["x"]*exposure["width"], b["y"]*exposure["height"],
                        (b["x"]+b["width"])*exposure["width"], (b["y"]+b["height"])*exposure["height"]]
            return {"supported": True, "startMs": origin["timeMs"], "endMs": current["timeMs"],
                "observationMs": current["timeMs"]-origin["timeMs"], "startToken": origin["token"],
                "endToken": current["token"], "startSha256": origin["sourceSha256"],
                "endSha256": current["sourceSha256"], "startDetectionIndex": 0, "endDetectionIndex": 0,
                "linearLogGrowth": .05, "logAreaGrowth": .10, "points": 20,
                "linearLogGrowthLowerBound": .045, "linearLogGrowthUpperBound": .055,
                "modeRefinement": {"forward": {"count": 2, "linearLogGrowths": [.05, .055]},
                                   "reverse": {"count": 2, "linearLogGrowths": [-.045, -.05]}},
                "forwardInitialization": {"correlation": .9}, "reverseInitialization": {"correlation": .9},
                "cost": {"initializerWarps": 102, "templateCalls": 8, "eccCalls": 2}, "wallMs": .1,
                "startBox": pixels(origin), "endBox": pixels(current),
                "association": {"supported": True, "currentDetectionIndex": 0,
                                "anchorDetectionIndex": 0, "reciprocalCurrentIndex": 0,
                                "eligibleAnchorIndices": [0], "eligibleCompetitors": {"0": [0]},
                                "correlation": .9, "runnerUpCorrelation": -1., "associationMargin": 1.9,
                                "reverseRunnerUpCorrelation": -1., "reverseAssociationMargin": 1.9}}
        fresh, anchor = pair(last), pair(old)
        current["C"]["events"] = [{"kind": "relative-optical-approach", "trackId": ident,
            "label": current["A"]["tracks"][0]["label"], "epoch": current["A"]["epoch"], "timeMs": current["timeMs"],
            "observationMs": anchor["observationMs"], "linearLogGrowth": anchor["linearLogGrowthLowerBound"],
            "logAreaGrowth": 2*anchor["linearLogGrowthLowerBound"], "points": anchor["points"], "method": self.direct.POLICY["method"],
            "linearLogGrowthLowerBound": anchor["linearLogGrowthLowerBound"], "growthBound": "all-refined-modes-lower"}]
        current["C"]["diagnostics"]["windowEvidence"][str(ident)] = {"confirmed": True,
            "currentToken": current["token"], "currentMs": current["timeMs"], "fresh": fresh, "anchor": anchor,
            "linearLogGrowth": anchor["linearLogGrowthLowerBound"],
            "linearLogGrowthLowerBound": anchor["linearLogGrowthLowerBound"],
            "linearLogGrowthUpperBound": anchor["linearLogGrowthUpperBound"],
            "selectedPreviousToken": last["token"], "selectedPreviousMs": last["timeMs"],
            "selectedAnchorToken": old["token"], "selectedAnchorMs": old["timeMs"],
            "realExposureTokens": [old["token"], last["token"], current["token"]]}
        current["C"]["diagnostics"].update(
            comparisons=[{k: deepcopy(v) for k, v in pair.items() if k != "association"} for pair in (fresh, anchor)],
            comparisonCount=2, cost={"initializerWarps": 204, "templateCalls": 16, "eccCalls": 4}, wallMs=1.)
        return current, frames[:4]

    def test_real_distinct_exposure_proof_does_not_borrow_old_identity_age(self):
        current, history = self.direct_sample()
        study.direct_contract(current, history)
        self.assertEqual(self.direct.validate_pair_proof.call_count, 2)
        self.assertEqual(self.direct.validate_association_proof.call_count, 2)

    def test_direct_proof_rejects_stale_chained_wrong_source_or_camera_veto(self):
        for case in ("current", "source", "anchor", "fresh", "duplicate", "veto", "epoch", "missing"):
            with self.subTest(case=case):
                current, history = self.direct_sample()
                proof = next(iter(current["C"]["diagnostics"]["windowEvidence"].values()))
                if case == "current": proof["fresh"]["endToken"] = "wrong"
                elif case == "source": proof["anchor"]["startSha256"] = "d"*64
                elif case == "anchor": proof["anchor"]["observationMs"] = 10.
                elif case == "fresh": proof["fresh"] = deepcopy(proof["anchor"])
                elif case == "duplicate": proof["realExposureTokens"][1] = proof["realExposureTokens"][0]
                elif case == "veto": history[2]["A"]["status"] = "scale-ambiguous"
                elif case == "epoch": history[2]["A"]["epoch"] += 1
                else: history.pop(0)
                with self.assertRaises(ValueError): study.direct_contract(current, history)

    def test_warning_pairs_and_association_reproduce_actual_comparisons(self):
        for case in ("deleted", "changed", "runner", "pruned", "wrong-owner", "growth"):
            with self.subTest(case=case):
                current, history = self.direct_sample()
                proof = next(iter(current["C"]["diagnostics"]["windowEvidence"].values()))
                if case == "deleted":
                    current["C"]["diagnostics"].update(comparisons=[], comparisonCount=0,
                        cost={"initializerWarps": 0, "templateCalls": 0, "eccCalls": 0})
                elif case == "changed": current["C"]["diagnostics"]["comparisons"][0]["points"] += 1
                elif case == "runner": proof["fresh"]["association"]["runnerUpCorrelation"] = .1
                elif case == "pruned": proof["fresh"]["association"]["eligibleAnchorIndices"] = []
                elif case == "wrong-owner": proof["fresh"]["endDetectionIndex"] = 99
                else: proof["fresh"]["linearLogGrowth"] = -.1
                with self.assertRaises(ValueError): study.direct_contract(current, history)

    def test_events_must_use_explicit_all_modes_lower_bound_not_point_estimate(self):
        for case in ("point", "area", "missing-tag", "missing-lower", "evidence-point", "negative-fresh-bound"):
            with self.subTest(case=case):
                current, history = self.direct_sample()
                proof = next(iter(current["C"]["diagnostics"]["windowEvidence"].values()))
                event = current["C"]["events"][0]
                if case == "point": event["linearLogGrowth"] = proof["anchor"]["linearLogGrowth"]
                elif case == "area": event["logAreaGrowth"] = proof["anchor"]["logAreaGrowth"]
                elif case == "missing-tag": event.pop("growthBound")
                elif case == "missing-lower": event.pop("linearLogGrowthLowerBound")
                elif case == "evidence-point": proof["linearLogGrowth"] = proof["anchor"]["linearLogGrowth"]
                else:
                    proof["fresh"]["linearLogGrowthLowerBound"] = -.001
                    current["C"]["diagnostics"]["comparisons"][0]["linearLogGrowthLowerBound"] = -.001
                with self.assertRaises(ValueError): study.direct_contract(current, history)

    def test_growth_envelope_must_include_sign_corrected_reverse_modes(self):
        current, history = self.direct_sample()
        proof = next(iter(current["C"]["diagnostics"]["windowEvidence"].values()))
        pair = proof["anchor"]
        study.mode_bound_contract(pair)
        pair["linearLogGrowthLowerBound"] = min(pair["modeRefinement"]["forward"]["linearLogGrowths"])
        with self.assertRaisesRegex(ValueError, "both forward"):
            study.mode_bound_contract(pair)

    def test_actual_detector_provenance_call_budget_and_raw_binding(self):
        for case in ("calls", "flow-calls", "kind", "code", "weight", "raw", "clock"):
            with self.subTest(case=case):
                receipt, truth = sample(); clip = receipt["clips"][0]; row = clip["frames"][0]
                if case == "calls": clip["detectorCalls"] = 0
                elif case == "flow-calls": clip["flowDirectionCalls"] += 2
                elif case == "kind": receipt["detectorProvenance"]["kind"] = "cached"
                elif case == "code": receipt["codeSha256"] = {}
                elif case == "weight": receipt["learnedFlowModel"]["weightsSha256"] = "wrong"
                elif case == "raw": row["oldObservation"]["tracks"] = []
                else: row["timeMs"] += 1
                with self.assertRaises(ValueError): study.score(receipt, truth)

    def test_c_product_cost_includes_owning_a_dependency(self):
        receipt, truth = sample()
        receipt["clips"][0]["frames"][0]["timingsMs"]["A"] = 100.
        result = study.score(receipt, truth)
        frames = receipt["clips"][0]["frames"]
        expected = study._percentiles([f["detectorObservationMs"]+sum(f["timingsMs"][k] for k in ("fullPreparation", "sharedPrep", "A", "C")) for f in frames])
        self.assertEqual(result["stageMs"]["CPairedProduct"], expected)

    def test_development_requires_cache_and_labels_history_as_not_current(self):
        receipt, truth = sample(); receipt["developmentOnly"] = True
        with self.assertRaises(ValueError): study.score(receipt, truth)
        self.assertIn("historical, not current execution", inspect.getsource(study.replay))


if __name__ == "__main__":
    unittest.main()
