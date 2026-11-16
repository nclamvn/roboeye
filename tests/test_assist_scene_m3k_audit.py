"""Authored consistency controls, not actual inference or accuracy evidence."""

from copy import deepcopy
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/"scripts"))
import audit_assist_scene_m3k as audit
from test_assist_scene_m3k_study import sample as impossible_sample


def sample():
    receipt, _ = impossible_sample()
    for frame in receipt["clips"][0]["frames"]:
        def record(lane):
            return [{k: v for k, v in track.items() if k != "id"} for track in frame[lane]["tracks"]]
        # Repair the intentionally impossible study fixture only for audit controls.
        frame["detections"] = record("A")
        frame["candidateDetections"] = record("B")
        for lane in ("C", "S"):
            frame[lane]["tracks"] = deepcopy(frame["A"]["tracks"])
        frame["D"]["tracks"] = deepcopy(frame["B"]["tracks"])
    return receipt


class M3KAuditTests(unittest.TestCase):
    def test_rejects_original_false_success_with_empty_current_detections(self):
        receipt, _ = impossible_sample()
        with self.assertRaisesRegex(ValueError, "not backed"):
            audit.audit_receipt(receipt)

    def test_valid_bound_fixture_reports_attribution_limit_honestly(self):
        result = audit.audit_receipt(sample())
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["checks"]["frames"], 7)
        self.assertEqual(result["fieldToWarningAttribution"], "NOT INDEPENDENTLY ATTRIBUTABLE")

    def test_track_binding_rejects_wrong_label_score_geometry_and_duplicates(self):
        for case in ("label", "score", "box", "duplicate", "other-lane"):
            with self.subTest(case=case):
                receipt = sample(); frame = receipt["clips"][0]["frames"][4]
                track = frame["D"]["tracks"][0]
                if case == "label": track["label"] = "truck"
                elif case == "score": track["score"] = .1
                elif case == "box": track["box"]["x"] += .1
                elif case == "duplicate": frame["D"]["tracks"].append(dict(track, id=99))
                else: frame["candidateDetections"] = []
                with self.assertRaises(ValueError): audit.audit_receipt(receipt)

    def test_numeric_roundtrip_tolerance_not_geometry_relaxation(self):
        receipt = sample()
        receipt["clips"][0]["frames"][4]["D"]["tracks"][0]["box"]["x"] += 1e-12
        audit.audit_receipt(receipt)

    def test_current_event_and_cohort_proof_no_metric_claim(self):
        for case in ("id", "clock", "age", "confirmation", "last", "range", "answer"):
            with self.subTest(case=case):
                receipt = sample(); frame = receipt["clips"][0]["frames"][4]; lane = frame["D"]
                if case == "id": lane["events"][0]["trackId"] = 99
                elif case == "clock": lane["events"][0]["timeMs"] += 1
                elif case == "range": lane["events"][0]["metres"] = 2.
                elif case == "answer": lane["answers"]["distance"]["metres"] = 2.
                else:
                    proof = lane["diagnostics"]["cohorts"][str(lane["events"][0]["trackId"])][0]
                    if case == "age": proof["ageMs"] = 10
                    elif case == "confirmation": proof["confirmed"] = False
                    else: proof["lastMs"] -= 80
                with self.assertRaises(ValueError): audit.audit_receipt(receipt)

    def test_learned_call_budget_binding_and_current_support(self):
        for case in ("empty", "calls", "padding", "token", "clip-count", "hidden-cost"):
            with self.subTest(case=case):
                receipt = sample(); clip = receipt["clips"][0]; frame = clip["frames"][4]
                trace = frame["learnedFlow"]["D"][0]
                if case == "empty": frame["learnedFlow"]["D"] = []
                elif case == "calls": trace["modelDirectionCalls"] = 1
                elif case == "padding": trace["paddedShape"] = [384, 384]
                elif case == "token": trace["token"] = "other"
                elif case == "clip-count": clip["flowDirectionCalls"]["D"] += 2
                else: trace["wallMs"] = 10000
                with self.assertRaises(ValueError): audit.audit_receipt(receipt)

    def test_s_is_subset_but_keeps_its_edge_filter(self):
        receipt = sample(); frame = receipt["clips"][0]["frames"][0]
        frame["S"]["tracks"] = []
        audit.audit_receipt(receipt)
        record = deepcopy(frame["detections"][0]); record["box"]["x"] = 0.
        frame["detections"].append(record)
        frame["S"]["tracks"] = [dict(record, id=99)]
        with self.assertRaisesRegex(ValueError, "edge filter"): audit.audit_receipt(receipt)

    def test_optional_original_development_baseline_comparison(self):
        receipt = sample(); receipt["developmentOnly"] = True
        old = deepcopy(receipt)
        old.update(study="M3J", developmentOnly=False, detectorProvenance={"kind": "actual-local-CoreML"})
        result = audit.audit_receipt(receipt, old)
        self.assertEqual(result["checks"]["baselineFramesChecked"], 7)
        for case in ("clock", "detections", "surface", "input", "wrong-kind"):
            with self.subTest(case=case):
                bad = deepcopy(old)
                if case == "clock": bad["clips"][0]["frames"][0]["timeMs"] += 1
                elif case == "detections": bad["clips"][0]["frames"][0]["detections"] = []
                elif case == "surface": bad["clips"][0]["frames"][0]["A"]["epoch"] += 1
                elif case == "input": bad["inputSha256"] = "other"
                else: bad["detectorProvenance"]["kind"] = "cached"
                with self.assertRaises(ValueError): audit.audit_receipt(receipt, bad)


if __name__ == "__main__":
    unittest.main()
