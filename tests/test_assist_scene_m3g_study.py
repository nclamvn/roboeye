"""M3G replay provenance/scoring tests, not detector or looming quality evidence."""

from copy import deepcopy
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/"scripts"))
from assist_scene_m3g_study import CODE, DETECTOR_CONFIGURATION, HERE, LANES, cached_observation, load_cache, score
from assist_scene_motion import sha256
import cv2
from assist_scene_m3e_study import output, CLAIM


BOX = {"x": .4, "y": .4, "width": .1, "height": .1}


def sample():
    frames, gold = [], []
    for i, state in enumerate(("approaching", "not-approaching", None)):
        at = float(i*80)
        track = {"id": 1, "label": "car", "score": .8, "box": BOX}
        lane = output({"epoch": 0, "status": "valid", "tracks": [track], "diagnostics": {}, "events": []}, at)
        candidate = deepcopy(lane)
        candidate["events"] = [{"trackId": 1, "label": "car", "kind": CLAIM, "epoch": 0, "timeMs": at}]
        frames.append({"token": str(i), "timestampUs": i*80_000, "timeMs": at,
                       "detections": [track],
                       **{name: deepcopy(candidate if name in {"B", "D", "E", "S"} else lane) for name in LANES},
                       "timingsMs": dict.fromkeys(("sharedPrep", *LANES), 2.),
                       "detectorObservationMs": 10.})
        if state:
            gold.append({"token": str(i), "timestampUs": i*80_000,
                         "targets": [{"instance": "checked", "classFamily": "vehicle", "box": BOX, "approach": state}]})
    rec = {"schemaVersion": 1, "inputSha256": "input", "dataset": "test", "platform": "Mac", "opencv": "test",
           "codeSha256": {}, "detectorProvenance": {"kind": "cached-historical-real-model"},
           "clips": [{"id": "clip", "detectorConfiguration": {}, "frames": frames}]}
    truth = {"schemaVersion": 1, "inputSha256": "input", "clips": [{"id": "clip", "frames": gold}]}
    return rec, truth


def cache_sample():
    source = {"schemaVersion": 1, "dataset": "Boreas-real", "clips": [{"id": "clip", "frames": [
        {"token": "first", "timestampUs": 1_000_000}, {"token": "second", "timestampUs": 1_080_000}]}]}
    box = {"label": "car", "score": .8, "box": deepcopy(BOX)}
    frames = [{"token": f["token"], "timestampUs": f["timestampUs"], "timeMs": float(i*80), "index": i,
               "detectorGapInjected": False, "width": 768, "height": 384, "nativeWidth": 2304, "nativeHeight": 1152,
               "detections": [box], "candidateDetections": [box], "timingsMs": {"detector": 12.}}
              for i, f in enumerate(source["clips"][0]["frames"])]
    rec = {"schemaVersion": 1, "dataset": "Boreas-real", "inputSha256": "input", "sceneqaSha256": "exe",
           "yoloModelHashes": {"model": "model-hash"}, "opencv": cv2.__version__,
           "codeSha256": {n: sha256(HERE/n) for n in ("assist_scene_m3f_study.py", "assist_scene_m3e_study.py")},
           "clips": [{"id": "clip", "detectorConfiguration": deepcopy(DETECTOR_CONFIGURATION), "frames": frames}]}
    return source, rec


class M3GStudyTests(unittest.TestCase):
    def test_provenance_fingerprints_called_parsers_pose_validator_and_legacy_scorer(self):
        self.assertTrue({"assist_scene_pose_motion.py", "assist_scene_motion.py",
                         "score-assist-scene-motion-m3c.py"} <= set(CODE))
        self.assertEqual(len(CODE), len(set(CODE)))
        for name in CODE:
            self.assertTrue((HERE/name).is_file(), name)

    def test_same_physical_positive_and_negative_remain_and_unscored_is_not_false(self):
        result = score(*sample())
        self.assertEqual((result["totals"]["A"]["fn"], result["totals"]["A"]["tn"]), (1, 1))
        self.assertEqual((result["totals"]["B"]["tp"], result["totals"]["B"]["fp"]), (1, 1))
        self.assertEqual(result["totals"]["B"]["unscoredFrameReports"], 1)
        self.assertEqual(result["noMetreChecks"], 3*len(LANES))
        self.assertEqual(result["detectorProvenance"]["kind"], "cached-historical-real-model")
        for name in LANES:
            self.assertEqual(result["stageMs"][name+"PlusSharedPrep"]["p95"], 4.)

    def test_score_rejects_measurements_stale_events_missing_labels_and_input_mismatch(self):
        for case in ("metres", "stale", "kind", "missing", "input", "duplicate", "nan-clock",
                     "fake-clock", "reverse-clock", "gap", "nested-track-metres", "nested-event-distance",
                     "nonfinite-diagnostic", "wrong-answer-kind", "extra-answer", "missing-lane", "malformed-lane"):
            with self.subTest(case=case):
                rec, truth = sample()
                first = rec["clips"][0]["frames"][0]
                if case == "metres": first["B"]["answers"]["distance"]["metres"] = 3.
                elif case == "stale": first["B"]["events"][0]["epoch"] = 1
                elif case == "kind": first["B"]["events"][0]["kind"] = "world-motion"
                elif case == "missing": truth["clips"][0]["frames"][0]["token"] = "absent"
                elif case == "input": truth["inputSha256"] = "wrong"
                elif case == "duplicate": rec["clips"][0]["frames"].append(first)
                elif case == "nan-clock": first["timeMs"] = float("nan")
                elif case == "fake-clock":
                    first["timeMs"] = 999999.
                    for lane in LANES:
                        for event in first[lane]["events"]: event["timeMs"] = 999999.
                elif case == "reverse-clock": rec["clips"][0]["frames"][1]["timestampUs"] = -1
                elif case == "gap": first["detectorGapInjected"] = True; first["detections"] = []
                elif case == "nested-track-metres": first["B"]["tracks"][0]["extra"] = {"metres": 3.}
                elif case == "nested-event-distance": first["B"]["events"][0]["extra"] = [{"distance": 3.}]
                elif case == "nonfinite-diagnostic": first["B"]["diagnostics"]["confidence"] = float("inf")
                elif case == "wrong-answer-kind": first["B"]["answers"]["kind"] = "world-motion"
                elif case == "extra-answer": first["B"]["answers"]["other"] = 3.
                elif case == "missing-lane": del first[LANES[-1]]
                elif case == "malformed-lane": first[LANES[-1]] = None
                with self.assertRaises(ValueError): score(rec, truth)

    def test_full_runtime_binding_covers_unreviewed_frame_not_only_sparse_truth(self):
        rec, truth = sample()
        source = {"dataset": rec["dataset"], "clips": [{"id": "clip", "frames": [
            {"token": f["token"], "timestampUs": f["timestampUs"]} for f in rec["clips"][0]["frames"]]}]}
        score(rec, truth, source)
        for case in ("unreviewed-token", "unreviewed-clock", "missing-source", "extra-source", "dataset"):
            with self.subTest(case=case):
                altered = deepcopy(source)
                frames = altered["clips"][0]["frames"]
                if case == "unreviewed-token": frames[-1]["token"] = "different"
                elif case == "unreviewed-clock": frames[-1]["timestampUs"] += 1
                elif case == "missing-source": frames.pop()
                elif case == "extra-source": frames.append(frames[-1])
                elif case == "dataset": altered["dataset"] = "different"
                with self.assertRaises(ValueError): score(rec, truth, altered)

    def test_cache_requires_same_model_source_frame_order_clock_and_nonroi_provenance(self):
        src, original = cache_sample()
        with tempfile.TemporaryDirectory(prefix="codex-tmp-assist-m3g-cache-test-20261116-") as folder:
            p = Path(folder)/"cache.json"
            p.write_text(json.dumps(original))
            rec = load_cache(p, src, "input", "exe", {"model": "model-hash"})
            boxes, timing = cached_observation(rec["clips"][0]["frames"][0], 768, 384, 2304, 1152)
            self.assertEqual(len(boxes), 1)
            self.assertEqual(timing, 12.)
            for case in ("model", "exe", "input", "clock", "nan-clock", "index", "token", "gap", "candidate", "config", "nonfinite", "staging", "opencv"):
                with self.subTest(case=case):
                    rec = deepcopy(original)
                    f = rec["clips"][0]["frames"][0]
                    if case == "model": rec["yoloModelHashes"]["model"] = "other"
                    elif case == "exe": rec["sceneqaSha256"] = "other"
                    elif case == "input": rec["inputSha256"] = "other"
                    elif case == "clock": f["timeMs"] += .01
                    elif case == "nan-clock": f["timeMs"] = float("nan")
                    elif case == "index": f["index"] = 1
                    elif case == "token": f["token"] = "other"
                    elif case == "gap": f["detectorGapInjected"] = True
                    elif case == "candidate": del f["candidateDetections"]
                    elif case == "config": rec["clips"][0]["detectorConfiguration"] = None
                    elif case == "nonfinite": f["timingsMs"]["detector"] = float("nan")
                    elif case == "staging": rec["codeSha256"]["assist_scene_m3f_study.py"] = "other"
                    elif case == "opencv": rec["opencv"] = "different"
                    p.write_text(json.dumps(rec))
                    with self.assertRaises(ValueError): load_cache(p, src, "input", "exe", {"model": "model-hash"})

    def test_cached_box_geometry_and_full_input_are_validated_not_candidate_boxes(self):
        _, rec = cache_sample()
        f = rec["clips"][0]["frames"][0]
        f["candidateDetections"] = []
        self.assertEqual(len(cached_observation(f, 768, 384, 2304, 1152)[0]), 1)
        with self.assertRaises(ValueError): cached_observation(f, 768, 385, 2304, 1152)
        f["detections"][0]["box"]["width"] = 2.
        with self.assertRaises(ValueError): cached_observation(f, 768, 384, 2304, 1152)
