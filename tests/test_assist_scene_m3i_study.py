import inspect
import json
import math
from copy import deepcopy
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/"scripts"))
import assist_scene_m3i_study as study
from assist_scene_m3e_study import CLAIM, output


BOX = {"x": .2, "y": .2, "width": .4, "height": .4}


def pair(start, end, growth):
    scale = math.exp(growth)
    return {"startMs": float(start), "endMs": float(end), "observationMs": float(end-start),
            "startToken": str(start//80), "endToken": str(end//80), "method": "ecc",
            "supported": True, "reason": "region-affine-supported", "seedPoints": 25,
            "points": 20, "supportFraction": .8, "cycleP90Px": .2,
            "eccCorrelation": .95, "reverseEccCorrelation": .95,
            "linearLogGrowth": growth, "logAreaGrowth": 2*growth,
            "affine": [[scale, 0., 1.], [0., scale, 1.]]}


def sample():
    frames, labels = [], []
    for i in range(7):
        at = float(i*80)
        track = {"id": 1, "label": "car", "score": .8, "box": deepcopy(BOX)}
        identity = output({"epoch": 0, "status": "valid", "tracks": [track], "events": [],
            "diagnostics": {"identityDecisions": {"1": {"reason": "appearance-supported", "kept": bool(i)}}}}, at)
        region = output({"epoch": 0, "status": "valid", "tracks": [deepcopy(track)], "events": [],
            "diagnostics": {"sourceStatus": "valid", "method": "ecc", "windowEvidence": {}, "trackReasons": {}}}, at)
        if i >= 4:
            anchor = pair(0, i*80, .06)
            fresh = pair((i-1)*80, i*80, .01)
            region["diagnostics"]["windowEvidence"]["1"] = {
                "confirmed": True, "fresh": fresh, "anchors": [anchor], "comparisonCount": 2,
                "observationMs": at, "linearLogGrowth": .06, "logAreaGrowth": .12}
            region["events"] = [{"kind": CLAIM, "trackId": 1, "label": "car", "epoch": 0,
                "timeMs": at, "observationMs": at,
                "linearLogGrowth": .06, "logAreaGrowth": .12, "points": 20, "method": "ecc"}]
        quiet = deepcopy(region)
        quiet["events"] = []
        quiet["diagnostics"]["method"] = "flow_affine"
        quiet["diagnostics"]["windowEvidence"] = {}
        frames.append({"token": str(i), "timestampUs": i*80_000, "timeMs": at, "index": i,
            "detectorGapInjected": False, "detections": [deepcopy(track)],
            "A": identity, "B": region, "C": quiet, "S": deepcopy(region),
            "detectorObservationMs": 10., "timingsMs": dict.fromkeys(study.TIMINGS, 2.)})
        if i in (4, 5, 6):
            labels.append({"token": str(i), "timestampUs": i*80_000, "targets": [
                {"instance": "checked", "classFamily": "vehicle", "box": deepcopy(BOX),
                 "approach": {4: "approaching", 5: "not-approaching", 6: "unknown"}[i]}]})
    receipt = {"schemaVersion": 1, "study": "M3I", "dataset": "test", "inputSha256": "input",
        "platform": "Mac", "opencv": "test", "codeSha256": {},
        "detectorProvenance": {"kind": "cached-historical-real-model"},
        "clips": [{"id": "clip", "detectorConfiguration": {}, "frames": frames}]}
    truth = {"schemaVersion": 1, "inputSha256": "input", "clips": [{"id": "clip", "frames": labels}]}
    return receipt, truth


def source_for(receipt):
    return {"dataset": receipt["dataset"], "clips": [{"id": c["id"], "frames": [
        {"token": f["token"], "timestampUs": f["timestampUs"]} for f in c["frames"]]} for c in receipt["clips"]]}


class M3IStudyTests(unittest.TestCase):
    def test_fingerprints_transitive_runtime_and_no_labels_at_runtime(self):
        self.assertTrue({"assist_scene_m3i_study.py", "assist_scene_region_motion.py", "assist_scene_cohort_loom.py",
            "assist_scene_m3h_study.py", "assist_scene_pose_motion.py", "score-assist-scene-motion-m3c.py"} <= set(study.CODE))
        self.assertEqual(len(study.CODE), len(set(study.CODE)))
        self.assertNotIn("truth", inspect.signature(study.run_clip).parameters)
        self.assertNotIn("truth", inspect.signature(study.replay).parameters)

    def test_keeps_physical_positive_negative_unknown_and_false_notice_counts(self):
        receipt, truth = sample()
        result = study.score(receipt, truth, source_for(receipt))
        self.assertEqual((result["totals"]["B"]["tp"], result["totals"]["B"]["fp"]), (1, 1))
        self.assertEqual(result["totals"]["B"]["unknownTargetReports"], 1)
        self.assertEqual(result["totals"]["A"]["fn"], 1)
        self.assertEqual(result["noMetreChecks"], 7*len(study.LANES))
        truth["clips"][0]["allSceneNegative"] = True
        self.assertEqual(study.score(receipt, truth)["totals"]["B"]["allSceneFalseNotices"], 3)

    def test_paired_product_latency_includes_identity_and_shared_work_before_percentile(self):
        receipt, _ = sample()
        frames = receipt["clips"][0]["frames"]
        frames[0]["timingsMs"].update(A=100., B=1., sharedPrep=2.)
        frames[1]["timingsMs"].update(A=1., B=100., sharedPrep=2.)
        timing = study._timing_values(frames)
        self.assertEqual(timing["BPlusIdentityAndSharedPrep"], study._percentiles([103., 103., 6., 6., 6., 6., 6.]))
        self.assertNotEqual(timing["BPlusIdentityAndSharedPrep"]["p95"],
            timing["A"]["p95"]+timing["B"]["p95"]+timing["sharedPrep"]["p95"])

    def test_region_warnings_need_fresh_direct_supported_affine_proof(self):
        cases = ("fresh-age", "fresh-token", "stale-current", "missing-anchor", "fake-anchor-token", "too-young",
                 "weak-growth", "no-current-growth", "not-confirmed", "unsupported", "few-points", "support",
                 "fake-determinant", "reflection", "event-window", "event-growth", "event-points", "method", "count")
        for case in cases:
            with self.subTest(case=case):
                receipt, truth = sample()
                row = receipt["clips"][0]["frames"][4]
                evidence = row["B"]["diagnostics"]["windowEvidence"]["1"]
                fresh, anchor, event = evidence["fresh"], evidence["anchors"][0], row["B"]["events"][0]
                if case == "fresh-age": fresh["startMs"] = 160.; fresh["observationMs"] = 160.
                elif case == "fresh-token": fresh["startToken"] = "wrong"
                elif case == "stale-current": anchor["endMs"] = 240.
                elif case == "missing-anchor": evidence["anchors"] = []
                elif case == "fake-anchor-token": anchor["startToken"] = "wrong"
                elif case == "too-young": anchor.update(startMs=80., startToken="1", observationMs=240.)
                elif case == "weak-growth": anchor.update(linearLogGrowth=.001, logAreaGrowth=.002)
                elif case == "no-current-growth": fresh.update(linearLogGrowth=0., logAreaGrowth=0., affine=[[1., 0., 0.], [0., 1., 0.]])
                elif case == "not-confirmed": evidence["confirmed"] = False
                elif case == "unsupported": anchor["supported"] = False
                elif case == "few-points": fresh["points"] = 8
                elif case == "support": fresh["supportFraction"] = .9
                elif case == "fake-determinant": anchor["affine"][0][0] = 1.
                elif case == "reflection": anchor["affine"][0][0] *= -1
                elif case == "event-window": event["observationMs"] = 800.
                elif case == "event-growth": event["linearLogGrowth"] = .09
                elif case == "event-points": event["points"] = 99
                elif case == "method": event["method"] = "bbox"
                elif case == "count": evidence["comparisonCount"] = 99
                with self.assertRaises(ValueError): study.score(receipt, truth)

    def test_supported_conflicting_direct_anchor_vetoes_warning(self):
        receipt, truth = sample()
        row = receipt["clips"][0]["frames"][6]
        evidence = row["B"]["diagnostics"]["windowEvidence"]["1"]
        evidence["anchors"].append(pair(160, 480, -.01))
        evidence["comparisonCount"] += 1
        with self.assertRaises(ValueError): study.score(receipt, truth)

    def test_supported_pairs_cannot_forge_ecc_quality_or_affine_shape(self):
        for scope in ("fresh", "anchor"):
            for case in ("low-correlation", "low-reverse-correlation", "missing-correlation", "missing-reverse",
                         "nonfinite-correlation", "anisotropy", "rotation"):
                with self.subTest(scope=scope, case=case):
                    receipt, truth = sample()
                    evidence = receipt["clips"][0]["frames"][4]["B"]["diagnostics"]["windowEvidence"]["1"]
                    proof = evidence["fresh"] if scope == "fresh" else evidence["anchors"][0]
                    scale = math.exp(proof["linearLogGrowth"])
                    if case == "low-correlation": proof["eccCorrelation"] = 0.
                    elif case == "low-reverse-correlation": proof["reverseEccCorrelation"] = 0.
                    elif case == "missing-correlation": del proof["eccCorrelation"]
                    elif case == "missing-reverse": del proof["reverseEccCorrelation"]
                    elif case == "nonfinite-correlation": proof["eccCorrelation"] = float("inf")
                    elif case == "anisotropy": proof["affine"] = [[2*scale, 0., 1.], [0., scale/2, 1.]]
                    elif case == "rotation": proof["affine"] = [[0., -scale, 1.], [scale, 0., 1.]]
                    with self.assertRaises(ValueError): study.score(receipt, truth)

    def test_anchor_origin_must_have_valid_camera_or_genuine_first_frame_status(self):
        for status in ("insufficient-background-agreement", "scale-ambiguous", "invalid-stream-clock", "pose-skew"):
            with self.subTest(status=status):
                receipt, truth = sample()
                origin = receipt["clips"][0]["frames"][0]
                origin["A"]["status"] = status
                for lane in ("B", "C"):
                    origin[lane]["status"] = status
                    origin[lane]["diagnostics"]["sourceStatus"] = status
                with self.assertRaises(ValueError): study.score(receipt, truth)
        receipt, truth = sample()
        origin = receipt["clips"][0]["frames"][0]
        origin["A"]["status"] = "first-frame"
        for lane in ("B", "C"):
            origin[lane]["status"] = "first-frame"
            origin[lane]["diagnostics"]["sourceStatus"] = "first-frame"
        self.assertEqual(study.score(receipt, truth)["totals"]["B"]["tp"], 1)

    def test_valid_supported_subset_does_not_require_all_seed_cycle_p90(self):
        receipt, truth = sample()
        for row in receipt["clips"][0]["frames"][4:]:
            evidence = row["B"]["diagnostics"]["windowEvidence"]["1"]
            for proof in [evidence["fresh"], *evidence["anchors"]]:
                proof.update(seedPoints=100, points=70, supportFraction=.7, cycleP90Px=50.)
            row["B"]["events"][0]["points"] = 70
        result = study.score(receipt, truth)
        self.assertEqual((result["totals"]["B"]["tp"], result["totals"]["B"]["fp"]), (1, 1))

    def test_exact_identity_surface_and_lineage_cannot_change_or_cross_veto(self):
        for case in ("id", "box", "epoch", "source-status", "middle-relink", "middle-veto", "missing-prior-id"):
            with self.subTest(case=case):
                receipt, truth = sample()
                rows = receipt["clips"][0]["frames"]
                region = rows[4]["B"]
                if case == "id": region["tracks"][0]["id"] = 2
                elif case == "box": region["tracks"][0]["box"]["x"] += .01
                elif case == "epoch": region["epoch"] = 1
                elif case == "source-status": region["diagnostics"]["sourceStatus"] = "scale-ambiguous"
                elif case == "middle-relink": rows[2]["A"]["diagnostics"]["identityDecisions"]["1"]["kept"] = False
                elif case == "middle-veto": rows[2]["A"]["status"] = "scale-ambiguous"
                elif case == "missing-prior-id": rows[2]["A"]["tracks"] = []
                with self.assertRaises(ValueError): study.score(receipt, truth)

    def test_clock_gap_recursive_metres_nonfinite_and_source_binding_fail_loud(self):
        for case in ("clock", "gap", "metric-track", "metric-event", "answer", "nan", "timing", "missing-lane", "source"):
            with self.subTest(case=case):
                receipt, truth = sample()
                row = receipt["clips"][0]["frames"][4]
                source = source_for(receipt)
                if case == "clock": row["timeMs"] += 1.
                elif case == "gap": row["detectorGapInjected"] = True; row["detections"] = []
                elif case == "metric-track": row["B"]["tracks"][0]["meta"] = {"distance": 3.}
                elif case == "metric-event": row["B"]["events"][0]["meta"] = {"ttc": 3.}
                elif case == "answer": row["B"]["answers"]["distance"]["metres"] = 3.
                elif case == "nan": row["B"]["diagnostics"]["bad"] = float("nan")
                elif case == "timing": row["timingsMs"]["B"] = -1.
                elif case == "missing-lane": del row["C"]
                elif case == "source": source["clips"][0]["frames"][-1]["token"] = "wrong"
                with self.assertRaises(ValueError): study.score(receipt, truth, source)

    def test_unreviewed_reports_stay_separate_and_missing_review_frames_rejected(self):
        receipt, truth = sample()
        truth["clips"][0]["frames"].pop()
        self.assertEqual(study.score(receipt, truth)["totals"]["B"]["unscoredFrameReports"], 1)
        truth["clips"][0]["frames"][0]["token"] = "absent"
        with self.assertRaises(ValueError): study.score(receipt, truth)

    def test_original_detection_cache_checks_binding_and_actual_geometry(self):
        from test_assist_scene_m3h_study import cache_sample
        source, receipt = cache_sample()
        with tempfile.TemporaryDirectory(prefix="codex-tmp-m3i-cache-test-20261116-") as folder:
            path = Path(folder)/"cache.json"
            path.write_text(json.dumps(receipt))
            accepted = study.load_cache(path, source, "input", "exe", {"model": "model-hash"})
            frame = accepted["clips"][0]["frames"][0]
            boxes, historical = study.cached_observation(frame, 768, 384, 2304, 1152)
            self.assertEqual((len(boxes), historical), (1, 12.))
            with self.assertRaises(ValueError): study.cached_observation(frame, 384, 192, 2304, 1152)
            for case in ("model", "input", "runner", "staging", "clock", "geometry", "provenance"):
                with self.subTest(case=case):
                    bad = deepcopy(receipt)
                    if case == "model": bad["yoloModelHashes"] = {}
                    elif case == "input": bad["inputSha256"] = "wrong"
                    elif case == "runner": bad["codeSha256"]["assist_scene_m3g_study.py"] = "wrong"
                    elif case == "staging": bad["codeSha256"]["assist_scene_motion.py"] = "wrong"
                    elif case == "clock": bad["clips"][0]["frames"][0]["timeMs"] += 1.
                    elif case == "geometry": bad["clips"][0]["frames"][0]["token"] = "wrong"
                    elif case == "provenance": bad["detectorProvenance"]["kind"] = "simulation"
                    path.write_text(json.dumps(bad))
                    with self.assertRaises(ValueError): study.load_cache(path, source, "input", "exe", {"model": "model-hash"})

    def test_runner_calls_identity_once_and_shares_same_object_both_methods(self):
        identities = []
        seen = []
        frames = [{"token": str(i), "timestampUs": i*80_000, "path": f"{i}.jpg"} for i in range(4)]
        working = np.zeros((64, 64), np.uint8)
        native = np.zeros((64, 64, 3), np.uint8)
        class Identity:
            def update(self, frame, at, gray, boxes, **kwargs):
                result = {"status": "valid", "epoch": 0, "tracks": [], "events": [], "diagnostics": {}}
                identities.append(result)
                return result
        class Region:
            def __init__(self, method, **kwargs): self.method = method
            def update(self, frame, at, gray, identity, **kwargs):
                seen.append((self.method, identity))
                return {**deepcopy(identity), "diagnostics": {"sourceStatus": identity["status"], "method": self.method}}
        class Box:
            def update(self, *args): return {"status": "valid", "epoch": 0, "tracks": [], "events": []}
        config = deepcopy(study.DETECTOR_CONFIGURATION)
        found = {i: (i*80., {"width": 64, "height": 64, "orientation": 1, "tracks": [], "detectionMs": 2.}) for i in range(4)}
        samples = [(i, i*80., Path(f"{i}.jpg")) for i in range(4)]
        with tempfile.TemporaryDirectory(prefix="codex-tmp-m3i-runner-test-20261116-") as folder:
            with patch.object(study, "stage", return_value=(frames, samples, [(64, 64, 64, 64)]*4)), \
                 patch.object(study, "read_frame", side_effect=lambda path, mode: native if mode == study.cv2.IMREAD_COLOR else working), \
                 patch.object(study, "detect_samples", return_value=(config, found)), \
                 patch("assist_scene_cohort_loom.CohortWindowLoom", Identity), \
                 patch("assist_scene_region_motion.RegionMotion", Region), \
                 patch("assist_scene_m3d_study.BoxBaseline", Box):
                result = study.run_clip({"id": "unit", "frames": frames}, Path(folder), Path(folder), None, None)
        self.assertEqual(len(identities), 4)
        self.assertEqual(len(seen), 8)
        self.assertEqual({method for method, _ in seen}, {"ecc", "flow_affine"})
        for i, identity in enumerate(identities):
            self.assertIs(seen[2*i][1], identity)
            self.assertIs(seen[2*i+1][1], identity)
        self.assertEqual(result["detectorCalls"], 4)
        self.assertTrue(all(row["A"]["tracks"] == row["B"]["tracks"] == row["C"]["tracks"] for row in result["frames"]))


if __name__ == "__main__":
    unittest.main()
