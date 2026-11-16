"""M3H provenance/score contracts, not real detection or motion-quality evidence."""

from copy import deepcopy
import inspect
import json
from pathlib import Path
import sys
import tempfile
import unittest

import cv2

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/"scripts"))
from assist_scene_motion import sha256
from assist_scene_m3e_study import CLAIM, output
from assist_scene_m3h_study import (
    CACHE_PIPELINE, CODE, DETECTOR_CONFIGURATION, HERE, LANES, cached_observation,
    cohort_contract, lifecycle_summary, load_cache, read_json, replay, run_clip, score,
)


BOX = {"x": .4, "y": .4, "width": .1, "height": .1}


def sample():
    frames, labels = [], []
    for i in range(7):
        at = float(i*80)
        track = {"id": 1, "label": "car", "score": .8, "box": deepcopy(BOX)}
        lane = output({"epoch": 0, "status": "valid", "tracks": [track], "events": [],
                       "diagnostics": {}}, at)
        candidate = deepcopy(lane)
        candidate["diagnostics"] = {
            "identityDecisions": {"1": {"reason": "appearance-supported", "kept": True}},
            "cohorts": {"1": [{"cohortId": 2, "bornMs": 0., "ageMs": at, "lastMs": at,
                                  "mature": i >= 4, "confirmed": i >= 4, "validSamples": i+1,
                                  "initialPoints": 32, "currentPoints": 27}]},
            "retiredCohorts": {"1": [{"cohortId": 0, "reason": "expired", "ageMs": 800.}]},
            "bounds": {"identityCount": 1, "cohortCount": 1, "cohortPoints": 27},
        }
        if i >= 4:
            candidate["events"] = [{"kind": CLAIM, "trackId": 1, "label": "car", "epoch": 0,
                                     "timeMs": at, "observationMs": at, "supportingCohortIds": [2]}]
        rows = {name: deepcopy(lane) for name in LANES}
        rows["B"] = candidate
        rows["S"] = deepcopy(candidate)
        frames.append({"token": str(i), "timestampUs": i*80_000, "timeMs": at, "index": i,
                       "detectorGapInjected": False, "detections": [track], **rows,
                       "detectorObservationMs": 10.,
                       "timingsMs": dict.fromkeys(("sharedPrep", "workingDecode", "nativeDecode", *LANES), 2.)})
        if i in (4, 5):
            labels.append({"token": str(i), "timestampUs": i*80_000,
                           "targets": [{"instance": "checked", "classFamily": "vehicle", "box": deepcopy(BOX),
                                        "approach": "approaching" if i == 4 else "not-approaching"}]})
    receipt = {"schemaVersion": 1, "study": "M3H", "dataset": "test", "inputSha256": "input",
               "platform": "Mac", "opencv": "test", "codeSha256": {},
               "detectorProvenance": {"kind": "cached-historical-real-model"},
               "clips": [{"id": "clip", "detectorConfiguration": {}, "frames": frames}]}
    truth = {"schemaVersion": 1, "inputSha256": "input", "clips": [{"id": "clip", "frames": labels}]}
    return receipt, truth


def source_for(receipt):
    return {"dataset": receipt["dataset"], "clips": [{"id": c["id"], "frames": [
        {"token": f["token"], "timestampUs": f["timestampUs"]} for f in c["frames"]]} for c in receipt["clips"]]}


def cache_sample():
    source = {"dataset": "Boreas-real", "clips": [{"id": "clip", "frames": [
        {"token": "first", "timestampUs": 1_000_000}, {"token": "second", "timestampUs": 1_080_000}]}]}
    frames = [{"token": f["token"], "timestampUs": f["timestampUs"], "timeMs": float(i*80), "index": i,
               "detectorGapInjected": False, "width": 768, "height": 384, "nativeWidth": 2304, "nativeHeight": 1152,
               "detections": [{"label": "car", "score": .8, "box": deepcopy(BOX)}],
               "detectorObservationMs": 12.}
              for i, f in enumerate(source["clips"][0]["frames"])]
    receipt = {"schemaVersion": 1, "dataset": "Boreas-real", "inputSha256": "input", "sceneqaSha256": "exe",
               "yoloModelHashes": {"model": "model-hash"}, "opencv": cv2.__version__,
               "detectorProvenance": {"kind": "actual-local-CoreML"},
               "codeSha256": {name: sha256(HERE/name) for name in (*CACHE_PIPELINE, "assist_scene_m3g_study.py")},
               "clips": [{"id": "clip", "detectorConfiguration": deepcopy(DETECTOR_CONFIGURATION), "frames": frames}]}
    return source, receipt


class M3HStudyTests(unittest.TestCase):
    def test_fingerprints_output_dependencies_and_inference_has_no_reference_argument(self):
        self.assertTrue({"assist_scene_m3h_study.py", "assist_scene_cohort_loom.py", "assist_scene_m3g_study.py",
                         "assist_scene_pose_motion.py", "assist_scene_motion.py", "score-assist-scene-motion-m3c.py"} <= set(CODE))
        self.assertEqual(len(CODE), len(set(CODE)))
        self.assertNotIn("truth", inspect.signature(run_clip).parameters)
        self.assertNotIn("truth", inspect.signature(replay).parameters)
        self.assertNotIn("read_json(", inspect.getsource(run_clip))

    def test_keeps_physical_positives_negatives_and_unreviewed_reports_separate(self):
        receipt, truth = sample()
        result = score(receipt, truth, source_for(receipt))
        self.assertEqual((result["totals"]["A"]["fn"], result["totals"]["A"]["tn"]), (1, 1))
        self.assertEqual((result["totals"]["B"]["tp"], result["totals"]["B"]["fp"]), (1, 1))
        self.assertEqual(result["totals"]["B"]["unscoredFrameReports"], 1)
        self.assertEqual(result["noMetreChecks"], 7*len(LANES))
        self.assertEqual(result["stageMs"]["BPlusSharedPrep"]["p95"], 4.)
        life = result["clips"][0]["lifecycle"]["B"]
        self.assertEqual(life["observedInternalIds"], 1)
        self.assertEqual(life["maxObservedIdSpanMs"], 480.)
        self.assertIn("NOT GT", life["scope"])

    def test_rejects_fake_clock_gap_metres_missing_lane_and_nonfinite_payloads(self):
        for case in ("nan-clock", "fake-clock", "reverse-clock", "gap", "track-metres", "event-distance",
                     "answer", "nonfinite-diag", "missing-lane", "stale-epoch", "wrong-kind", "missing-label"):
            with self.subTest(case=case):
                receipt, truth = sample()
                frame = receipt["clips"][0]["frames"][4]
                b = frame["B"]
                if case == "nan-clock": frame["timeMs"] = float("nan")
                elif case == "fake-clock":
                    frame["timeMs"] = 999999.
                    for lane in LANES:
                        for event in frame[lane]["events"]: event["timeMs"] = frame["timeMs"]
                elif case == "reverse-clock": frame["timestampUs"] = 0
                elif case == "gap": frame["detectorGapInjected"] = True; frame["detections"] = []
                elif case == "track-metres": b["tracks"][0]["meta"] = {"metres": 3.}
                elif case == "event-distance": b["events"][0]["meta"] = {"distance": 3.}
                elif case == "answer": b["answers"]["distance"]["metres"] = 3.
                elif case == "nonfinite-diag": b["diagnostics"]["confidence"] = float("inf")
                elif case == "missing-lane": del frame["S"]
                elif case == "stale-epoch": b["events"][0]["epoch"] = 1
                elif case == "wrong-kind": b["events"][0]["kind"] = "world-motion"
                elif case == "missing-label": truth["clips"][0]["frames"][0]["token"] = "absent"
                with self.assertRaises(ValueError): score(receipt, truth)

    def test_warning_age_is_fresh_mature_cohort_age_not_object_age(self):
        receipt, _ = sample()
        surface = receipt["clips"][0]["frames"][5]["B"]
        cohort_contract(surface, 400.)
        for case in ("new-cohort", "stale-cohort", "unconfirmed", "not-mature", "short-history", "unknown-id",
                     "no-id", "duplicate-id", "noninteger-id", "object-age", "wrong-age", "no-points", "excess-points"):
            with self.subTest(case=case):
                bad = deepcopy(surface)
                event = bad["events"][0]
                c = bad["diagnostics"]["cohorts"]["1"][0]
                if case == "new-cohort": c["bornMs"] = 320.; c["ageMs"] = 80.
                elif case == "stale-cohort": c["lastMs"] = 320.
                elif case == "unconfirmed": c["confirmed"] = False
                elif case == "not-mature": c["mature"] = False
                elif case == "short-history": c["validSamples"] = 2
                elif case == "unknown-id": event["supportingCohortIds"] = [99]
                elif case == "no-id": event["supportingCohortIds"] = []
                elif case == "duplicate-id": event["supportingCohortIds"] = [2, 2]
                elif case == "noninteger-id": event["supportingCohortIds"] = [True]
                elif case == "object-age": event["observationMs"] = 800.
                elif case == "wrong-age": c["ageMs"] = 399.
                elif case == "no-points": c["currentPoints"] = 0
                elif case == "excess-points": c["currentPoints"] = 65
                with self.assertRaises(ValueError): cohort_contract(bad, 400.)

    def test_source_binding_includes_unreviewed_frames(self):
        receipt, truth = sample()
        for case in ("token", "timestamp", "remove", "extra", "dataset"):
            with self.subTest(case=case):
                source = source_for(receipt)
                frames = source["clips"][0]["frames"]
                if case == "token": frames[-1]["token"] = "wrong"
                elif case == "timestamp": frames[-1]["timestampUs"] += 1
                elif case == "remove": frames.pop()
                elif case == "extra": frames.append(frames[-1])
                elif case == "dataset": source["dataset"] = "different"
                with self.assertRaises(ValueError): score(receipt, truth, source)

    def test_cache_accepts_bound_original_m3g_records_without_m3f_roi_fields(self):
        source, receipt = cache_sample()
        with tempfile.TemporaryDirectory(prefix="codex-tmp-assist-m3h-study-test-20261116-") as folder:
            path = Path(folder)/"cache.json"
            path.write_text(json.dumps(receipt))
            accepted = load_cache(path, source, "input", "exe", {"model": "model-hash"})
            frame = accepted["clips"][0]["frames"][0]
            boxes, ms = cached_observation(frame, 768, 384, 2304, 1152)
            self.assertEqual((len(boxes), ms), (1, 12.))
            self.assertNotIn("candidateDetections", frame)
            for case in ("model", "exe", "input", "nan", "clock", "index", "gap", "missing-detections",
                         "staging", "runner", "config", "opencv", "model-timing", "missing-frame", "token", "provenance"):
                with self.subTest(case=case):
                    bad = deepcopy(receipt)
                    frame = bad["clips"][0]["frames"][0]
                    if case == "model": bad["yoloModelHashes"] = {}
                    elif case == "exe": bad["sceneqaSha256"] = "wrong"
                    elif case == "input": bad["inputSha256"] = "wrong"
                    elif case == "nan": frame["timeMs"] = float("nan")
                    elif case == "clock": frame["timeMs"] += .1
                    elif case == "index": frame["index"] = True
                    elif case == "gap": frame["detectorGapInjected"] = True; frame["detections"] = []
                    elif case == "missing-detections": del frame["detections"]
                    elif case == "staging": bad["codeSha256"][CACHE_PIPELINE[0]] = "wrong"
                    elif case == "runner": bad["codeSha256"]["assist_scene_m3g_study.py"] = "wrong"
                    elif case == "config": bad["clips"][0]["detectorConfiguration"] = {}
                    elif case == "opencv": bad["opencv"] = "wrong"
                    elif case == "model-timing": frame["detectorObservationMs"] = float("inf")
                    elif case == "missing-frame": bad["clips"][0]["frames"].pop()
                    elif case == "token": frame["token"] = "wrong"
                    elif case == "provenance": bad["detectorProvenance"] = {"kind": "simulated"}
                    path.write_text(json.dumps(bad))
                    with self.assertRaises(ValueError): load_cache(path, source, "input", "exe", {"model": "model-hash"})

    def test_cached_boxes_validate_geometry_and_never_use_candidate_or_tracker_boxes(self):
        _, receipt = cache_sample()
        frame = receipt["clips"][0]["frames"][0]
        frame["candidateDetections"] = []
        frame["B"] = {"tracks": []}
        self.assertEqual(len(cached_observation(frame, 768, 384, 2304, 1152)[0]), 1)
        with self.assertRaises(ValueError): cached_observation(frame, 768, 385, 2304, 1152)
        frame["detections"][0]["box"]["width"] = 2.
        with self.assertRaises(ValueError): cached_observation(frame, 768, 384, 2304, 1152)

    def test_bounded_artifact_reads_and_all_scene_negatives_are_explicit(self):
        with tempfile.TemporaryDirectory(prefix="codex-tmp-assist-m3h-study-test-20261116-") as folder:
            path = Path(folder)/"record.json"
            path.write_text('{"number": NaN}')
            with self.assertRaises(ValueError): read_json(path)
            path.write_text('{}')
            with self.assertRaises(ValueError): read_json(path, 1)
        receipt, truth = sample()
        truth["clips"][0]["allSceneNegative"] = True
        result = score(receipt, truth)
        self.assertEqual(result["totals"]["B"]["allSceneFalseNotices"], 3)


if __name__ == "__main__":
    unittest.main()
