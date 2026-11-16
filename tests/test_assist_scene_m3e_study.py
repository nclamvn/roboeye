"""M3E score boundary; these fixtures test provenance and arithmetic, not recall."""

from copy import deepcopy
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/"scripts"))
from assist_scene_m3e_study import CLAIM, LANES, output, score


BOX = {"x": .4, "y": .4, "width": .15, "height": .1}


def event(time):
    return {"trackId": 2, "label": "car", "kind": CLAIM, "epoch": 1, "timeMs": time}


def example():
    frames = []
    gold = []
    for index, label in enumerate(("not-approaching", "approaching", None)):
        t = 80*index
        has_event = index != 1
        tracks = [{"id": 2, "label": "car", "box": BOX}]
        lane = output({"tracks": tracks, "epoch": 1, "status": "valid",
                       "events": [event(t)] if has_event else []}, t)
        frames.append({"token": str(index), "index": index, "timestampUs": t*1000, "timeMs": t, "detections": tracks,
                       "timingsMs": dict.fromkeys(("detector","sharedPrep","nativeDecode",*LANES), 2.),
                       **{n: deepcopy(lane) for n in LANES}})
        if label is not None:
            gold.append({"token": str(index), "timestampUs": t*1000,
                         "targets": [{"instance": "checked", "classFamily": "vehicle", "box": BOX, "approach": label}]})
    prediction = {"schemaVersion": 1, "inputSha256": "digest", "platform": "Mac", "opencv": "test",
                  "codeSha256": {}, "dataset": "test-fixture",
                  "clips": [{"id": "clip", "detectorConfiguration": {}, "frames": frames}]}
    truth = {"schemaVersion": 1, "inputSha256": "digest",
             "clips": [{"id": "clip", "frames": gold}]}
    return prediction, truth


class M3EStudyTests(unittest.TestCase):
    def test_unreviewed_reports_are_not_miscounted_as_false(self):
        result = score(*example())
        a = result["totals"]["A"]
        self.assertEqual((a["fp"], a["fn"], a["unscoredFrameReports"]), (1, 1, 1))
        self.assertEqual(result["noMetreChecks"], 15)
        self.assertEqual(result["stageMs"]["BPlusNativeDecode"]["p95"], 4.)

    def test_reject_metric_stale_duplicate_or_cross_input(self):
        for mut in ("measurement", "stale", "duplicate", "bad-input", "wrong-kind"):
            with self.subTest(mut=mut):
                receipt, gold = example()
                first = receipt["clips"][0]["frames"][0]["B"]
                if mut == "measurement":
                    first["answers"]["distance"]["metres"] = 2.5
                if mut == "stale":
                    first["events"][0]["epoch"] -= 1
                if mut == "duplicate":
                    first["events"].append(first["events"][0])
                if mut == "bad-input":
                    gold["inputSha256"] += "changed"
                if mut == "wrong-kind":
                    first["events"][0]["kind"] = "world-motion"
                with self.assertRaises(ValueError):
                    score(receipt, gold)
