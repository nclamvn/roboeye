import copy
import importlib.util
from pathlib import Path
import unittest
import tempfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("court_evaluate", ROOT / "scripts/court_evaluate.py")
court = importlib.util.module_from_spec(spec)
spec.loader.exec_module(court)


class CourtEvaluationTests(unittest.TestCase):
    def test_gold_requires_seal_fixed_sampling_and_explicit_unknowns(self):
        rgb = {"clips": [{"id": "clip-1", "frameCount": 24, "width": 100, "height": 80}]}
        gold = {"schemaVersion": court.GOLD_SCHEMA, "rgbManifestSha256": "a" * 64,
            "matching": {"metric": "native-pixel-center-distance", "radiusPixels": 8},
            "labelProvenance": {"kind": "assistant-visual-annotation", "sealed": True, "independentHumanReview": False,
                "modelOutputsSeenDuringAnnotation": False, "derivedFromPublishedLandingPoints": False, "annotator": "test-only assistant fixture"},
            "clips": [{"id": "clip-1", "sampling": {"selectedIndices": [(i * 23) // 11 for i in range(12)]},
                "labels": [{"index": i, "status": "unknown", "point": None, "reason": "unreviewed fixture"} for i in range(24)]}]}
        court.validate_gold(gold, rgb, "a" * 64)
        for mutate in (lambda g: g["matching"].update(radiusPixels=9), lambda g: g["labelProvenance"].update(sealed=False),
            lambda g: g["labelProvenance"].update(independentHumanReview=True),
            lambda g: g["clips"][0]["labels"][1].update(status="absent"),
            lambda g: g["clips"][0]["labels"][0].update(status="visible", point=None),
            lambda g: g["clips"][0]["sampling"].update(selectedIndices=list(range(12)))):
            value = copy.deepcopy(gold)
            mutate(value)
            with self.assertRaises(ValueError):
                court.validate_gold(value, rgb, "a" * 64)

    def test_gold_digest_detects_tamper_even_when_sealed_flag_remains_true(self):
        directory = ROOT / ".court-cache" / "tests"
        directory.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=directory, prefix="gold-seal-") as temporary:
            path = Path(temporary) / "gold.json"
            path.write_text('{"sealed":true,"point":[1,2]}')
            expected = court.file_sha(path)
            self.assertEqual(court.require_gold_sha(path, expected), expected)
            path.write_text('{"sealed":true,"point":[2,2]}')
            with self.assertRaisesRegex(ValueError, "changed since"):
                court.require_gold_sha(path, expected)
    def test_wrong_location_counts_both_false_positive_and_miss(self):
        session = {"frames": [
            {"index": 0, "status": "observed", "ball": {"x": 4, "y": 5}},
            {"index": 1, "status": "observed", "ball": {"x": 50, "y": 50}},
            {"index": 2, "status": "missing", "ball": None},
            {"index": 3, "status": "observed", "ball": {"x": 5, "y": 5}},
            {"index": 4, "status": "ambiguous", "ball": None},
            {"index": 5, "status": "observed", "ball": {"x": 5, "y": 5}},
        ]}
        labels = [
            {"index": 0, "status": "visible", "point": [4, 5]},
            {"index": 1, "status": "visible", "point": [5, 5]},
            {"index": 2, "status": "visible", "point": [5, 5]},
            {"index": 3, "status": "absent", "point": None},
            {"index": 4, "status": "absent", "point": None},
            {"index": 5, "status": "unknown", "point": None},
        ]
        counts = court.score_clip(session, labels)["counts"]
        self.assertEqual([counts[x] for x in ("TP", "FP", "FN", "TN")], [1, 2, 2, 1])
        self.assertEqual(counts["unknown"], 1)
        self.assertEqual(counts["unknownPredicted"], 1)
        self.assertEqual(counts["scoredFrames"], 5)

    def test_fixed_native_eight_pixel_gate(self):
        session = {"frames": [{"index": 0, "status": "observed", "ball": {"x": 8, "y": 0}}]}
        labels = [{"index": 0, "status": "visible", "point": [0, 0]}]
        self.assertEqual(court.score_clip(session, labels)["counts"]["TP"], 1)
        session["frames"][0]["ball"]["x"] = 8.001
        result = court.score_clip(session, labels)["counts"]
        self.assertEqual((result["FP"], result["FN"]), (1, 1))
        with self.assertRaises(ValueError):
            court.score_clip(session, labels, 9)

    def test_unknown_never_becomes_true_negative(self):
        session = {"frames": [{"index": 0, "status": "missing", "ball": None}]}
        counts = court.score_clip(session, [{"index": 0, "status": "unknown", "point": None}])["counts"]
        self.assertEqual([counts[k] for k in ("TP", "FP", "FN", "TN")], [0, 0, 0, 0])
        self.assertIsNone(counts["precision"])
        self.assertIsNone(counts["recall"])

    def test_prediction_rejects_shifted_frame_stale_ball_and_wrong_source(self):
        clip = {"videoSha256": "a" * 64, "width": 100, "height": 80, "fps": 25, "frameCount": 1, "durationSeconds": .04}
        good = {"schemaVersion": "roboeye-court-session-v1", "source": {"sha256": "a" * 64, **{k: clip[k] for k in ("width", "height", "fps", "frameCount", "durationSeconds")}},
                "decision": {"status": "insufficient-evidence"}, "frames": [{"index": 0, "timeSeconds": 0, "status": "missing", "ball": None}]}
        court.validate_prediction(good, clip)
        for mutate in (lambda s: s["frames"][0].update(timeSeconds=.04), lambda s: s["frames"][0].update(ball={"x": 1, "y": 2}),
                       lambda s: s["source"].update(sha256="b" * 64), lambda s: s["decision"].update(status="out")):
            value = copy.deepcopy(good)
            mutate(value)
            with self.assertRaises(ValueError):
                court.validate_prediction(value, clip)


if __name__ == "__main__":
    unittest.main()
