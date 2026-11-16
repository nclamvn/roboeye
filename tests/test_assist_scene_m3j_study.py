import inspect
from copy import deepcopy
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/"scripts"))
import assist_scene_m3j_study as study
from assist_scene_m3e_study import output
from assist_scene_tiled_detection import TiledDetector
from test_assist_scene_m3i_study import sample as old_sample


def sample():
    receipt, truth = old_sample()
    receipt["study"] = "M3J"
    receipt.update(developmentOnly=False, policies=study.policy_snapshot(), opencv=cv2.__version__,
        sceneqaSha256="a"*64, yoloModelHashes={"model": "b"*64},
        codeSha256={name: study.sha256(study.HERE/name) for name in study.CODE},
        detectorProvenance={"kind": "actual-local-CoreML", "cacheSha256": None,
            "fullSampleTimings": "actual per-exposure model inference",
            "tileSampleTimings": "actual per-exposure four-call inference sum; not batch/model startup wall"})
    receipt["clips"][0].update(detectorConfiguration=study.DETECTOR_CONFIGURATION,
        detectorExecution="actual-local-CoreML", detectorCalls=35,
        fullDetectorBatches=1, tileDetectorBatches=1, fullDetectorBatchWallMs=10.,
        tileDetectorBatchWallMs=20., stageWallMs=10., studyWallMs=50.)
    for row in receipt["clips"][0]["frames"]:
        region = row.pop("B")
        row["B"] = deepcopy(row["A"])
        row["B"]["tracks"][0]["id"] = 2
        decision = row["B"]["diagnostics"]["identityDecisions"].pop("1")
        row["B"]["diagnostics"]["identityDecisions"]["2"] = decision
        row["B"] = output(row["B"], row["timeMs"])
        region["diagnostics"]["method"] = "feature_ecc"
        for evidence in region["diagnostics"]["windowEvidence"].values():
            for proof in [evidence["fresh"], *evidence["anchors"]]:
                proof.update(method="feature_ecc", featureMatchCount=20, featureInlierCount=16,
                    featureInlierFraction=.8, featureRatioP90=.4, featureRatioThreshold=.75,
                    featureInitialAffine=[[1., 0., 0.], [0., 1., 0.]], featureSpan=[[.5, .5], [.5, .5]],
                    featureHull=[.2, .2], featureKeypoints=[30, 30])
        for event in region["events"]:
            event["method"] = "feature_ecc"
        row["C"] = region
        row["D"] = deepcopy(region)
        row["D"]["tracks"][0]["id"] = 2
        if row["D"]["diagnostics"]["windowEvidence"]:
            row["D"]["diagnostics"]["windowEvidence"]["2"] = row["D"]["diagnostics"]["windowEvidence"].pop("1")
        for event in row["D"]["events"]:
            event["trackId"] = 2
        row["D"] = output(row["D"], row["timeMs"])
        row.update(width=200, height=100, nativeWidth=600, nativeHeight=300, sourceSha256="a"*64)
        row["timingsMs"] = dict.fromkeys(study.TIMINGS, 2.)
        row["tiles"] = []
        for tile in TiledDetector().plan((300, 600), (100, 200)):
            x, y, right, bottom = tile.rect
            row["tiles"].append({"index": tile.index, "rect": list(tile.rect), "token": row["token"],
                "timeMs": row["timeMs"], "sourceSha256": "a"*64, "jpegSha256": "b"*64,
                "observation": {"width": right-x, "height": bottom-y, "orientation": 1,
                    "tracks": [], "detectionMs": 3.}})
        current = study.parse_detect({"width": 200, "height": 100, "orientation": 1, "tracks": row["detections"]}, 200, 100)
        merged, diag = TiledDetector().merge(current, TiledDetector().plan((300, 600), (100, 200)), [[], [], [], []], (300, 600), (100, 200))
        row["candidateDetections"] = [box.record(200, 100) for box in merged]
        row["tileMerge"] = diag
        row["timingsMs"]["tileInference"] = 12.
    return receipt, truth


class M3JStudyTests(unittest.TestCase):
    def test_exact_2x2_sources_and_physical_scores(self):
        receipt, truth = sample()
        result = study.score(receipt, truth)
        self.assertEqual((result["totals"]["C"]["tp"], result["totals"]["C"]["fp"]), (1, 1))
        self.assertEqual(result["totals"]["C"]["unknownTargetReports"], 1)
        self.assertEqual(result["totals"]["D"], result["totals"]["C"])
        self.assertEqual(result["noMetreChecks"], 35)
        self.assertNotEqual(receipt["clips"][0]["frames"][0]["A"]["tracks"], receipt["clips"][0]["frames"][0]["B"]["tracks"])
        truth["clips"][0]["allSceneNegative"] = True
        self.assertEqual(study.score(receipt, truth)["totals"]["C"]["allSceneFalseNotices"], 3)

    def test_correspondence_cannot_change_or_swap_owning_identities(self):
        for lane, change in (("C", "track"), ("D", "track"), ("C", "epoch"), ("D", "epoch")):
            with self.subTest(lane=lane, change=change):
                receipt, truth = sample()
                row = receipt["clips"][0]["frames"][0]
                if change == "track": row[lane]["tracks"][0]["id"] = 8
                else: row[lane]["epoch"] = 8
                with self.assertRaises(ValueError): study.score(receipt, truth)

    def test_actual_feature_initialization_and_unchanged_final_floors(self):
        cases = ("matches", "inliers", "fraction", "ratio", "threshold", "matrix", "span", "hull",
                 "stale", "fresh-growth", "grid-support", "ecc", "reverse-ecc", "fake-determinant", "method")
        for case in cases:
            with self.subTest(case=case):
                receipt, truth = sample()
                proof = receipt["clips"][0]["frames"][4]["C"]["diagnostics"]["windowEvidence"]["1"]["fresh"]
                if case == "matches": proof["featureMatchCount"] = 601
                elif case == "inliers": proof["featureInlierCount"] = 11
                elif case == "fraction": proof["featureInlierFraction"] = .9
                elif case == "ratio": proof["featureRatioP90"] = .8
                elif case == "threshold": proof["featureRatioThreshold"] = .9
                elif case == "matrix": del proof["featureInitialAffine"]
                elif case == "span": proof["featureSpan"][0][0] = .01
                elif case == "hull": proof["featureHull"][1] = 0.
                elif case == "stale": proof["startToken"] = "wrong"
                elif case == "fresh-growth": proof.update(linearLogGrowth=0., logAreaGrowth=0., affine=[[1., 0., 0.], [0., 1., 0.]])
                elif case == "grid-support": proof["supportFraction"] = .6
                elif case == "ecc": proof["eccCorrelation"] = .69
                elif case == "reverse-ecc": proof["reverseEccCorrelation"] = .69
                elif case == "fake-determinant": proof["affine"] = [[1., 0., 0.], [0., 1., 0.]]
                elif case == "method": proof["method"] = "bbox"
                with self.assertRaises(ValueError): study.score(receipt, truth)

    def test_source_veto_and_cross_identity_lineage_remain_hard(self):
        for source, candidate in (("A", "C"), ("B", "D")):
            for previous in (False, True):
                with self.subTest(source=source, previous=previous):
                    receipt, truth = sample()
                    rows = receipt["clips"][0]["frames"]
                    index = 2 if previous else 4
                    rows[index][source]["status"] = "pose-skew"
                    rows[index][candidate]["diagnostics"]["sourceStatus"] = "pose-skew"
                    with self.assertRaises(ValueError): study.score(receipt, truth)

    def test_tile_receipts_cannot_forge_coverage_geometry_clocks_or_cost(self):
        for case in ("missing", "rect", "clock", "token", "source", "hash", "geometry", "candidate", "merge", "cost", "missing-cost"):
            with self.subTest(case=case):
                receipt, truth = sample()
                row = receipt["clips"][0]["frames"][0]; tile = row["tiles"][0]
                if case == "missing": row["tiles"].pop()
                elif case == "rect": tile["rect"][0] = 1
                elif case == "clock": tile["timeMs"] = 10.
                elif case == "token": tile["token"] = "other"
                elif case == "source": tile["sourceSha256"] = "c"*64
                elif case == "hash": tile["jpegSha256"] = "made-up"
                elif case == "geometry": tile["observation"]["width"] += 1
                elif case == "candidate": row["candidateDetections"] = []
                elif case == "merge": row["tileMerge"]["accepted"] = 99
                elif case == "cost": row["timingsMs"]["tileInference"] = 0.
                elif case == "missing-cost": del tile["observation"]["detectionMs"]
                with self.assertRaises(ValueError): study.score(receipt, truth)

    def test_nested_metric_claims_and_invented_distance_are_rejected(self):
        for case in ("track", "answer"):
            receipt, truth = sample(); row = receipt["clips"][0]["frames"][0]
            if case == "track": row["A"]["tracks"][0]["extra"] = {"metres": 2.}
            else: row["A"]["answers"]["distance"] = {"metres": 2.}
            with self.assertRaises(ValueError): study.score(receipt, truth)

    def test_product_cost_uses_paired_operation_sums(self):
        receipt, _ = sample(); frames = receipt["clips"][0]["frames"]
        frames[0]["timingsMs"].update(B=100., D=1.)
        frames[1]["timingsMs"].update(B=1., D=100.)
        result = study._timing_values(frames)
        expected = [row["detectorObservationMs"]+sum(row["timingsMs"][n] for n in ("fullPreparation", "sharedPrep", "tilePreparation", "tileParsing", "tileInference", "tileMerge", "B", "D")) for row in frames]
        self.assertEqual(result["DPairedProduct"], study._percentiles(expected))
        self.assertNotEqual(result["DPairedProduct"]["p95"], result["B"]["p95"]+result["D"]["p95"]+28.)
        del frames[0]["timingsMs"]["tilePreparation"]
        with self.assertRaises(ValueError): study._timing_values(frames)

    def test_batching_limits_model_processes_and_rejects_config_change(self):
        items = [(i, float(i), Path(f"frame{i}.jpg")) for i in range(103)]
        calls = []
        def detect(batch, *_):
            calls.append(len(batch))
            return study.DETECTOR_CONFIGURATION, {i: (at, {}) for i, at, _ in batch}
        with patch.object(study, "detect_samples", side_effect=detect):
            found, _, count = study._detect_batched(items, None, None)
        self.assertEqual((calls, len(found), count), ([50, 50, 3], 103, 3))
        with patch.object(study, "detect_samples", return_value=({}, {})):
            with self.assertRaises(ValueError): study._detect_batched(items, None, None)

    def test_runtime_rebinds_single_frame_staging_to_exact_whole_clip_clock(self):
        with tempfile.TemporaryDirectory(prefix="codex-tmp-m3j-runner-test-20261116-") as folder:
            root = Path(folder); frames = []
            for i in range(3):
                filename = root/f"source-{i}.png"
                self.assertTrue(cv2.imwrite(str(filename), np.full((64, 96, 3), i*20, np.uint8)))
                frames.append({"path": filename.name, "sha256": study.sha256(filename), "token": str(i), "timestampUs": 1_000_000+i*80_000})
            work = root/"stage"; work.mkdir(); calls = []
            def detect(items, *_):
                calls.append(list(items)); found = {}
                for index, at, filename in items:
                    h, w = cv2.imread(str(filename)).shape[:2]
                    found[index] = (at, {"width": w, "height": h, "orientation": 1, "tracks": [], "detectionMs": 1.})
                return study.DETECTOR_CONFIGURATION, found
            with patch.object(study, "detect_samples", side_effect=detect):
                result = study.run_clip({"id": "fixture", "frames": frames}, root, work, None, None)
            self.assertEqual([len(call) for call in calls], [3, 12])
            self.assertEqual([r["timeMs"] for r in result["frames"]], [0., 80., 160.])
            self.assertEqual([r["index"] for r in result["frames"]], [0, 1, 2])
            self.assertEqual(result["detectorCalls"], 15)
            self.assertEqual(len({str(path) for call in calls for _, _, path in call}), 15)
            self.assertTrue(all(r["timingsMs"]["fullPreparation"] > 0 for r in result["frames"]))

    def test_runtime_has_no_truth_parameter_and_fingerprints_all_dependencies(self):
        self.assertNotIn("truth", inspect.signature(study.run_clip).parameters)
        self.assertNotIn("truth", inspect.signature(study.replay).parameters)
        self.assertTrue({"assist_scene_m3j_study.py", "assist_scene_feature_region.py", "assist_scene_tiled_detection.py", "assist_scene_m3i_study.py", "assist_scene_region_motion.py"} <= set(study.CODE))
        self.assertEqual(len(study.CODE), len(set(study.CODE)))

    def test_development_cache_flags_fail_before_model_resolution_or_inference(self):
        # Both flags are required together and development remains exactly the
        # original 100 exposures. No models or input files are opened here.
        for development, cached, count in ((True, None, 100),
                (False, Path("cache.json"), 100), (True, Path("cache.json"), 99)):
            with self.subTest(development=development, cached=cached, count=count):
                manifest = {"dataset": "Boreas-real", "clips": [{"frames": [{}]*count}]}
                executable, destination = Mock(), Mock()
                destination.exists.return_value = False
                destination.is_symlink.return_value = False
                args = SimpleNamespace(input=Path("source.json"), output=destination,
                    sceneqa=executable, yolo=Mock(), cached_detections=cached,
                    development_only=development)
                with patch.object(study, "load_input", return_value=(manifest, Path("."))), \
                        patch.object(study.shutil, "disk_usage", return_value=SimpleNamespace(free=20*1024**3)), \
                        patch.object(study, "load_cache") as load, \
                        patch.object(study, "_detect_batched") as detect:
                    with self.assertRaisesRegex(ValueError, "100-exposure development suite"):
                        study.replay(args)
                    executable.resolve.assert_not_called()
                    args.yolo.resolve.assert_not_called()
                    load.assert_not_called()
                    detect.assert_not_called()

    def test_forged_execution_policy_and_provenance_claims_are_rejected(self):
        for case in ("config", "execution", "calls", "batches", "missing-wall", "kind", "cache", "dev", "policy", "code", "model"):
            with self.subTest(case=case):
                receipt, truth = sample(); clip = receipt["clips"][0]
                if case == "config": clip["detectorConfiguration"] = {}
                elif case == "execution": clip["detectorExecution"] = "cached"
                elif case == "calls": clip["detectorCalls"] = 0
                elif case == "batches": clip["tileDetectorBatches"] = 0
                elif case == "missing-wall": del clip["tileDetectorBatchWallMs"]
                elif case == "kind": receipt["detectorProvenance"]["kind"] = "cached-historical-real-model"
                elif case == "cache": receipt["detectorProvenance"]["cacheSha256"] = "a"*64
                elif case == "dev": receipt["developmentOnly"] = True
                elif case == "policy": receipt["policies"]["region"]["minSupport"] = .5
                elif case == "code": receipt["codeSha256"]["assist_scene_roi_redetect.py"] = "wrong"
                elif case == "model": receipt["yoloModelHashes"] = {}
                with self.assertRaises(ValueError): study.score(receipt, truth)


if __name__ == "__main__":
    unittest.main()
