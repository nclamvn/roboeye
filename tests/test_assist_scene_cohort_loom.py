"""Authored-pixel lifecycle/guard tests, not field or phone acceptance."""

from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/"scripts"))
from assist_scene_cohort_loom import CohortWindowLoom, POLICY
from assist_scene_motion import Detection
import assist_scene_window_loom as window
import test_assist_scene_window_loom as fixtures


class CohortLoomTests(fixtures.WindowLoomTests):
    def setUp(self):
        super().setUp()
        scope = patch.object(fixtures, "WindowLoom", CohortWindowLoom)
        scope.start(); self.addCleanup(scope.stop)

    def test_feature_turnover_reseeds_identity_and_uses_real_bounded_anchors(self):
        # Actual changing pixels, no mocked detector/flow. Object identity is
        # supported by the large unchanged surface while old cohorts expire.
        state = CohortWindowLoom(); values = []
        for i in range(20):
            f, p, b = fixtures.image(i, 1.009**i)
            left, top, right, bottom = map(round, b.xyxy)
            changing = fixtures.OBJ.copy()
            stripe = (i % 5)*30
            changing[:, stripe:stripe+12] = 127
            p[top:bottom, left:right] = cv2.resize(changing, (right-left, bottom-top))
            values.append(state.update(f, i*80., p, [b]))
        self.assertEqual(len({v["tracks"][0]["id"] for v in values}), 1)
        self.assertTrue(any(v["diagnostics"]["bounds"]["retiredCohortCount"] for v in values))
        all_ids = {c["cohortId"] for v in values for c in v["diagnostics"]["cohorts"]["1"]}
        self.assertGreater(len(all_ids), POLICY["maxCohortsPerIdentity"])
        for v in values:
            self.assertLessEqual(v["diagnostics"]["bounds"]["cohortCount"], 3)
            for c in v["diagnostics"]["cohorts"]["1"]:
                self.assertLessEqual(c["ageMs"], 800.)
                self.assertLessEqual(c["currentPoints"], 64)

    def test_current_pixel_support_loss_keeps_id_but_removes_warning(self):
        state = CohortWindowLoom()
        values = [fixtures.run(state, i, 1.025**i) for i in range(7)]
        self.assertTrue(values[-1]["events"], values[-1])
        f, pixels, box = fixtures.image(7, 1.025**7)
        x, y, r, b = map(round, box.xyxy)
        # 42% of the original surface becomes featureless. The remaining
        # appearance is independently identifiable, but measurement is lost.
        pixels[y:b, x:x+round((r-x)*.42)] = 127
        out = state.update(f, 560., pixels, [box])
        self.assertEqual(out["tracks"][0]["id"], values[-1]["tracks"][0]["id"], out)
        self.assertTrue(out["diagnostics"]["identityDecisions"]["1"]["kept"])
        self.assertFalse(out["events"], out)
        self.assertGreater(out["diagnostics"]["bounds"]["retiredCohortCount"], 0)
        self.assertTrue(all(not c["mature"] for c in out["diagnostics"]["cohorts"]["1"]))

    def test_one_cohort_failure_does_not_kill_another_mature_measurement(self):
        state = CohortWindowLoom()
        values = [fixtures.run(state, i, 1.025**i) for i in range(8)]
        self.assertTrue(values[-1]["events"], values[-1])
        original = state._cohort_flow
        oldest = min(state._previous[3][0].cohorts, key=lambda c: c.born).id
        def reject_oldest(field, cohort, *args):
            if cohort.id == oldest:
                return None, "authored-cohort-retirement"
            return original(field, cohort, *args)
        with patch.object(state, "_cohort_flow", side_effect=reject_oldest):
            out = fixtures.run(state, 8, 1.025**8)
        self.assertEqual(out["tracks"][0]["id"], 1)
        self.assertTrue(out["events"], out)
        self.assertNotIn(oldest, out["events"][0]["supportingCohortIds"])

    def test_new_cohort_age_is_not_identity_age_after_measurement_loss(self):
        state = CohortWindowLoom()
        for i in range(8): fixtures.run(state, i, 1.015**i)
        with patch.object(state, "_cohort_flow", return_value=(None, "authored-cohort-retirement")):
            out = fixtures.run(state, 8, 1.015**8)
        self.assertEqual(out["tracks"][0]["id"], 1)
        self.assertFalse(out["events"])
        self.assertGreater(out["diagnostics"]["identityDecisions"]["1"]["ageMs"], 320)
        self.assertTrue(all(c["ageMs"] == 0 for c in out["diagnostics"]["cohorts"]["1"]))
        self.assertTrue(all(c["validSamples"] == 1 for c in out["diagnostics"]["cohorts"]["1"]))
        again = fixtures.run(state, 9, 1.015**9)
        self.assertFalse(again["events"])

    def test_missing_detection_clears_identity_and_all_cohort_evidence(self):
        state = CohortWindowLoom()
        for i in range(7): fixtures.run(state, i, 1.025**i)
        f, p, b = fixtures.image(7, 1.025**7)
        out = state.update(f, 560., p, [])
        self.assertFalse(out["events"])
        self.assertEqual(state._previous[3], [])
        again = fixtures.run(state, 8, 1.025**8)
        self.assertNotEqual(again["tracks"][0]["id"], 1)
        self.assertFalse(again["events"])
        self.assertTrue(all(c["ageMs"] == 0 for cs in again["diagnostics"]["cohorts"].values() for c in cs))

    def test_epoch_gap_duplicate_and_invalid_clock_do_not_keep_warmed_warning(self):
        for kind in ("epoch", "gap", "duplicate", "clock", "nan"):
            state = CohortWindowLoom()
            for i in range(7): fixtures.run(state, i, 1.025**i)
            f, p, b = fixtures.image(7, 1.025**7); at = 560.
            if kind == "epoch": f["epoch"] = 1
            elif kind == "gap": f["timestampUs"] += 400_000; f["poseTimestampUs"] += 400_000; at += 400.
            elif kind == "duplicate": f["token"] = "f-6"
            elif kind == "clock": at += 9.
            else: at = float("nan")
            out = state.update(f, at, p, [b])
            self.assertFalse(out["events"], (kind, out))

    def test_disagreeing_current_mature_cohorts_veto(self):
        state = CohortWindowLoom()
        for i in range(8): fixtures.run(state, i, 1.025**i)
        original = state._cumulative_evidence
        oldest_birth = min(c.born for c in state._previous[3][0].cohorts)
        def conflict(tube, k):
            q = original(tube, k)
            if tube.history[0][0] == oldest_birth:
                q.update(confirmed=False, robustPointGrowth=-.1, currentAngularLogGrowth=-.01)
            return q
        with patch.object(state, "_cumulative_evidence", side_effect=conflict):
            out = fixtures.run(state, 8, 1.025**8)
        self.assertFalse(out["events"], out)

    def test_no_native_still_uses_real_cohort_age_and_contract(self):
        state = CohortWindowLoom(native_detail=False)
        out = None
        for i in range(10): out = fixtures.run(state, i, 1.015**i)
        self.assertTrue(out["events"], out)
        self.assertFalse(out["diagnostics"]["nativeDetail"])
        for event in out["events"]:
            self.assertNotIn("metres", event)
            supporting = [c for c in out["diagnostics"]["cohorts"][str(event["trackId"])]
                          if c["cohortId"] in event["supportingCohortIds"]]
            self.assertTrue(supporting)
            self.assertTrue(all(c["confirmed"] and c["ageMs"] >= event["observationMs"] for c in supporting))

    def test_pose_synchronized_pan_and_shake_of_static_scene_do_not_warn(self):
        for scenario in ("pan", "shake"):
            state = CohortWindowLoom()
            for i in range(12):
                f, pixels, box = fixtures.image(i)
                yaw = .006*(i-4) if scenario == "pan" else .016*np.sin(1.7*i)
                roll = 0. if scenario == "pan" else .014*np.sin(2.3*i)
                cy, sy = np.cos(yaw), np.sin(yaw)
                cr, sr = np.cos(roll), np.sin(roll)
                rot = np.array([[cy,0,sy],[0,1,0],[-sy,0,cy]]) @ np.array([[cr,-sr,0],[sr,cr,0],[0,0,1]])
                warp = fixtures.K @ rot.T @ np.linalg.inv(fixtures.K)
                pixels = cv2.warpPerspective(pixels, warp, (fixtures.W, fixtures.H),
                                            borderMode=cv2.BORDER_REFLECT101)
                f["cameraToWorld"] = np.eye(4).tolist()
                for r in range(3):
                    for c in range(3): f["cameraToWorld"][r][c] = float(rot[r,c])
                rect = tuple(float(v) for v in window.base._warp_rect(box.xyxy, warp))
                moved = Detection(box.label, box.score, rect)
                out = state.update(f, i*80., pixels, [moved])
                self.assertFalse(out["events"], (scenario, i, out))

    def test_crop_jitter_can_keep_identity_via_fresh_pixels_without_motion(self):
        state = CohortWindowLoom()
        for i in range(7): fixtures.run(state, i)
        f, pixels, box = fixtures.image(7)
        shifted = Detection(box.label, box.score, tuple(v+8 if n in (0,2) else v
                                                       for n, v in enumerate(box.xyxy)))
        with patch.object(state, "_field", wraps=state._field) as field:
            out = state.update(f, 560., pixels, [shifted])
        self.assertEqual(field.call_count, 1, "Identity and all cohorts share one real flow field")
        decision = out["diagnostics"]["identityDecisions"]["1"]
        self.assertEqual(out["tracks"][0]["id"], 1, out)
        self.assertLess(decision["appearanceCorrelation"], POLICY["identityPatchCorrelation"])
        self.assertEqual(decision["reason"], "fresh-one-pair-pixel-identity")
        self.assertGreaterEqual(decision["freshPair"]["supportedPoints"], 9)
        self.assertEqual(decision["freshPair"]["previousMs"], 480.)
        self.assertEqual(decision["freshPair"]["currentMs"], 560.)
        self.assertFalse(out["events"], out)
        self.assertTrue(all(c["cohortId"] != 0 for c in out["diagnostics"]["cohorts"]["1"]))

    def test_different_surface_cannot_borrow_old_identity_or_warning(self):
        state = CohortWindowLoom()
        for i in range(7): fixtures.run(state, i, 1.025**i)
        f, pixels, box = fixtures.image(7, 1.025**7)
        x, y, r, b = map(round, box.xyxy)
        pixels[y:b, x:r] = cv2.resize(fixtures.texture(91919, (100,100)), (r-x,b-y))
        out = state.update(f, 560., pixels, [box])
        self.assertNotEqual(out["tracks"][0]["id"], 1, out)
        decision = next(iter(out["diagnostics"]["identityDecisions"].values()))
        self.assertTrue(decision["freshPair"]["attempted"])
        self.assertFalse(decision["kept"])
        self.assertFalse(out["events"])
        self.assertTrue(all(c["ageMs"] == 0 for cs in out["diagnostics"]["cohorts"].values() for c in cs))


if __name__ == "__main__": unittest.main()
