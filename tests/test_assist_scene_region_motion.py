"""Authored-pixel mechanism checks, not independent real-video quality evidence."""

from copy import deepcopy
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/"scripts"))
from assist_scene_region_motion import RegionMotion, POLICY, _snapshot
from assist_scene_motion import Detection
from assist_scene_scale_approach import _frame_view


W, H = 480, 360
K = np.array([[330., 0., W/2], [0., 330., H/2], [0., 0., 1.]])
RNG = np.random.default_rng(42019)
TEXTURE = cv2.GaussianBlur(RNG.integers(0, 256, (H, W), np.uint8), (5, 5), 1.1)


def exposure(i, scale=1., box_scale=None, *, ident=7, kept=None, status=None, epoch=0):
    center = np.array([245., 167.])
    affine = np.array([[scale, 0., center[0]*(1-scale)], [0., scale, center[1]*(1-scale)]])
    pixels = cv2.warpAffine(TEXTURE, affine, (W, H), borderMode=cv2.BORDER_REFLECT101)
    z = scale if box_scale is None else box_scale
    box = Detection("car", .94, tuple(float(v) for v in
                    (center[0]-50*z, center[1]-55*z, center[0]+50*z, center[1]+55*z)))
    frame = {"timestampUs": 2_000_000+i*80_000, "poseTimestampUs": 2_000_000+i*80_000,
             "token": f"f-{i}", "epoch": epoch, "cameraToWorld": np.eye(4).tolist(), "intrinsics": K.tolist()}
    surface = {"status": status or ("first-frame" if i == 0 else "valid"), "epoch": epoch,
               "tracks": [{"id": ident, **box.record(W, H)}], "events": [],
               "diagnostics": {"identityDecisions": {str(ident): {"kept": i > 0 if kept is None else kept}}}}
    return frame, pixels, surface


def run(engine, i, scale=1., box_scale=None, **kwargs):
    f, p, s = exposure(i, scale, box_scale, **kwargs)
    return engine.update(f, i*80., p, s)


class RegionMotionTests(unittest.TestCase):
    def test_actual_pixel_expansion_with_direct_current_proof(self):
        for method in ("ecc", "flow_affine"):
            engine = RegionMotion(method)
            values = [run(engine, i, np.exp(.014*i)) for i in range(9)]
            alerts = [v for v in values if v["events"]]
            self.assertTrue(alerts, (method, values[-1]))
            for out in alerts:
                q = out["diagnostics"]["windowEvidence"]["7"]
                self.assertTrue(q["fresh"]["supported"])
                self.assertEqual(q["fresh"]["endMs"], out["events"][0]["timeMs"])
                self.assertGreaterEqual(q["fresh"]["linearLogGrowth"], .0005)
                self.assertTrue(any(a["supported"] and a["observationMs"] >= 320. for a in q["anchors"]))
                e = out["events"][0]
                self.assertAlmostEqual(e["logAreaGrowth"], 2*e["linearLogGrowth"])
                self.assertNotIn("metres", e); self.assertNotIn("ttc", e)
                self.assertNotIn("angularLogGrowth", e)

    def test_static_pixels_and_detector_only_growth_do_not_warn(self):
        for method in ("ecc", "flow_affine"):
            for jitter in (False, True):
                engine = RegionMotion(method)
                for i in range(12):
                    out = run(engine, i, 1., 1.+.015*i if jitter else None)
                    self.assertFalse(out["events"], (method, jitter, out))

    def test_source_camera_zoom_and_pose_veto_never_overridden(self):
        for status in ("scale-ambiguous", "insufficient-background-agreement", "pose-skew", "pose-epoch-mismatch"):
            engine = RegionMotion()
            for i in range(6): run(engine, i, np.exp(.014*i))
            f, p, s = exposure(6, 1.2, status=status)
            out = engine.update(f, 480., p, s)
            self.assertEqual(out["status"], status)
            self.assertFalse(out["events"])
            self.assertFalse(engine._states)

    def test_current_failure_skips_long_work_and_stale_warning(self):
        engine = RegionMotion()
        for i in range(7): run(engine, i, np.exp(.014*i))
        f, p, s = exposure(7, 1.15)
        p[:] = 127
        with patch.object(engine, "_measure", wraps=engine._measure) as measure:
            out = engine.update(f, 560., p, s)
        self.assertFalse(out["events"])
        self.assertEqual(measure.call_count, 1)

    def test_stopping_surface_requires_positive_current_measurement(self):
        for method in ("ecc", "flow_affine"):
            engine = RegionMotion(method)
            for i in range(7): run(engine, i, np.exp(.014*i))
            out = run(engine, 7, np.exp(.014*6))
            self.assertFalse(out["events"], (method, out))
            self.assertEqual(out["diagnostics"]["windowEvidence"]["7"]["comparisonCount"], 1)

    def test_gap_id_reset_missing_detection_and_epoch_restart_age(self):
        for reset in ("gap", "new-id", "unkept", "epoch", "missing"):
            engine = RegionMotion()
            for i in range(7): run(engine, i, np.exp(.014*i))
            f, p, s = exposure(7, 1.15, ident=8 if reset == "new-id" else 7,
                               kept=False if reset == "unkept" else True, epoch=1 if reset == "epoch" else 0)
            at = 560.
            if reset == "gap":
                at += 400.; f["timestampUs"] += 400_000; f["poseTimestampUs"] += 400_000
            if reset == "missing": s["tracks"] = []
            out = engine.update(f, at, p, s)
            self.assertFalse(out["events"], (reset, out))
            self.assertTrue(all(v["count"] <= 1 for v in out["diagnostics"]["snapshots"].values()))

    def test_lighting_change_is_not_scale(self):
        for method in ("ecc", "flow_affine"):
            engine = RegionMotion(method)
            for i in range(9):
                f, p, s = exposure(i)
                p = np.clip(p.astype(float)*(1+.015*i)+i, 0, 255).astype(np.uint8)
                self.assertFalse(engine.update(f, i*80., p, s)["events"])

    def test_camera_rotation_compensation_not_object_expansion(self):
        for method in ("ecc", "flow_affine"):
            engine = RegionMotion(method)
            for i in range(9):
                f, p, s = exposure(i)
                angle = .005*i
                rotation = np.array([[np.cos(angle), 0., np.sin(angle)], [0., 1., 0.], [-np.sin(angle), 0., np.cos(angle)]])
                warp = K @ rotation.T @ np.linalg.inv(K)
                p = cv2.warpPerspective(p, warp, (W, H), borderMode=cv2.BORDER_REFLECT101)
                f["cameraToWorld"] = np.eye(4).tolist()
                for r in range(3):
                    for c in range(3): f["cameraToWorld"][r][c] = float(rotation[r, c])
                self.assertFalse(engine.update(f, i*80., p, s)["events"])

    def test_sparse_real_snapshots_cover_window_and_budget(self):
        engine = RegionMotion()
        for i in range(25):
            out = run(engine, i, np.exp(.006*i))
            q = out["diagnostics"]
            for snapshot in q["snapshots"].values():
                self.assertLessEqual(snapshot["count"], 8)
                self.assertLessEqual(snapshot["maxAgeMs"], 800.)
                self.assertLessEqual(snapshot["maxSidePx"], 256)
            self.assertLessEqual(q["comparisonCount"], 3)
        state = engine._states[7]
        self.assertGreaterEqual(state["latest"].at-state["anchors"][0].at, 640.)

    def test_native_snapshot_bound_and_copy(self):
        f, p, s = exposure(0)
        raw = cv2.resize(p, (W*3, H*3))
        engine = RegionMotion()
        out = engine.update(f, 0., p, s, native_gray=raw)
        snapshot = engine._states[7]["latest"]
        self.assertTrue(out["diagnostics"]["nativeDetail"])
        self.assertLessEqual(max(snapshot.pixels.shape), 384)
        copy = snapshot.pixels.copy(); raw[:] = 0
        np.testing.assert_array_equal(snapshot.pixels, copy)

    def test_tracks_are_exact_source_not_reassociated_or_mutated(self):
        engine = RegionMotion()
        f, p, s = exposure(0); original = deepcopy(s)
        out = engine.update(f, 0., p, s)
        self.assertEqual(out["tracks"], s["tracks"])
        self.assertEqual(s, original)
        out["tracks"][0]["id"] = 900
        self.assertEqual(s["tracks"][0]["id"], 7)

    def test_invalid_inputs_fail_closed(self):
        for change in ("duplicate-id", "budget", "nan-box", "missing-decisions", "clock", "intrinsics"):
            engine = RegionMotion()
            run(engine, 0)
            f, p, s = exposure(1)
            if change == "duplicate-id": s["tracks"] *= 2
            if change == "budget": s["tracks"] *= 13
            if change == "nan-box": s["tracks"][0]["box"]["x"] = float("nan")
            if change == "missing-decisions": s["diagnostics"] = {}
            if change == "clock": f["token"] = "f-0"
            if change == "intrinsics": f["intrinsics"][0][0] += 3.
            self.assertFalse(engine.update(f, 80., p, s)["events"], change)

    def test_invalid_method(self):
        with self.assertRaises(ValueError): RegionMotion("bbox")

    def test_real_m3h_surface_adapter_with_authored_object_pixels(self):
        from assist_scene_cohort_loom import CohortWindowLoom
        from test_assist_scene_window_loom import image
        for method in ("ecc", "flow_affine"):
            identity, measurement = CohortWindowLoom(), RegionMotion(method)
            alerts = []
            for i in range(10):
                frame, pixels, box = image(i, 1.015**i)
                surface = identity.update(frame, i*80., pixels, [box])
                original = deepcopy(surface)
                out = measurement.update(frame, i*80., pixels, surface)
                self.assertEqual(out["tracks"], surface["tracks"])
                self.assertEqual(out["epoch"], surface["epoch"])
                self.assertEqual(surface, original)
                alerts.extend(out["events"])
            self.assertTrue(alerts, method)

    def test_affine_area_not_isotropic_similarity_scale(self):
        center = np.array([245., 167.])
        for method in ("ecc", "flow_affine"):
            engine = RegionMotion(method)
            alerts = []
            for i in range(9):
                sx, sy = np.exp(.018*i), np.exp(.004*i)
                affine = np.array([[sx, 0., center[0]*(1-sx)], [0., sy, center[1]*(1-sy)]])
                pixels = cv2.warpAffine(TEXTURE, affine, (W, H), borderMode=cv2.BORDER_REFLECT101)
                frame, _, surface = exposure(i)
                box = Detection("car", .94, tuple(float(v) for v in
                    (center[0]-50*sx, center[1]-55*sy, center[0]+50*sx, center[1]+55*sy)))
                surface["tracks"] = [{"id": 7, **box.record(W, H)}]
                out = engine.update(frame, i*80., pixels, surface)
                alerts.extend(out["events"])
            self.assertTrue(alerts, method)
            event = alerts[-1]
            self.assertAlmostEqual(event["logAreaGrowth"], .022*event["observationMs"]/80., delta=.02)

    def test_neighbor_rectangle_is_not_an_occlusion_mask(self):
        for method in ("ecc", "flow_affine"):
            engine = RegionMotion(method)
            alerts = []
            for i in range(9):
                f, p, s = exposure(i, np.exp(.014*i))
                # Identical visible pixels, but an independently supplied
                # neighbor rectangle covers half the conservative interior.
                neighbor = deepcopy(s["tracks"][0]); neighbor["id"] = 19
                neighbor["box"]["x"] += neighbor["box"]["width"]*.4
                s["tracks"].append(neighbor)
                s["diagnostics"]["identityDecisions"]["19"] = {"kept": i > 0}
                out = engine.update(f, i*80., p, s)
                alerts.extend(e for e in out["events"] if e["trackId"] == 7)
            self.assertTrue(alerts, (method, out))

    def test_actual_surface_replacement_rejects_current_pixel_support(self):
        for method in ("ecc", "flow_affine"):
            engine = RegionMotion(method)
            for i in range(7): run(engine, i, np.exp(.014*i))
            f, p, s = exposure(7, np.exp(.014*7))
            b = s["tracks"][0]["box"]
            x, y, width, height = (b["x"]*W, b["y"]*H, b["width"]*W, b["height"]*H)
            p[round(y):round(y+height), round(x):round(x+.50*width)] = 127
            out = engine.update(f, 560., p, s)
            self.assertFalse(out["events"], (method, out))
            self.assertEqual(out["diagnostics"]["windowEvidence"]["7"]["comparisonCount"], 1)

    def test_ambiguous_identity_never_inherits_old_surface_age(self):
        engine = RegionMotion()
        for i in range(7): run(engine, i, np.exp(.014*i))
        # Even a perfect lookalike must not override M3H's current ID refusal.
        f, p, s = exposure(7, np.exp(.014*7), kept=False)
        s["diagnostics"]["identityDecisions"]["7"]["reason"] = "ambiguous-association"
        out = engine.update(f, 560., p, s)
        self.assertFalse(out["events"])
        self.assertEqual(out["diagnostics"]["snapshots"]["7"]["count"], 1)

    def test_malformed_identity_decision_fails_closed(self):
        engine = RegionMotion()
        for i in range(7): run(engine, i, np.exp(.014*i))
        f, p, s = exposure(7, np.exp(.014*7))
        s["diagnostics"]["identityDecisions"]["7"] = []
        self.assertFalse(engine.update(f, 560., p, s)["events"])

    def test_valid_conflicting_direct_anchor_vetoes(self):
        engine = RegionMotion()
        for i in range(9): run(engine, i, np.exp(.014*i))
        original = engine._measure
        def conflict(old, new):
            q = original(old, new)
            if new.at-old.at >= 320. and old.at == 0.:
                q.update(supported=True, linearLogGrowth=-.02, logAreaGrowth=-.04)
            return q
        with patch.object(engine, "_measure", side_effect=conflict):
            out = run(engine, 9, np.exp(.014*9))
        self.assertFalse(out["events"])
        self.assertEqual(out["diagnostics"]["trackReasons"]["7"], "direct-anchor-disagreement")


if __name__ == "__main__":
    unittest.main()
