"""Authored-pixel mechanism tests, not independent real-video quality evidence."""

from copy import deepcopy
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/"scripts"))
import assist_scene_region_motion as frozen
from assist_scene_feature_region import FeatureRegionMotion, FEATURE_POLICY, POLICY, _ratio_matches, _bounded_features
from test_assist_scene_region_motion import exposure, run, TEXTURE, W, H, K


class FeatureRegionMotionTests(unittest.TestCase):
    def test_scale_rotation_direct_current_proof_and_actual_feature_counts(self):
        engine = FeatureRegionMotion()
        alerts = []
        for i in range(9):
            scale = np.exp(.014*i)
            frame, _, source = exposure(i, scale)
            transform = cv2.getRotationMatrix2D((245., 167.), .8*i, scale)
            pixels = cv2.warpAffine(TEXTURE, transform, (W, H), borderMode=cv2.BORDER_REFLECT101)
            out = engine.update(frame, i*80., pixels, source)
            if not out["events"]:
                continue
            alerts.extend(out["events"])
            evidence = out["diagnostics"]["windowEvidence"]["7"]
            proofs = [evidence["fresh"], *[a for a in evidence["anchors"] if a["supported"]]]
            self.assertTrue(any(a["observationMs"] >= 320 for a in proofs[1:]))
            for proof in proofs:
                self.assertEqual(proof["method"], "feature_ecc")
                self.assertEqual(proof["endMs"], i*80.)
                self.assertGreaterEqual(proof["featureMatchCount"], 12)
                self.assertGreaterEqual(proof["featureInlierCount"], 12)
                self.assertAlmostEqual(proof["featureInlierFraction"], proof["featureInlierCount"]/proof["featureMatchCount"])
                self.assertGreaterEqual(proof["featureInlierFraction"], .60)
                self.assertGreaterEqual(proof["supportFraction"], .70)
                self.assertAlmostEqual(proof["supportFraction"], proof["points"]/proof["seedPoints"])
                self.assertGreaterEqual(min(proof["eccCorrelation"], proof["reverseEccCorrelation"]), .70)
                self.assertLess(proof["featureRatioP90"], .75)
                self.assertEqual(len(proof["featureInitialAffine"]), 2)
        self.assertTrue(alerts, out)
        for event in alerts:
            self.assertEqual(event["method"], "feature_ecc")
            self.assertAlmostEqual(event["logAreaGrowth"], 2*event["linearLogGrowth"])
            self.assertFalse({"metres", "ttc", "distance", "angularLogGrowth"} & event.keys())

    def test_no_feature_match_never_calls_ecc_or_fallback(self):
        engine = FeatureRegionMotion()
        run(engine, 0)
        frame, pixels, source = exposure(1)
        pixels[:] = 127
        with patch("assist_scene_feature_region.cv2.findTransformECC") as ecc:
            out = engine.update(frame, 80., pixels, source)
        self.assertFalse(out["events"])
        ecc.assert_not_called()
        self.assertEqual(out["diagnostics"]["trackReasons"]["7"], "insufficient-feature-matches")

    def test_duplicate_descriptor_alternatives_fail_strict_lowe_ratio(self):
        descriptors = np.tile(np.arange(128, dtype=np.float32), (20, 1))
        self.assertEqual(_ratio_matches(descriptors, descriptors), {})

    def test_tied_sift_responses_are_hard_capped_deterministically(self):
        keys = [cv2.KeyPoint(float(i), 1., 2., response=1.) for i in range(650, -1, -1)]
        descriptors = np.repeat(np.asarray([k.pt[0] for k in keys], np.float32)[:, None], 128, axis=1)
        sift = Mock()
        sift.detectAndCompute.return_value = keys, descriptors
        bounded, actual = _bounded_features(sift, np.zeros((1, 1), np.uint8), None)
        self.assertEqual(len(bounded), 600)
        self.assertEqual([k.pt[0] for k in bounded], list(range(600)))
        np.testing.assert_array_equal(actual[:, 0], np.arange(600))

    def test_repeated_texture_cannot_create_an_expansion_warning(self):
        engine = FeatureRegionMotion()
        y, x = np.indices((H, W))
        periodic = (((x//10+y//10)%2)*255).astype(np.uint8)
        for i in range(9):
            scale = np.exp(.014*i)
            frame, _, source = exposure(i, scale)
            pixels = cv2.warpAffine(periodic, cv2.getRotationMatrix2D((245, 167), 0, scale),
                                    (W, H), borderMode=cv2.BORDER_REFLECT101)
            out = engine.update(frame, i*80., pixels, source)
            self.assertFalse(out["events"], out)

    def test_texture_loss_and_true_half_occlusion_veto_current_and_long_work(self):
        for lost in (True, False):
            engine = FeatureRegionMotion()
            for i in range(7):
                run(engine, i, np.exp(.014*i))
            frame, pixels, source = exposure(7, np.exp(.014*7))
            if lost:
                pixels[:] = 127
            else:
                box = source["tracks"][0]["box"]
                x, y, width, height = (box["x"]*W, box["y"]*H, box["width"]*W, box["height"]*H)
                pixels[round(y):round(y+height), round(x):round(x+.50*width)] = 127
            with patch.object(engine, "_measure", wraps=engine._measure) as measure:
                out = engine.update(frame, 560., pixels, source)
            self.assertFalse(out["events"], out)
            self.assertEqual(measure.call_count, 1)

    def test_lighting_detector_growth_and_current_stop_do_not_warn(self):
        for mode in ("lighting", "box-growth", "stop"):
            engine = FeatureRegionMotion()
            for i in range(9):
                scale = np.exp(.014*min(i, 6)) if mode == "stop" else 1.
                frame, pixels, source = exposure(i, scale, 1.+.015*i if mode == "box-growth" else None)
                if mode == "lighting":
                    pixels = np.clip(pixels.astype(float)*(1+.015*i)+i, 0, 255).astype(np.uint8)
                out = engine.update(frame, i*80., pixels, source)
                if mode != "stop" or i > 6:
                    self.assertFalse(out["events"], (mode, out))
                if mode == "stop" and i > 6:
                    self.assertEqual(out["diagnostics"]["comparisonCount"], 1)

    def test_camera_pan_compensation_is_not_surface_expansion(self):
        engine = FeatureRegionMotion()
        for i in range(9):
            frame, pixels, source = exposure(i)
            angle = .005*i
            rotation = np.array([[np.cos(angle), 0., np.sin(angle)], [0., 1., 0.], [-np.sin(angle), 0., np.cos(angle)]])
            pixels = cv2.warpPerspective(pixels, K @ rotation.T @ np.linalg.inv(K), (W, H), borderMode=cv2.BORDER_REFLECT101)
            pose = np.eye(4); pose[:3, :3] = rotation
            frame["cameraToWorld"] = pose.tolist()
            self.assertFalse(engine.update(frame, i*80., pixels, source)["events"])

    def test_source_camera_and_zoom_veto_clear_measurement(self):
        for status in ("scale-ambiguous", "insufficient-background-agreement", "pose-skew", "pose-epoch-mismatch"):
            engine = FeatureRegionMotion()
            for i in range(6):
                run(engine, i, np.exp(.014*i))
            frame, pixels, source = exposure(6, 1.2, status=status)
            with patch.object(engine, "_measure", wraps=engine._measure) as measure:
                out = engine.update(frame, 480., pixels, source)
            self.assertEqual(out["status"], status)
            self.assertFalse(out["events"])
            self.assertFalse(engine._states)
            measure.assert_not_called()

    def test_identity_lifetime_resets_without_reassociation(self):
        for reset in ("gap", "new-id", "unkept", "epoch", "missing"):
            engine = FeatureRegionMotion()
            for i in range(7):
                run(engine, i, np.exp(.014*i))
            frame, pixels, source = exposure(7, 1.15, ident=8 if reset == "new-id" else 7,
                                            kept=False if reset == "unkept" else True, epoch=1 if reset == "epoch" else 0)
            at = 560.
            if reset == "gap":
                at += 400.; frame["timestampUs"] += 400_000; frame["poseTimestampUs"] += 400_000
            if reset == "missing":
                source["tracks"] = []
            original = deepcopy(source)
            out = engine.update(frame, at, pixels, source)
            self.assertFalse(out["events"], reset)
            self.assertEqual(out["tracks"], source["tracks"])
            self.assertEqual(source, original)
            self.assertTrue(all(v["count"] <= 1 for v in out["diagnostics"]["snapshots"].values()))

    def test_bounded_snapshots_and_no_descriptor_cohorts(self):
        engine = FeatureRegionMotion()
        for i in range(25):
            out = run(engine, i, np.exp(.006*i))
            self.assertLessEqual(out["diagnostics"]["comparisonCount"], 3)
            for snapshot in out["diagnostics"]["snapshots"].values():
                self.assertLessEqual(snapshot["count"], 8)
                self.assertLessEqual(snapshot["maxAgeMs"], 800.)
                self.assertLessEqual(snapshot["maxSidePx"], 256)
            for state in engine._states.values():
                self.assertEqual(set(state), {"latest", "anchors"})
        frame, pixels, source = exposure(25, np.exp(.006*25))
        native = cv2.resize(pixels, (W*3, H*3))
        out = engine.update(frame, 2000., pixels, source, native_gray=native)
        self.assertTrue(out["diagnostics"]["nativeDetail"])
        snapshot = engine._states[7]["latest"]
        self.assertLessEqual(max(snapshot.pixels.shape), 384)
        before = snapshot.pixels.copy(); native[:] = 0
        np.testing.assert_array_equal(snapshot.pixels, before)

    def test_final_grid_support_is_not_replaced_by_perfect_feature_fit(self):
        engine = FeatureRegionMotion()
        run(engine, 0)
        with patch("assist_scene_feature_region.region.base._matching_patches", return_value=np.zeros(100, bool)):
            out = run(engine, 1, 1.014)
        proof = out["diagnostics"]["windowEvidence"]["7"]["fresh"]
        self.assertGreaterEqual(proof["featureInlierCount"], 12)
        self.assertEqual(proof["supportFraction"], 0.)
        self.assertFalse(proof["supported"])
        self.assertFalse(out["events"])

    def test_feature_initializer_cannot_bypass_final_correlation_or_cycle(self):
        for failure in ("correlation", "cycle"):
            engine = FeatureRegionMotion()
            run(engine, 0)
            forward = np.eye(3, dtype=np.float32)[:2]
            backward = forward.copy()
            if failure == "cycle":
                backward[0, 2] = 5.
            correlation = .69 if failure == "correlation" else 1.
            with patch("assist_scene_feature_region.cv2.findTransformECC",
                       side_effect=[(correlation, forward), (1., backward)]):
                out = run(engine, 1)
            proof = out["diagnostics"]["windowEvidence"]["7"]["fresh"]
            self.assertGreaterEqual(proof["featureInlierCount"], 12)
            self.assertFalse(proof["supported"])
            self.assertEqual(proof["reason"], "ecc-correlation" if failure == "correlation"
                             else "insufficient-photometric-cycle-support")
            self.assertFalse(out["events"])

    def test_invalid_source_and_stream_inputs_clear_existing_age(self):
        for invalid in ("duplicate-id", "nan-box", "missing-decisions", "token", "intrinsics"):
            engine = FeatureRegionMotion()
            for i in range(5):
                run(engine, i, np.exp(.014*i))
            frame, pixels, source = exposure(5, 1.1)
            if invalid == "duplicate-id":
                source["tracks"] *= 2
            elif invalid == "nan-box":
                source["tracks"][0]["box"]["x"] = float("nan")
            elif invalid == "missing-decisions":
                source["diagnostics"] = {}
            elif invalid == "token":
                frame["token"] = "f-4"
            else:
                frame["intrinsics"][0][0] += 3.
            out = engine.update(frame, 400., pixels, source)
            self.assertFalse(out["events"], invalid)
            self.assertTrue(all(v["count"] <= 1 for v in out["diagnostics"]["snapshots"].values()), invalid)

    def test_policy_and_methods_remain_distinct_and_immutable(self):
        self.assertIs(POLICY, frozen.POLICY)
        self.assertEqual((POLICY["minSupport"], POLICY["minCorrelation"], POLICY["maxCyclePx"]), (.70, .70, 1.3))
        self.assertEqual(FEATURE_POLICY["minInlierFraction"], .60)
        with self.assertRaises(TypeError):
            FEATURE_POLICY["ratio"] = 1.
        with self.assertRaises(ValueError):
            FeatureRegionMotion("ecc")


if __name__ == "__main__":
    unittest.main()
