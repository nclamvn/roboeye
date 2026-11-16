"""Authored M3M runner/provenance controls, not learned-model evidence."""

from copy import deepcopy
import inspect
from pathlib import Path
import sys
from time import perf_counter
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/"scripts"))
import assist_scene_m3m_study as study
import assist_scene_global_window as global_window
from assist_scene_global_field import POLICY as GLOBAL_POLICY
from test_assist_scene_m3l_study import sample as old_sample


def sample():
    receipt, truth = old_sample()
    receipt.update(study="M3M", developmentOnly=False, policies=study.policy_snapshot(),
        codeSha256={name: study.sha256(study.HERE/name) for name in study.CODE},
        maxWallSeconds=study.MAX_SECONDS, replayWallMs=100., sharedModelStartupMs=10.,
        roiFlowModel=deepcopy(receipt["learnedFlowModel"]),
        detectorProvenance={"kind": "actual-local-CoreML-and-PyTorch-global", "cacheSha256": None,
                            "baselineTimings": "actual current execution"})
    receipt["globalFlowModel"] = {**deepcopy(receipt["roiFlowModel"]),
        "kind": "actual-local-pretrained-torchvision-global", "algorithm": GLOBAL_POLICY["algorithm"],
        "policy": dict(GLOBAL_POLICY), "modelSharing": "shared-legacy-provider",
        "counterScope": "global-wrapper-only-not-legacy-counter"}
    for clip in receipt["clips"]:
        clip.update(roiFlowDirectionCalls=clip["flowDirectionCalls"], globalFlowDirectionCalls=0,
                    actualFlowDirectionCalls=clip["flowDirectionCalls"])
        for frame in clip["frames"]:
            frame["flowDirectionCalls"]["C"] = 0
            frame["C"]["diagnostics"].update(globalFields=[], comparisons=[], comparisonCount=0,
                method=global_window.POLICY["method"],
                cost={"globalPairs": 0, "globalDirectionCalls": 0, "candidateComparisons": 0}, wallMs=1.)
            frame["workingPixelsSha256"] = "c"*64
    return receipt, truth


class M3MStudyTests(unittest.TestCase):
    def setUp(self):
        self.global_window = global_window
        self.enterContext(patch.object(study, "CODE", tuple(name for name in study.CODE if (study.HERE/name).is_file())))

    def test_scores_full_unchanged_matching_and_all_lanes_without_range(self):
        receipt, truth = sample(); result = study.score(receipt, truth)
        self.assertEqual(result["frames"], 7)
        self.assertEqual(result["noMetreChecks"], 28)
        self.assertEqual(result["totals"]["C"]["tp"], 0)
        self.assertEqual(result["totals"]["C"]["fn"], 7)

    def test_source_fingerprints_current_handles_epoch_and_camera_authority(self):
        for case in ("handle", "epoch", "status", "detector"):
            with self.subTest(case=case):
                receipt, _ = sample(); frame = receipt["clips"][0]["frames"][0]
                if case == "handle": frame["C"]["tracks"][0]["id"] = 999
                elif case == "epoch": frame["C"]["epoch"] += 1
                elif case == "status": frame["C"]["diagnostics"]["sourceStatus"] = "wrong"
                else: frame["detections"] = []
                with self.assertRaises(ValueError): study.track_contract(frame)

    def test_scope_policy_model_calls_and_execution_claims_cannot_be_forged(self):
        for case in ("code", "policy", "global-weight", "sharing", "global-calls", "roi-calls", "actual-calls", "detector-calls", "cache", "clock-budget"):
            with self.subTest(case=case):
                receipt, _ = sample(); clip = receipt["clips"][0]
                if case == "code": receipt["codeSha256"] = {}
                elif case == "policy": receipt["policies"]["globalWindow"]["associationMargin"] = .01
                elif case == "global-weight": receipt["globalFlowModel"]["weightsSha256"] = "wrong"
                elif case == "sharing": receipt["globalFlowModel"]["modelSharing"] = "owned-provider"
                elif case == "global-calls": clip["globalFlowDirectionCalls"] = 1
                elif case == "roi-calls": clip["roiFlowDirectionCalls"] = 100
                elif case == "actual-calls": clip["actualFlowDirectionCalls"] = 0
                elif case == "detector-calls": clip["detectorCalls"] = 0
                elif case == "cache": receipt["detectorProvenance"]["cacheSha256"] = "a"*64
                else: receipt["replayWallMs"] = 1800001.
                with self.assertRaises(ValueError): study.receipt_contract(receipt)

    def test_whole_frame_call_budget_is_independent_of_object_count(self):
        receipt, _ = sample(); frame = receipt["clips"][0]["frames"][0]
        frame["flowDirectionCalls"]["C"] = 6
        with self.assertRaises(ValueError): study.global_contract(frame, [])

    def test_paired_c_latency_includes_a_dependency_but_not_double_global_flow(self):
        receipt, _ = sample(); frames = receipt["clips"][0]["frames"]
        frames[0]["timingsMs"]["A"] = 100.
        frames[1]["timingsMs"]["C"] = 100.
        expected = study._percentiles([f["detectorObservationMs"]+sum(f["timingsMs"][key] for key in ("fullPreparation", "sharedPrep", "A", "C")) for f in frames])
        self.assertEqual(study._timing_values(frames)["CPairedProduct"], expected)

    def test_development_flags_fail_before_models_cache_or_inference(self):
        for development, path, count in ((True, None, 100), (False, Path("cache"), 100), (True, Path("cache"), 99)):
            manifest = {"dataset": "Boreas-real", "clips": [{"frames": [{}]*count}]}
            destination = Mock(); destination.exists.return_value = False; destination.is_symlink.return_value = False
            args = SimpleNamespace(input=Path("source"), output=destination, sceneqa=Mock(), yolo=Mock(),
                                   development_only=development, cached_observations=path)
            with patch.object(study, "load_input", return_value=(manifest, Path("."))), \
                    patch.object(study.shutil, "disk_usage", return_value=SimpleNamespace(free=20*1024**3)):
                with self.assertRaisesRegex(ValueError, "both flags"): study.replay(args)
            args.sceneqa.resolve.assert_not_called(); args.yolo.resolve.assert_not_called()

    def test_runtime_has_no_truth_path_and_deadline_fails_before_staging(self):
        for function in (study.run_clip, study.replay):
            self.assertNotIn("truth", inspect.signature(function).parameters)
        with self.assertRaises(TimeoutError): study.run_clip({}, None, None, None, None, None, deadline=perf_counter()-1.)
        self.assertTrue({"assist_scene_global_window.py", "assist_scene_global_field.py", "assist_scene_m3m_study.py"} <= set(study.CODE) | {"assist_scene_global_window.py"})

    def test_fixed_denominator_bounds_keep_unknown_rivals(self):
        proof = {"scoreLower": .5, "scoreUpper": .75,
                 "forward": {"seedPoints": 64, "assignedPoints": 32, "unknownPoints": 16},
                 "reverse": {"seedPoints": 64, "assignedPoints": 40, "unknownPoints": 8}}
        self.assertEqual(study._score_bounds(proof), (.5, .75))
        bad = deepcopy(proof); bad["scoreUpper"] = .5
        with self.assertRaises(ValueError): study._score_bounds(bad)
        unknown = {"scoreLower": 0., "scoreUpper": 1.}
        self.assertEqual(study._score_bounds(unknown), (0., 1.))

    def authored_positive_history(self):
        # Actual CPU DIS on authored pixels. Provider metadata is a deliberately
        # mocked interface fixture, NOT actual pretrained or MPS evidence.
        from test_assist_scene_global_window import DisProvider, exposure, W, H
        from assist_scene_global_field import geometry
        from assist_scene_m3e_study import output
        from hashlib import sha256
        class AuthoredProvider(DisProvider):
            def __init__(self):
                super().__init__(); self.metadata = {"kind": "actual-local-pretrained-torchvision-global"}
            def __call__(self, a, b):
                result = super().__call__(a, b)
                self.last_call.update(geometry(tuple(a.shape)), status="field-supported", device="mps",
                                      outputShape=[*a.shape, 2], flowUpdatesPerDirection=12)
                return result
        provider = AuthoredProvider(); engine = global_window.GlobalWindowMotion(provider); history = []
        for index in range(6):
            frame, gray, boxes, surface = exposure(index)
            before = provider.direction_calls; tick = perf_counter()
            current = output(engine.update(frame, index*80., gray, boxes, camera_surface=surface), index*80.)
            elapsed = 1000*(perf_counter()-tick)
            row = {"index": index, "token": frame["token"], "timestampUs": frame["timestampUs"], "timeMs": float(index*80),
                "sourcePoseTimestampUs": frame["poseTimestampUs"], "sourcePoseEpoch": frame["epoch"],
                "sourceSha256": frame["sha256"], "workingPixelsSha256": sha256(gray.tobytes()).hexdigest(),
                "width": W, "height": H, "nativeWidth": W, "nativeHeight": H,
                "cameraIntrinsics": deepcopy(frame["intrinsics"]), "cameraToWorld": deepcopy(frame["cameraToWorld"]),
                "detectorGapInjected": False, "detections": [b.record(W, H) for b in boxes],
                "A": output(surface, float(index*80)), "C": current, "flowDirectionCalls": {"C": provider.direction_calls-before},
                "timingsMs": {"C": elapsed}}
            study.global_contract(row, history); history.append(row)
        self.assertTrue(history[-1]["C"]["events"])
        return history[-1], history[:-1]

    def test_authored_actual_dis_positive_certificate_and_adversarial_mutations(self):
        current, history = self.authored_positive_history()
        for case in ("rival", "pixels", "source", "envelope", "handle", "missing-fields"):
            with self.subTest(case=case):
                bad = deepcopy(current); proof = next(p for p in bad["C"]["diagnostics"]["windowEvidence"].values() if p["confirmed"])
                if case == "rival":
                    bad["C"]["diagnostics"]["comparisons"].pop()
                    bad["C"]["diagnostics"]["cost"]["candidateComparisons"] -= 1
                elif case == "pixels": bad["C"]["diagnostics"]["globalFields"][0]["oldWorkingPixelsSha256"] = "a"*64
                elif case == "source": bad["C"]["diagnostics"]["globalFields"][0]["startSha256"] = "a"*64
                elif case == "envelope": proof["anchor"]["linearLogGrowthLowerBound"] += .1
                elif case == "handle": bad["C"]["events"][0]["trackId"] += 10000
                else:
                    bad["C"]["events"] = []; bad["C"]["diagnostics"]["globalFields"] = []; bad["C"]["diagnostics"]["comparisons"] = []
                    bad["flowDirectionCalls"]["C"] = 0
                    bad["C"]["diagnostics"]["cost"] = {"globalPairs": 0, "globalDirectionCalls": 0, "candidateComparisons": 0}
                with self.assertRaises(ValueError): study.global_contract(bad, history)

    def test_origin_bank_resets_on_intrinsics_pose_epoch_and_bad_clock(self):
        current, history = self.authored_positive_history()
        for case in ("K", "epoch", "duplicate", "pose-skew", "reverse-clock"):
            with self.subTest(case=case):
                bad = deepcopy(current)
                if case == "K": bad["cameraIntrinsics"][0][0] += 5.
                elif case == "epoch": bad["sourcePoseEpoch"] += 1
                elif case == "duplicate": bad["token"] = history[-1]["token"]
                elif case == "pose-skew": bad["sourcePoseTimestampUs"] -= 30_000
                else: bad["timeMs"] = history[-1]["timeMs"]-1.
                self.assertEqual(study.selected_origins(bad, history, global_window.POLICY), (None, None))


if __name__ == "__main__":
    unittest.main()
