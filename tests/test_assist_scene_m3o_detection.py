"""M3O CPU-only matching/provenance controls, no detector execution."""

from copy import deepcopy
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/"scripts"))
import assist_scene_m3o_detection as study


def box(x=.1, y=.1, width=.2, height=.2):
    return {"x": x, "y": y, "width": width, "height": height}


def detection(x=.1, label="car", score=.9):
    return {"label": label, "score": score, "box": box(x)}


def target(x=.1, instance="one", family="vehicle", approach="approaching"):
    return {"instance": instance, "classFamily": family, "approach": approach, "box": box(x)}


def sample():
    frame = {"clipId": "clip", "index": 0, "token": "f0", "timestampUs": 1000,
        "sourceSha256": "a"*64, "width": 200, "height": 100,
        "providers": {"yolov3": {"detections": [detection()], "observation": {
            "width": 200, "height": 100, "orientation": 1, "tracks": [detection()], "detectionMs": 2.}}}}
    frame["workingJpegSha256"] = "c"*64
    frame["providers"]["yolov3"]["observationBinding"] = {k: frame[k] for k in ("token", "timestampUs", "sourceSha256", "workingJpegSha256")}
    receipt = {"study": "M3O-detection", "schemaVersion": 1, "inputSha256": "input", "frames": [frame]}
    truth = {"schemaVersion": 1, "inputSha256": "input", "clips": [{"id": "clip", "frames": [
        {"token": "f0", "timestampUs": 1000, "targets": [target()]}]}]}
    inputs = {"clips": [{"id": "clip", "frames": [{"token": "f0", "timestampUs": 1000, "sha256": "a"*64}]}]}
    return receipt, truth, inputs


class M3ODetectionTests(unittest.TestCase):
    def test_detector_rectangles_require_finite_positive_normalized_extent(self):
        for bounds in (box(width=0), box(height=-.1), box(x=float("nan")), box(x=.9), box(y=True)):
            with self.subTest(bounds=bounds), self.assertRaises(ValueError):
                study.normalize_detection({"label": "car", "box": bounds})

    def test_failure_sidecar_is_explicit_partial_and_never_overwrites(self):
        import tempfile
        import json
        with tempfile.TemporaryDirectory(prefix="codex-tmp-m3o-test-20261116-") as folder:
            output = Path(folder)/"receipt.json"
            path = study.write_failure(output, {"phase": "old-detector-batch", "completedDetectorCalls": {"rtdetr": 10, "yolov3": 0},
                "unresolvedCallsUpperBound": {"rtdetr": 0, "yolov3": 10}}, RuntimeError("authored failure"))
            record = json.loads(path.read_text())
            self.assertFalse(record["completeStudy"])
            self.assertEqual(record["unresolvedCallsUpperBound"]["yolov3"], 10)
            with self.assertRaises(FileExistsError): study.write_failure(output, {}, RuntimeError("second"))

    def test_maximum_cardinality_precedes_total_iou_not_greedy_assignment(self):
        overlaps = [[.9, .8], [.85, .1]]
        fake = SimpleNamespace(family=lambda label: "vehicle",
            iou=lambda d, t: overlaps[t["index"]][d["index"]])
        with patch.object(study, "legacy_score", return_value=fake):
            pairs = study.one_to_one([{"label": "car", "box": {"index": i}} for i in range(2)],
                [{"classFamily": "vehicle", "box": {"index": i}} for i in range(2)], .5)
        self.assertEqual(pairs, [(0, 1), (1, 0)])

    def test_warning_gate_stays_point35_and_point08_missing_score_is_unknown(self):
        expected_iou = .345027524476845
        shift = .2*(1-expected_iou)/(1+expected_iou)
        row = study.frame_diagnostics([detection(.1+shift, score=None)], [target()])
        self.assertEqual(row["targets"][0]["warningCriterionStatus"], "below-frozen-IoU")
        self.assertAlmostEqual(row["targets"][0]["bestFamily"]["iou"], expected_iou)
        self.assertIsNone(row["targets"][0]["bestFamily"]["score"])
        self.assertEqual(row["targets"][0]["bestFamily"]["scoreState"], "unknown")
        ambiguous = study.frame_diagnostics([detection()], [target(), target(.105, "two")])
        self.assertTrue(all(t["warningCriterionStatus"] == "ambiguous-or-duplicate-assignment" for t in ambiguous["targets"]))

    def test_sparse_unmatched_is_unreviewed_not_false_positive(self):
        detections = [detection(), detection(.7), detection(.5, "traffic light")]
        sparse = study.frame_diagnostics(detections, [target()])
        exhaustive = study.frame_diagnostics(detections, [target()], exhaustive=True)
        self.assertIsNone(sparse["diagnosticIoUCurve"]["0.35"]["falsePositiveDetections"])
        self.assertEqual(sparse["diagnosticIoUCurve"]["0.35"]["unreviewedDetections"], 1)
        self.assertEqual(exhaustive["diagnosticIoUCurve"]["0.35"]["falsePositiveDetections"], 1)
        self.assertEqual(exhaustive["diagnosticIoUCurve"]["0.35"]["outOfScopeDetections"], 1)

    def test_duplicate_detector_export_cannot_match_one_target_twice(self):
        result = study.frame_diagnostics([detection(), detection()], [target()])
        self.assertEqual(result["diagnosticIoUCurve"]["0.35"]["matchedTargets"], 1)
        self.assertEqual(result["targets"][0]["warningCriterionStatus"], "ambiguous-or-duplicate-assignment")
        self.assertEqual(result["warningAssignment"]["duplicateAssignments"], 2)

    def test_checkpoint_selection_uses_keys_only_and_call_budget_is_bounded(self):
        receipt, truth, inputs = sample()
        selected = study.checkpoint_keys(inputs, truth, "input")
        self.assertNotIn("targets", selected[0])
        for case in ("hash", "clock", "duplicate", "budget"):
            with self.subTest(case=case):
                reviewed = deepcopy(truth); sources = deepcopy(inputs)
                if case == "hash": reviewed["inputSha256"] = "other"
                elif case == "clock": reviewed["clips"][0]["frames"][0]["timestampUs"] = 1001
                elif case == "duplicate": reviewed["clips"][0]["frames"] *= 2
                else:
                    sources["clips"][0]["frames"] = [{"token": str(i), "timestampUs": i, "sha256": "a"*64} for i in range(21)]
                    reviewed["clips"][0]["frames"] = [{"token": str(i), "timestampUs": i} for i in range(21)]
                with self.assertRaises(ValueError): study.checkpoint_keys(sources, reviewed, "input")

    def test_raw_output_source_clock_and_fingerprint_tampering_fail(self):
        for case in ("raw", "clock", "source", "duplicate", "missing-review"):
            with self.subTest(case=case):
                receipt, truth, inputs = sample(); row = receipt["frames"][0]
                if case == "raw": row["providers"]["yolov3"]["observation"]["tracks"] = []
                elif case == "clock": row["timestampUs"] += 1
                elif case == "source": row["sourceSha256"] = "b"*64
                elif case == "duplicate": receipt["frames"] *= 2
                else: truth["clips"][0]["frames"][0]["token"] = "absent"
                with self.assertRaises(ValueError): study.score(receipt, truth, inputs)

    def test_score_retains_unknown_fp_and_positive_target_unit(self):
        receipt, truth, inputs = sample()
        result = study.score(receipt, truth, inputs)
        summary = result["totals"]["yolov3"]
        self.assertEqual((summary["approachingTargets"], summary["approachingQualified"]), (1, 1))
        self.assertIsNone(summary["diagnosticIoUCurve"]["0.35"]["falsePositiveDetections"])
        self.assertEqual(result["warningIoU"], .35)
        self.assertEqual(result["warningMargin"], .08)


if __name__ == "__main__": unittest.main()
