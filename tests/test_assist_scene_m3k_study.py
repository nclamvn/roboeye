"""M3K runner/receipt contracts; authored fixtures, not model quality evidence."""

from copy import deepcopy
import inspect
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/"scripts"))
import assist_scene_m3k_study as study
from assist_scene_learned_detector import ARTIFACTS, ID2LABEL, MODEL_ID, POLICY as DETECTOR_POLICY, REVISION
from assist_scene_learned_region import POLICY as FLOW_POLICY
from test_assist_scene_m3h_study import sample as previous_sample, cache_sample as previous_cache_sample


def observation(token, at, fingerprint, *, height=100, width=200):
    return {"method": "rtdetr-v2-r18vd", "device": "mps", "nativeShape": [height, width],
        "workingShape": [height, width], "token": token, "timeMs": at, "sourceSha256": fingerprint,
        "timing": {"preprocessMs": 1., "inferenceMs": 7., "postprocessMs": 2., "wallMs": 10.},
        "prediction": {"scores": [], "labels": [], "boxes": []}, "id2label": dict(ID2LABEL),
        "rawCandidates": 0, "invalidRejected": 0, "belowThreshold": 0,
        "duplicatesSuppressed": 0, "overCap": 0, "detections": 0}


def sample():
    receipt, truth = previous_sample()
    receipt.update(study="M3K", developmentOnly=False, opencv=cv2.__version__, numpy=np.__version__,
        policies=study.policy_snapshot(), device="mps", sceneqaSha256="a"*64,
        yoloModelHashes={"model": "b"*64}, codeSha256={n: study.sha256(study.HERE/n) for n in study.CODE},
        detectorProvenance={"kind": "actual-local-CoreML-and-PyTorch", "cacheSha256": None,
                            "oldSampleTimings": "actual per-exposure model inference"},
        learnedDetector={"modelId": MODEL_ID, "revision": REVISION,
            "artifactSha256": {n: data[1] for n, data in ARTIFACTS.items()}, "device": "mps", "dtype": "float32",
            "cpuFallback": False, "execution": "actual-local-PyTorch", "policy": dict(DETECTOR_POLICY),
            "versions": {"torch": "fixture", "torchvision": "fixture", "transformers": "fixture",
                         "opencv": cv2.__version__, "numpy": np.__version__}},
        learnedFlow={"kind": "actual-local-pretrained-torchvision", "algorithm": FLOW_POLICY["algorithm"],
            "weights": FLOW_POLICY["weights"], "weightUrl": FLOW_POLICY["weightUrl"],
            "weightsSha256": FLOW_POLICY["weightSha256"], "weightBytes": 4_000_000,
            "torch": "fixture", "torchvision": "fixture", "device": "mps", "policy": dict(FLOW_POLICY)},
        modelStartupMs={"detector": 20., "flow": 30.}, timingScope="authored fixture")
    clip = receipt["clips"][0]
    clip.update(detectorConfiguration=study.DETECTOR_CONFIGURATION,
        detectorExecution="actual-local-CoreML-and-PyTorch", oldDetectorCalls=7, learnedDetectorCalls=7,
        detectorCalls=14, oldDetectorBatches=1, oldDetectorBatchWallMs=100.,
        learnedDetectorWallMs=70., stageWallMs=5., studyWallMs=300., flowDirectionCalls={"C": 0, "D": 0})
    for row in clip["frames"]:
        # Each candidate owns its own immutable engine state, not A's IDs.
        row["C"] = deepcopy(row["B"])
        row["D"] = deepcopy(row["B"])
        row.update(width=200, height=100, nativeWidth=200, nativeHeight=100,
            sourceSha256="c"*64, candidateDetections=[], learnedFlow={"C": [], "D": []},
            flowDirectionCalls={"C": 0, "D": 0}, learnedDetectorObservationMs=10.)
        row["learnedObservation"] = observation(row["token"], row["timeMs"], row["sourceSha256"])
        row["detections"] = []
        row["oldObservation"] = {"width": 200, "height": 100, "orientation": 1,
                                 "tracks": [], "detectionMs": 10.}
        row["timingsMs"] = dict.fromkeys(study.TIMINGS, 2.)
        for lane in study.LEARNED_FLOW_LANES:
            if row[lane]["events"]:
                row["learnedFlow"][lane] = [{"status": "field-supported", "roiShape": [60, 90],
                    "paddedShape": [128, 128], "providerKind": "actual-local-pretrained-torchvision",
                    "token": row["token"], "timeMs": row["timeMs"], "sourceSha256": row["sourceSha256"],
                    "modelDirectionCalls": 2, "wallMs": 1.}]
                row["flowDirectionCalls"][lane] = 2
    clip["flowDirectionCalls"] = {n: sum(f["flowDirectionCalls"][n] for f in clip["frames"]) for n in study.LEARNED_FLOW_LANES}
    return receipt, truth


class M3KStudyTests(unittest.TestCase):
    def test_native_decode_uses_exact_verified_bytes_with_bounded_read(self):
        original = np.full((64, 96, 3), 17, np.uint8)
        encoded, pixels = cv2.imencode(".png", original)
        self.assertTrue(encoded)
        payload = pixels.tobytes()
        with tempfile.TemporaryDirectory(prefix="codex-tmp-m3k-native-test-20261116-") as folder:
            path = Path(folder)/"native.png"; path.write_bytes(payload)
            digest = study.sha256(path)
            self.assertTrue(np.array_equal(study._read_native(path, digest), original))
            # A later path mutation cannot change the bytes already verified.
            decoder = cv2.imdecode
            def mutate_after_verified(buffer, flags):
                path.write_bytes(b"changed-after-verified-read")
                return decoder(buffer, flags)
            with patch.object(study.cv2, "imdecode", side_effect=mutate_after_verified):
                self.assertTrue(np.array_equal(study._read_native(path, digest), original))
            with patch.object(study.cv2, "imdecode") as decode:
                with self.assertRaisesRegex(ValueError, "changed before native decode"):
                    study._read_native(path, digest)
                decode.assert_not_called()
            path.write_bytes(b"x"*(8*1024**2+1))
            with patch.object(study.cv2, "imdecode") as decode:
                with self.assertRaisesRegex(ValueError, "over-budget native exposure bytes"):
                    study._read_native(path, digest)
                decode.assert_not_called()
            path.write_bytes(b"invalid-image")
            with self.assertRaisesRegex(ValueError, "decoded native exposure"):
                study._read_native(path, study.sha256(path))

    def test_only_exact_actual_old_m3j_cache_is_accepted_with_all_original_bindings(self):
        source, cache = previous_cache_sample()
        first = deepcopy(cache["clips"][0]); source["clips"] = []; cache["clips"] = []
        for ident in ("boreas-m3j-urban", "boreas-m3j-following"):
            actual, recorded = [], []
            for index in range(50):
                row = deepcopy(first["frames"][0])
                row.update(token=str(index), timestampUs=1_000_000+index*80_000,
                    index=index, timeMs=float(index*80), sourceSha256="c"*64)
                recorded.append(row)
                actual.append({"token": row["token"], "timestampUs": row["timestampUs"], "sha256": "c"*64})
            source["clips"].append({"id": ident, "frames": actual})
            cache["clips"].append({**deepcopy(first), "id": ident, "frames": recorded,
                "detectorExecution": "actual-local-CoreML", "detectorCalls": 250,
                "fullDetectorBatches": 1, "tileDetectorBatches": 4})
        cache.update(study="M3J", developmentOnly=False, detectorProvenance={"kind": "actual-local-CoreML",
            "cacheSha256": None, "fullSampleTimings": "actual per-exposure model inference"})
        with tempfile.TemporaryDirectory(prefix="codex-tmp-m3k-cache-test-20261116-") as folder:
            path = Path(folder)/"receipt.json"
            path.write_text(json.dumps(cache))
            accepted = study.load_cache(path, source, "input", "exe", {"model": "model-hash"})
            self.assertEqual((accepted["study"], sum(len(c["frames"]) for c in accepted["clips"])), ("M3J", 100))
            for case in ("study", "development", "kind", "cache", "timing", "execution", "calls", "batches",
                         "input", "model", "exe", "clock", "source", "parser", "runner", "gap", "frame-count"):
                with self.subTest(case=case):
                    bad = deepcopy(cache); bound = deepcopy(source)
                    row = bad["clips"][0]["frames"][0]
                    if case == "study": bad["study"] = "M3I"
                    elif case == "development": bad["developmentOnly"] = True
                    elif case == "kind": bad["detectorProvenance"]["kind"] = "cached-historical-real-model"
                    elif case == "cache": bad["detectorProvenance"]["cacheSha256"] = "d"*64
                    elif case == "timing": bad["detectorProvenance"]["fullSampleTimings"] = "historical"
                    elif case == "execution": bad["clips"][0]["detectorExecution"] = "cached"
                    elif case == "calls": bad["clips"][0]["detectorCalls"] = 50
                    elif case == "batches": bad["clips"][0]["fullDetectorBatches"] = 0
                    elif case == "input": bad["inputSha256"] = "wrong"
                    elif case == "model": bad["yoloModelHashes"] = {}
                    elif case == "exe": bad["sceneqaSha256"] = "wrong"
                    elif case == "clock": row["timeMs"] += 1.
                    elif case == "source": row["sourceSha256"] = "d"*64
                    elif case == "parser": bad["codeSha256"]["assist_scene_motion.py"] = "wrong"
                    elif case == "runner":
                        for name in ("assist_scene_m3g_study.py", "assist_scene_m3h_study.py"):
                            bad["codeSha256"][name] = "wrong"
                    elif case == "gap": row["detectorGapInjected"] = True
                    elif case == "frame-count":
                        bad["clips"][0]["frames"].pop(); bound["clips"][0]["frames"].pop()
                    path.write_text(json.dumps(bad))
                    with self.assertRaises(ValueError): study.load_cache(path, bound, "input", "exe", {"model": "model-hash"})

    def test_scores_all_independent_engines_and_keeps_unreviewed_separate(self):
        receipt, truth = sample()
        result = study.score(receipt, truth)
        self.assertEqual(result["totals"]["A"]["fn"], 1)
        for lane in ("B", "C", "D"):
            self.assertEqual((result["totals"][lane]["tp"], result["totals"][lane]["fp"]), (1, 1))
            self.assertEqual(result["totals"][lane]["unscoredFrameReports"], 1)
        self.assertEqual(result["noMetreChecks"], 35)
        self.assertEqual(set(result["clips"][0]["identityLifecycle"]), {"A", "B", "C", "D"})

    def test_detector_reconstructs_raw_prediction_and_rejects_forged_geometry_or_cost(self):
        for case in ("labels", "box", "count", "shape", "token", "hash", "clock", "timing", "device", "raw-budget"):
            with self.subTest(case=case):
                receipt, _ = sample(); row = receipt["clips"][0]["frames"][0]
                obs = row["learnedObservation"]
                if case == "labels": obs["id2label"] = {"3": "car"}
                elif case == "box": row["candidateDetections"] = [{"label": "car"}]
                elif case == "count": obs["detections"] = 2
                elif case == "shape": obs["workingShape"] = [10, 20]
                elif case == "token": obs["token"] = "wrong"
                elif case == "hash": obs["sourceSha256"] = "d"*64
                elif case == "clock": obs["timeMs"] = 80.
                elif case == "timing": obs["timing"]["wallMs"] = 8.
                elif case == "device": obs["device"] = "cpu"
                elif case == "raw-budget": obs["prediction"] = {"scores": [1.]*301, "labels": [3]*301, "boxes": [[1., 1., 2., 2.]]*301}
                with self.assertRaises(ValueError): study.detector_contract(row, "mps")

    def test_flow_trace_binds_exposure_budget_padding_and_complete_engine_cost(self):
        receipt, _ = sample(); row = receipt["clips"][0]["frames"][0]
        record = {"status": "field-supported", "roiShape": [60, 90], "paddedShape": [128, 128],
            "providerKind": "actual-local-pretrained-torchvision", "token": row["token"], "timeMs": 0.,
            "sourceSha256": row["sourceSha256"], "modelDirectionCalls": 2, "wallMs": 1.}
        row["learnedFlow"]["C"] = [record]; row["flowDirectionCalls"]["C"] = 2
        study.flow_contract(row, "C")
        for case in ("one-direction", "fallback", "unsupported", "token", "padding", "over-budget", "truncated", "hidden-cost"):
            with self.subTest(case=case):
                bad = deepcopy(row); trace = bad["learnedFlow"]["C"][0]
                if case == "one-direction": trace["modelDirectionCalls"] = 1
                elif case == "fallback": trace["providerKind"] = "CPU-substitute"
                elif case == "unsupported": trace["status"] = "runtime-error"
                elif case == "token": trace["token"] = "next"
                elif case == "padding": trace["paddedShape"] = [384, 384]
                elif case == "over-budget": bad["learnedFlow"]["C"] *= 13
                elif case == "truncated": bad["flowDirectionCalls"]["C"] = 4
                elif case == "hidden-cost": trace["wallMs"] = 5.
                with self.assertRaises(ValueError): study.flow_contract(bad, "C")

    def test_every_warning_obeys_cohort_gates_no_cross_lane_id_equality_required(self):
        for lane in ("A", "B", "C", "D"):
            receipt, truth = sample(); row = receipt["clips"][0]["frames"][4]
            row[lane] = deepcopy(row["D"])
            row[lane]["diagnostics"]["cohorts"]["1"][0]["ageMs"] = 10.
            with self.assertRaises(ValueError): study.score(receipt, truth)
        receipt, truth = sample()
        receipt["clips"][0]["frames"][0]["D"]["tracks"][0]["id"] = 99
        study.score(receipt, truth)

    def test_learned_warning_rejects_empty_or_only_failed_current_fields(self):
        for lane in study.LEARNED_FLOW_LANES:
            for case in ("empty", "invalid-crop", "invalid-flow"):
                with self.subTest(lane=lane, case=case):
                    receipt, truth = sample(); clip = receipt["clips"][0]; row = clip["frames"][4]
                    if case == "empty":
                        row["learnedFlow"][lane] = []
                        row["flowDirectionCalls"][lane] = 0
                    elif case == "invalid-crop":
                        row["learnedFlow"][lane][0].update(status="invalid-object-crop", modelDirectionCalls=0)
                        row["flowDirectionCalls"][lane] = 0
                    else:
                        row["learnedFlow"][lane][0]["status"] = "invalid-learned-flow"
                    clip["flowDirectionCalls"][lane] = sum(f["flowDirectionCalls"][lane] for f in clip["frames"])
                    with self.assertRaisesRegex(ValueError, "current supported learned field"):
                        study.score(receipt, truth)

    def test_receipt_forgery_is_rejected(self):
        for case in ("code", "policy", "model", "weight", "device", "calls", "wall", "startup", "runtime", "cache", "kind", "flow-count"):
            with self.subTest(case=case):
                receipt, _ = sample(); clip = receipt["clips"][0]
                if case == "code": receipt["codeSha256"] = {}
                elif case == "policy": receipt["policies"]["identity"]["maxCohortsPerIdentity"] = 100
                elif case == "model": receipt["learnedDetector"]["revision"] = "wrong"
                elif case == "weight": receipt["learnedFlow"]["weightsSha256"] = "01064c6d"+"0"*56
                elif case == "device": receipt["device"] = "cuda"
                elif case == "calls": clip["learnedDetectorCalls"] = 0
                elif case == "wall": del clip["learnedDetectorWallMs"]
                elif case == "startup": receipt["modelStartupMs"] = {}
                elif case == "runtime": receipt["learnedFlow"]["torch"] = "wrong"
                elif case == "cache": receipt["detectorProvenance"]["cacheSha256"] = "a"*64
                elif case == "kind": receipt["detectorProvenance"]["kind"] = "mock"
                elif case == "flow-count": clip["flowDirectionCalls"]["C"] = 2
                with self.assertRaises(ValueError): study.receipt_contract(receipt)

    def test_product_percentiles_follow_per_exposure_sums_without_flow_double_count(self):
        receipt, _ = sample(); frames = receipt["clips"][0]["frames"]
        frames[0]["timingsMs"]["D"] = 100.
        frames[1]["learnedDetectorObservationMs"] = 100.
        result = study._timing_values(frames)
        expected = [f["learnedDetectorObservationMs"]+sum(f["timingsMs"][n] for n in ("fullPreparation", "sharedPrep", "D")) for f in frames]
        self.assertEqual(result["DPairedProduct"], study._percentiles(expected))
        self.assertNotEqual(result["DPairedProduct"]["p95"], result["D"]["p95"]+100.+4.)
        del frames[0]["timingsMs"]["D"]
        with self.assertRaises(ValueError): study._timing_values(frames)

    def test_runtime_no_truth_argument_or_tile_path_and_dependencies_fingerprinted(self):
        for function in (study.run_clip, study.replay):
            self.assertNotIn("truth", inspect.signature(function).parameters)
        self.assertNotIn("tile", inspect.getsource(study.run_clip).lower())
        self.assertTrue({"assist_scene_learned_detector.py", "assist_scene_learned_region.py",
                         "assist_scene_cohort_loom.py", "assist_scene_m3k_study.py"} <= set(study.CODE))
        self.assertEqual(len(study.CODE), len(set(study.CODE)))

    def test_development_cache_requires_paired_flags_exact_suite_before_models(self):
        for development, cached, count in ((True, None, 100), (False, Path("cache"), 100), (True, Path("cache"), 99)):
            source = {"dataset": "Boreas-real", "clips": [{"frames": [{}]*count}]}
            destination = Mock(); destination.exists.return_value = False; destination.is_symlink.return_value = False
            args = SimpleNamespace(input=Path("input"), output=destination, sceneqa=Mock(), yolo=Mock(),
                                   development_only=development, cached_detections=cached)
            with patch.object(study, "load_input", return_value=(source, Path("."))), \
                    patch.object(study.shutil, "disk_usage", return_value=SimpleNamespace(free=20*1024**3)):
                with self.assertRaisesRegex(ValueError, "100-exposure development suite"): study.replay(args)
            args.sceneqa.resolve.assert_not_called(); args.yolo.resolve.assert_not_called()

    def test_runtime_shares_each_detector_once_and_uses_whole_clip_clock(self):
        class Detector:
            device = "mps"
            def __init__(self): self.calls = 0
            def detect(self, image, *, working_shape):
                self.calls += 1
                return [], observation("unused", 0., "c"*64, height=image.shape[0], width=image.shape[1])
        class Provider:
            direction_calls = 0
            metadata = {"kind": "actual-local-pretrained-torchvision"}
            def __call__(self, *_): raise AssertionError("No objects, no fields")
        with tempfile.TemporaryDirectory(prefix="codex-tmp-m3k-test-20261116-") as folder:
            root = Path(folder); frames = []
            for i in range(3):
                path = root/f"frame-{i}.png"
                self.assertTrue(cv2.imwrite(str(path), np.full((64, 96, 3), i, np.uint8)))
                frames.append({"path": path.name, "sha256": study.sha256(path), "token": str(i), "timestampUs": 1_000_000+i*80_000})
            work = root/"stage"; work.mkdir()
            calls = []
            def detect(items, *_):
                calls.append(list(items))
                return study.DETECTOR_CONFIGURATION, {i: (at, {"width": 96, "height": 64, "orientation": 1, "tracks": [], "detectionMs": 1.}) for i, at, _ in items}
            detector = Detector()
            with patch.object(study, "detect_samples", side_effect=detect):
                result = study.run_clip({"id": "fixture", "frames": frames}, root, work, None, None, detector, Provider())
            self.assertEqual((len(calls), len(calls[0]), detector.calls, result["detectorCalls"]), (1, 3, 3, 6))
            self.assertEqual([f["timeMs"] for f in result["frames"]], [0., 80., 160.])
            self.assertEqual(result["flowDirectionCalls"], {"C": 0, "D": 0})


if __name__ == "__main__":
    unittest.main()
