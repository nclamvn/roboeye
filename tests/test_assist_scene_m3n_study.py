"""Authored M3N runner contracts, not pretrained or unseen quality evidence."""

from copy import deepcopy
from contextlib import redirect_stderr
import io
import inspect
from hashlib import sha256
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from time import perf_counter
from unittest.mock import Mock, patch

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/"scripts"))
import assist_scene_m3n_study as study
from assist_scene_global_window import POLICY as UNIFORM_POLICY
from test_assist_scene_m3m_study import sample as old_sample
import assist_scene_textured_window as textured
import assist_scene_texture_patches as texture


def sample():
    receipt, truth = old_sample()
    receipt.update(study="M3N", policies=study.policy_snapshot(), codeSha256={n: study.sha256(study.HERE/n) for n in study.CODE},
        detectorProvenance={"kind": "actual-CoreML-and-shared-global-RAFT", "cacheSha256": None}, modelStartupMs=10., maxReceiptBytes=study.MAX_BYTES)
    receipt["globalFlowModel"]["modelSharing"] = "owned-provider"
    for clip in receipt["clips"]:
        clip.update(actualFlowDirectionCallsByLane={"A": 0, "B": 0, "C": 0}, actualFlowDirectionCalls=0)
        for frame in clip["frames"]:
            frame["T"] = deepcopy(frame["A"])
            frame["A"] = deepcopy(frame["C"])
            frame["B"] = deepcopy(frame["C"])
            frame["B"]["diagnostics"]["mode"] = "raw"; frame["C"]["diagnostics"]["mode"] = "warped"
            gray = np.zeros((frame["height"], frame["width"]), np.uint8)
            frame["workingPixelsSha256"] = sha256(gray.tobytes()).hexdigest()
            selections = [texture.select_seeds(gray, study.old._box_pixels(frame, i)) for i in range(len(frame["detections"]))]
            for lane in ("B", "C"):
                frame[lane]["diagnostics"].update(populations=[], sourceSelectionBeforeCorrespondence=True,
                    sourceSelections={"sourceToken": frame["token"], "sourceMs": frame["timeMs"], "sourceSha256": frame["sourceSha256"],
                        "workingPixelsSha256": frame["workingPixelsSha256"], "selections": selections,
                        "selectionSha256s": [study.canonical_hash(s) for s in selections]})
            frame["flowDirectionCalls"] = {"A": 0, "B": 0, "C": 0}
            frame["timingsMs"]["T"] = 2.
    return receipt, truth


class M3NStudyTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.object(study, "CODE", tuple(n for n in study.CODE if (study.HERE/n).is_file())))

    def test_full_scoring_and_no_metric_surface_includes_shared_camera(self):
        receipt, truth = sample(); result = study.score(receipt, truth)
        self.assertEqual(result["frames"], 7)
        self.assertEqual(result["noMetreChecks"], 35)
        self.assertEqual(result["totals"]["C"]["fn"], 7)

    def test_all_lanes_share_current_handles_and_camera_veto(self):
        for lane in study.GLOBAL_LANES:
            receipt, _ = sample(); frame = receipt["clips"][0]["frames"][0]
            frame[lane]["tracks"][0]["id"] += 100
            with self.assertRaises(ValueError): study.track_contract(frame)

    def test_actual_costs_do_not_count_other_ablation_models_or_historical_a(self):
        receipt, truth = sample()
        frame = receipt["clips"][0]["frames"][0]
        frame["timingsMs"].update(A=100., B=200., C=3., T=7.)
        result = study.score(receipt, truth)
        values = [f["detectorObservationMs"]+sum(f["timingsMs"][k] for k in ("fullPreparation", "sharedPrep", "T", "C")) for f in receipt["clips"][0]["frames"]]
        self.assertEqual(result["stageMs"]["CPairedProduct"], study._percentiles(values))

    def test_scope_runtime_and_call_claim_mutations_fail(self):
        for case in ("code", "policy", "startup", "weight", "calls", "historical", "wall"):
            with self.subTest(case=case):
                receipt, _ = sample()
                if case == "code": receipt["codeSha256"] = {}
                elif case == "policy": receipt["policies"]["patch"] = {}
                elif case == "startup": receipt["modelStartupMs"] = None
                elif case == "weight": receipt["globalFlowModel"]["weightsSha256"] = "wrong"
                elif case == "calls": receipt["clips"][0]["actualFlowDirectionCalls"] = 5
                elif case == "historical": receipt["developmentOnly"] = True
                else: receipt["replayWallMs"] = 1800001.
                with self.assertRaises(ValueError): study.receipt_contract(receipt)

    def test_original_variable_n_denominator_and_unknown_small_rival(self):
        proof = {"forward": {"seedPoints": 16, "assignedPoints": 8, "unknownPoints": 4, "verifiedPoints": 12, "points": 8},
                 "reverse": {"seedPoints": 20, "assignedPoints": 14, "unknownPoints": 5, "verifiedPoints": 15, "points": 12},
                 "scoreLower": .5, "scoreUpper": .75}
        self.assertEqual(study._bounds(proof), (.5, .75))
        bad = deepcopy(proof); bad["forward"]["seedPoints"] = 12
        with self.assertRaises(ValueError): study._bounds(bad)
        small = {"forward": {"seedPoints": 4, "assignedPoints": 4, "unknownPoints": 0, "verifiedPoints": 4, "points": 4},
                 "reverse": {"seedPoints": 4, "assignedPoints": 4, "unknownPoints": 0, "verifiedPoints": 4, "points": 4},
                 "scoreLower": 0., "scoreUpper": 1., "unverifiable": True}
        self.assertEqual(study._bounds(small), (0., 1.))

    def test_no_truth_path_or_runtime_label_argument(self):
        for function in (study.run_clip, study.replay):
            self.assertNotIn("truth", inspect.signature(function).parameters)
            self.assertNotIn("read_json", inspect.getsource(function))

    def test_development_flags_reject_before_models(self):
        manifest = {"dataset": "Boreas-real", "clips": [{"frames": [{}]*99}]}
        args = SimpleNamespace(input=Path("input"), development_only=True, cached_observations=Path("cache"), sceneqa=Mock())
        with patch.object(study, "load_input", return_value=(manifest, Path("."))):
            with self.assertRaises(ValueError): study.replay(args)
        args.sceneqa.resolve.assert_not_called()

    def authored_positive_history(self, unknown_rival=False):
        # Real CPU DIS on authored images. Provider MPS metadata is deliberately
        # mocked for interface validation, never actual pretrained evidence.
        from test_assist_scene_global_window import DisProvider, exposure, W, H
        from assist_scene_global_field import geometry
        from assist_scene_m3e_study import output
        class AuthoredProvider(DisProvider):
            def __init__(self):
                super().__init__(); self.metadata = {"kind": "actual-local-pretrained-torchvision-global"}
            def __call__(self, a, b):
                result = super().__call__(a, b)
                self.last_call.update(geometry(tuple(a.shape)), status="field-supported", device="mps",
                    outputShape=[*a.shape, 2], flowUpdatesPerDirection=12)
                return result
        cv2.setNumThreads(1); provider = AuthoredProvider()
        engines = {lane: textured.TexturedGlobalWindowMotion(provider, mode=mode) for lane, mode in (("B", "raw"), ("C", "warped"))}
        history = []
        for index in range(6):
            frame, gray, boxes, camera = exposure(index); at = float(index*80)
            if unknown_rival:
                from assist_scene_motion import Detection
                tiny = Detection("car", .94, (109., 89., 111., 91.)); boxes.append(tiny)
                camera["tracks"].append({"id": 5000+index, **tiny.record(W, H)})
            row = {"index": index, "token": frame["token"], "timestampUs": frame["timestampUs"], "timeMs": at,
                "sourcePoseTimestampUs": frame["poseTimestampUs"], "sourcePoseEpoch": frame["epoch"], "sourceSha256": frame["sha256"],
                "workingPixelsSha256": sha256(gray.tobytes()).hexdigest(), "width": W, "height": H, "nativeWidth": W, "nativeHeight": H,
                "cameraIntrinsics": deepcopy(frame["intrinsics"]), "cameraToWorld": deepcopy(frame["cameraToWorld"]),
                "detectorGapInjected": False, "detections": [b.record(W, H) for b in boxes], "T": output(camera, at), "flowDirectionCalls": {}, "timingsMs": {"T": 0.}}
            for lane, engine in engines.items():
                cv2.setRNGSeed(650500+index); before = provider.direction_calls; tick = perf_counter()
                row[lane] = output(engine.update(frame, at, gray, boxes, camera_surface=camera), at)
                row["timingsMs"][lane] = 1000*(perf_counter()-tick); row["flowDirectionCalls"][lane] = provider.direction_calls-before
                study.global_contract(row, history, lane)
            history.append(row)
        for lane in ("B", "C"):
            self.assertEqual(bool(history[-1][lane]["events"]), not unknown_rival)
        return history[-1], history[:-1]

    def test_authored_dis_positive_and_full_catalog_tampering(self):
        current, history = self.authored_positive_history()
        for lane in ("B", "C"):
            for case in ("seed-count", "drop-failed", "rival", "wrong-photo-source", "endpoint-rehashed", "envelope", "handle", "missing-fields", "current-veto", "K", "pose-clock"):
                with self.subTest(lane=lane, case=case):
                    bad = deepcopy(current); diag = bad[lane]["diagnostics"]
                    proof = next(p for p in diag["windowEvidence"].values() if p["confirmed"])
                    if case == "seed-count": diag["comparisons"][0]["forward"]["seedPoints"] -= 1
                    elif case == "drop-failed":
                        record = next(p for p in diag["populations"] if p["proof"]["status"] == "measured")
                        record["proof"]["points"].pop(); record["populationSha256"] = study.canonical_hash(record["proof"])
                    elif case == "rival": diag["comparisons"].pop(); diag["cost"]["candidateComparisons"] -= 1
                    elif case == "wrong-photo-source": diag["populations"][0]["proof"]["oldWorkingSha256"] = "a"*64
                    elif case == "endpoint-rehashed":
                        record = next(p for p in diag["populations"] if p["proof"]["status"] == "measured")
                        for point in record["proof"]["points"]:
                            if point["destinationPoint"] is not None: point["destinationPoint"][0] += 80.
                        record["populationSha256"] = study.canonical_hash(record["proof"])
                        def refresh(value):
                            if isinstance(value, dict):
                                if value.get("populationId") == record["populationId"]: value["populationSha256"] = record["populationSha256"]
                                for child in value.values(): refresh(child)
                            elif isinstance(value, list):
                                for child in value: refresh(child)
                        refresh(diag)
                    elif case == "envelope": proof["anchor"]["linearLogGrowthLowerBound"] += .1
                    elif case == "handle": bad[lane]["events"][0]["trackId"] += 1000
                    elif case == "missing-fields":
                        diag["globalFields"] = []; diag["comparisons"] = []; diag["populations"] = []; bad[lane]["events"] = []
                        diag["cost"] = {"globalPairs": 0, "globalDirectionCalls": 0, "candidateComparisons": 0}; bad["flowDirectionCalls"][lane] = 0
                    elif case == "current-veto": bad["T"]["status"] = "scale-ambiguous"
                    elif case == "K": bad["cameraIntrinsics"][0][0] += 5.
                    else: bad["sourcePoseTimestampUs"] -= 30_000
                    # Independence: even if engine validators are no-ops, the
                    # runner's source/count/coordinate/matrix contracts reject.
                    with patch.object(textured, "validate_comparison"), patch.object(textured, "validate_pair_proof"):
                        with self.assertRaises(ValueError): study.global_contract(bad, history, lane)

    def test_source_selection_and_patch_records_are_bound_independently(self):
        # N=64 has retained good endpoints, but the claimed assignment/affine
        # must agree with those coordinates, not only their refreshed hashes.
        _, gray, boxes, _ = __import__("test_assist_scene_global_window").exposure(0)
        zero = np.zeros((*gray.shape, 2), np.float32)
        _, _, _, _, population = texture.population(gray, gray, boxes[0], zero, zero, mode="raw")
        n = population["seedPoints"]
        proof = {"assignedPoints": n, "verifiedPoints": n, "unknownPoints": 0}
        for point in population["points"]: point["destinationPoint"][0] += 80.
        row = {"cameraIntrinsics": [[260.,0.,160.],[0.,260.,128.],[0.,0.,1.]], "cameraToWorld": np.eye(4).tolist()}
        with self.assertRaisesRegex(ValueError, "Assignment differs"):
            study.direction_contract(proof, population, row, row, boxes[0].xyxy, boxes[0].xyxy, textured.POLICY)

    def test_actual_unknown_tiny_competitor_remains_in_full_matrix(self):
        current, history = self.authored_positive_history(unknown_rival=True)
        for lane in ("B", "C"):
            diag = current[lane]["diagnostics"]
            unknown = [p for p in diag["comparisons"] if p["unverifiable"]]
            self.assertTrue(unknown)
            self.assertTrue(all((p["scoreLower"], p["scoreUpper"]) == (0., 1.) for p in unknown))
            bad = deepcopy(current); changed = bad[lane]["diagnostics"]
            changed["comparisons"] = [p for p in changed["comparisons"] if not p["unverifiable"]]
            changed["cost"]["candidateComparisons"] = len(changed["comparisons"])
            with patch.object(textured, "validate_comparison"), patch.object(textured, "validate_pair_proof"):
                with self.assertRaisesRegex(ValueError, "competitor was omitted"):
                    study.global_contract(bad, history, lane)

    def test_historical_timing_surfaces_and_field_counters_are_exact(self):
        original, _ = old_sample(); prior = original["clips"][0]["frames"][0]
        receipt, _ = sample(); frame = receipt["clips"][0]["frames"][0]
        for k in ("token", "timestampUs", "timeMs", "sourceSha256", "detections", "detectorObservationMs", "workingPixelsSha256"): frame[k] = deepcopy(prior[k])
        for new, src in (("T", "A"), ("A", "C"), ("S", "S")):
            frame[new] = deepcopy(prior[src]); frame["timingsMs"][new] = prior["timingsMs"][src]
        frame["flowDirectionCalls"]["A"] = prior["flowDirectionCalls"]["C"]
        study.historical_contract(frame, prior)
        for case in ("detector", "T", "A", "S", "counter", "trace"):
            bad = deepcopy(frame)
            if case == "detector": bad["detectorObservationMs"] += 1.
            elif case == "counter": bad["flowDirectionCalls"]["A"] += 2
            elif case == "trace": bad["A"]["diagnostics"]["globalFields"].append({"fake": True})
            else: bad["timingsMs"][case] += 1.
            with self.assertRaises(ValueError): study.historical_contract(bad, prior)

    def test_uniform_historical_alias_uses_its_actual_cost_not_new_c(self):
        from test_assist_scene_m3m_study import M3MStudyTests
        current, history = M3MStudyTests().authored_positive_history()
        def adapt(source):
            row = deepcopy(source); row["T"] = source["A"]; row["A"] = source["C"]
            row["flowDirectionCalls"] = {"A": source["flowDirectionCalls"]["C"], "B": 0, "C": 0}
            row["timingsMs"] = {"T": 170., "A": source["timingsMs"]["C"], "B": 2., "C": .000001}
            return row
        row, prior = adapt(current), [adapt(f) for f in history]
        view = study._view(row, "A")
        self.assertEqual(view["timingsMs"]["A"], 170.)
        self.assertEqual(view["timingsMs"]["C"], row["timingsMs"]["A"])
        study.global_contract(row, prior, "A")
        # The unchanged real guard must still reject the original alias bug.
        view["timingsMs"]["C"] = row["timingsMs"]["C"]
        with self.assertRaisesRegex(ValueError, "omitted actual field cost"):
            study.old.global_contract(view, [study._view(f, "A") for f in prior])

    def test_failure_telemetry_preserves_actual_counters_and_incomplete_scope(self):
        provider = SimpleNamespace(direction_calls=12)
        def fail(clip, root, work, exe, model, actual, cached, deadline, progress):
            actual.direction_calls += 6
            progress.update(frameIndex=3, phase="contracts", completedValidatedRows=3,
                completedActualLaneOutputs={"A": 0, "B": 4, "C": 4}, actualDirectionCallsByLane={"A": 0, "B": 4, "C": 2})
            raise ValueError("authored failure")
        captured = io.StringIO()
        with patch.object(study, "_run_clip", side_effect=fail), redirect_stderr(captured):
            with self.assertRaises(ValueError) as raised:
                study.run_clip({"id": "authored"}, None, None, None, None, provider, clip_index=1)
        failure = raised.exception.m3n_failure
        self.assertEqual(failure["providerDirectionCalls"], 18)
        self.assertEqual(failure["actualClipDirectionCalls"], 6)
        self.assertEqual(failure["completedValidatedRows"], 3)
        self.assertEqual(failure["frameIndex"], 3)
        self.assertEqual(failure["clipIndex"], 1)
        self.assertIn("FAILED-INCOMPLETE-NOT-SCORABLE", captured.getvalue())


if __name__ == "__main__": unittest.main()
