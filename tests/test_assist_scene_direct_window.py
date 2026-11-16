"""Authored-pixel and structural controls, not independent field acceptance."""

from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/"scripts"))
import assist_scene_direct_window as direct
from assist_scene_motion import Detection
import test_assist_scene_region_motion as fixtures


def exposure(i, scale=1., box_scale=None, **kwargs):
    frame, pixels, surface = fixtures.exposure(i, scale, box_scale, **kwargs)
    frame["sha256"] = sha256(pixels.tobytes()).hexdigest()
    boxes = []
    for track in surface["tracks"]:
        box = track["box"]
        boxes.append(Detection(track["label"], track["score"],
            (box["x"]*fixtures.W, box["y"]*fixtures.H,
             (box["x"]+box["width"])*fixtures.W, (box["y"]+box["height"])*fixtures.H)))
    return frame, pixels, boxes, surface


def run(state, i, scale=1., box_scale=None, **kwargs):
    frame, pixels, boxes, surface = exposure(i, scale, box_scale, **kwargs)
    return state.update(frame, i*80., pixels, boxes, camera_surface=surface)


def snapshots(i, scale=1., pixels=None):
    frame, original, boxes, surface = exposure(i, scale)
    image = original if pixels is None else pixels
    view, _ = direct.base._frame_view(frame, fixtures.W, fixtures.H)
    view.update(sourceSha256=frame["sha256"], label="car", detectionIndex=0)
    return direct.region._snapshot(i*80., image, boxes[0], [], np.eye(3), view, False)


def unsupported_origin(origin, current, comparisons):
    return [{"supported": False, "reason": "authored-no-registration", "currentDetectionIndex": i}
            for i in range(len(current.crops))]


class DirectWindowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.expansion = [run(direct.DirectWindowMotion(), 0)]
        state = direct.DirectWindowMotion()
        cls.expansion = [run(state, i, np.exp(.014*i), ident=100+i, kept=False) for i in range(6)]

    def test_true_expansion_survives_current_id_replacement_quantitatively(self):
        self.assertFalse(any(out["events"] for out in self.expansion[:4]))
        for i in (4, 5):
            out = self.expansion[i]
            self.assertEqual(out["tracks"][0]["id"], 100+i)
            self.assertEqual(len(out["events"]), 1, out["diagnostics"]["trackReasons"])
            event = out["events"][0]
            self.assertEqual(event["trackId"], 100+i)
            self.assertAlmostEqual(event["linearLogGrowth"], .014*i, delta=.015)
            self.assertAlmostEqual(event["logAreaGrowth"], 2*event["linearLogGrowth"])
            proof = out["diagnostics"]["windowEvidence"][str(100+i)]
            self.assertEqual(proof["timestampCount"], 3)
            self.assertEqual(proof["realExposureTokens"], ["f-0", f"f-{i-1}", f"f-{i}"])
            for key in ("fresh", "anchor"):
                direct.validate_pair_proof(proof[key])
                direct.validate_association_proof(proof[key]["association"])
                self.assertEqual(proof[key]["endToken"], f"f-{i}")
            self.assertGreaterEqual(proof["anchor"]["observationMs"], 320.)

    def test_three_real_exposures_not_five_consecutive_or_claimed_identity_age(self):
        state = direct.DirectWindowMotion()
        outputs = [run(state, i, np.exp(.014*i), ident=800+i, kept=False) for i in (0, 3, 4)]
        self.assertFalse(outputs[1]["events"])
        self.assertTrue(outputs[2]["events"], outputs[2]["diagnostics"]["trackReasons"])
        self.assertEqual(outputs[2]["diagnostics"]["windowEvidence"]["804"]["realExposureTokens"], ["f-0", "f-3", "f-4"])
        fresh = direct.DirectWindowMotion()
        f, p, boxes, surface = exposure(20, 1.2, status="valid")
        surface["diagnostics"]["identityDecisions"]["7"]["ageMs"] = 10**9
        out = fresh.update(f, 1600., p, boxes, camera_surface=surface)
        self.assertFalse(out["events"])

    def test_static_pixels_and_detector_only_scale_jitter_do_not_warn(self):
        for jitter in (False, True):
            state = direct.DirectWindowMotion()
            for i in range(6):
                out = run(state, i, 1., 1.+.015*i if jitter else None)
                self.assertFalse(out["events"], (jitter, i, out))

    def test_periodic_appearance_has_no_unique_peak(self):
        yy, xx = np.indices((100, 120))
        periodic = (((xx//4+yy//4) % 2)*160+40).astype(np.uint8)
        pm = np.zeros(periodic.shape, np.uint8); pm[25:75, 25:95] = 255
        cost = {"initializerWarps": 0, "templateCalls": 0, "eccCalls": 0}
        matrix, proof = direct._initialize(periodic, periodic, pm, pm, (25, 25, 95, 75), (25, 25, 95, 75), cost)
        self.assertIsNone(matrix)
        self.assertIn(proof["reason"], ("unresolved-template-modes", "template-correlation"))
        self.assertLessEqual(cost["initializerWarps"], 51)

    def test_identical_competing_objects_fail_reciprocal_uniqueness(self):
        old = snapshots(0); new = snapshots(4, np.exp(.014*4))
        before = direct.Exposure(0., old.frame, [old, deepcopy(old)])
        before.crops[1].frame["detectionIndex"] = 1
        current = direct.Exposure(320., new.frame, [new])
        comparisons = []
        answer = direct.match_origin(before, current, comparisons)[0]
        self.assertFalse(answer["supported"])
        self.assertEqual(answer["reason"], "ambiguous-anchor-appearance")
        self.assertLess(answer["associationMargin"], direct.POLICY["associationMargin"])

    def test_real_occluder_and_different_surface_do_not_supply_pair_proof(self):
        old = snapshots(0)
        for replacement in (False, True):
            frame, pixels, boxes, _ = exposure(4, np.exp(.014*4))
            x, y, right, bottom = map(round, boxes[0].xyxy)
            if replacement:
                pixels[y:bottom, x:right] = np.random.default_rng(65051).integers(0, 256, (bottom-y, right-x), np.uint8)
            else:
                pixels[y:bottom, x:x+round((right-x)*.5)] = 127
            new = snapshots(4, np.exp(.014*4), pixels)
            proof = direct.measure_pair(old, new)
            self.assertFalse(proof["supported"], (replacement, proof))

    def test_camera_zoom_and_source_veto_clears_all_bank_evidence(self):
        for status in ("scale-ambiguous", "insufficient-background-agreement", "pose-skew", "pose-epoch-mismatch"):
            state = direct.DirectWindowMotion()
            with patch.object(direct, "match_origin", side_effect=unsupported_origin):
                for i in range(5): run(state, i)
                out = run(state, 5, status=status)
            self.assertFalse(out["events"])
            self.assertEqual(out["status"], status)
            self.assertFalse(state._bank)
            self.assertIsNone(state._latest)

    def test_missing_camera_surface_or_wrong_detection_handle_fails_closed(self):
        f, p, boxes, surface = exposure(0)
        state = direct.DirectWindowMotion()
        self.assertEqual(state.update(f, 0., p, boxes)["status"], "invalid-camera-surface")
        wrong = deepcopy(surface); wrong["tracks"][0]["box"]["width"] *= .8
        out = state.update(f, 0., p, boxes, camera_surface=wrong)
        self.assertEqual(out["status"], "camera-detection-mismatch")
        self.assertFalse(out["events"])

    def test_source_cannot_be_mutated_and_outputs_equal_current_source_handles(self):
        f, p, boxes, surface = exposure(0)
        original = deepcopy(surface)
        out = direct.DirectWindowMotion().update(f, 0., p, boxes, camera_surface=surface)
        self.assertEqual(surface, original)
        self.assertEqual(out["tracks"], original["tracks"])
        self.assertEqual(out["epoch"], original["epoch"])
        out["tracks"][0]["id"] = 1000
        self.assertEqual(surface, original)

    def test_clock_gap_epoch_calibration_and_duplicate_clear_bank(self):
        for kind in ("gap", "epoch", "calibration", "duplicate", "clock", "hash"):
            state = direct.DirectWindowMotion()
            with patch.object(direct, "match_origin", side_effect=unsupported_origin):
                for i in range(5): run(state, i)
                f, p, boxes, surface = exposure(5)
                at = 400.
                if kind == "gap": f["timestampUs"] += 400000; f["poseTimestampUs"] += 400000; at += 400.
                elif kind == "epoch": f["epoch"] = 1; surface["epoch"] = 1
                elif kind == "calibration": f["intrinsics"][0][0] += 10.
                elif kind == "duplicate": f["token"] = "f-4"
                elif kind == "clock": at += 3.
                else: f.pop("sha256")
                out = state.update(f, at, p, boxes, camera_surface=surface)
            self.assertFalse(out["events"], kind)
            self.assertLessEqual(len(state._bank), 1, kind)

    def test_empty_detection_does_not_coast_or_keep_pre_gap_bank(self):
        state = direct.DirectWindowMotion()
        with patch.object(direct, "match_origin", side_effect=unsupported_origin):
            for i in range(5): run(state, i)
            f, p, _, surface = exposure(5); surface["tracks"] = []
            out = state.update(f, 400., p, [], camera_surface=surface)
            again = run(state, 6)
        self.assertFalse(out["events"])
        self.assertFalse(again["events"])
        self.assertIsNone(again["diagnostics"]["snapshotSelection"]["anchor"])

    def test_bounded_timestamp_bank_and_fixed_oldest_selection(self):
        state = direct.DirectWindowMotion()
        with patch.object(direct, "match_origin", side_effect=unsupported_origin):
            for i in range(28):
                out = run(state, i)
                bank = out["diagnostics"]["bank"]
                self.assertLessEqual(bank["count"], 7)
                self.assertLessEqual(bank["cropCount"], 7*12)
                self.assertLessEqual(bank["maxAgeMs"], 800.)
                self.assertLessEqual(bank["maxSidePx"], 384)
                selection = out["diagnostics"]["snapshotSelection"]
                if i >= 4:
                    expected = max(0., ((i-10+1)//2)*160.)
                    self.assertEqual(selection["anchor"]["timeMs"], expected)
                    self.assertEqual(selection["fresh"]["timeMs"], (i-1)*80.)

    def test_geometry_gate_precedes_competitor_cap_without_dropping_eligible_objects(self):
        old, new = snapshots(0), snapshots(4, np.exp(.014*4))
        before = direct.Exposure(0., old.frame, [deepcopy(old) for _ in range(4)])
        for i, crop in enumerate(before.crops): crop.frame["detectionIndex"] = i
        current = direct.Exposure(320., new.frame, [new])
        with patch.object(direct, "measure_pair", side_effect=AssertionError("Budget must reject before registration")):
            answer = direct.match_origin(before, current, [])[0]
        self.assertEqual(answer["reason"], "appearance-competitor-budget")
        before.crops[3].box = (10000., 10000., 10100., 10110.)
        self.assertFalse(direct._eligible(before.crops[3], new))
        with patch.object(direct, "measure_pair", return_value={"supported": False, "reason": "authored-test"}) as measure:
            direct.match_origin(before, current, [])
        self.assertEqual(measure.call_count, 3)

    def test_score_helpers_reject_forged_support_cycle_growth_or_competition(self):
        proof = deepcopy(self.expansion[-1]["diagnostics"]["windowEvidence"]["105"]["anchor"])
        for field, value in (("points", 1), ("supportFraction", .69), ("maxSupportedCyclePx", 1.31),
                             ("linearLogGrowth", .3), ("eccCorrelation", .69), ("endToken", "f-0")):
            bad = deepcopy(proof); bad[field] = value
            with self.assertRaises(ValueError): direct.validate_pair_proof(bad)
        association = deepcopy(proof["association"])
        association["associationMargin"] = 0.
        with self.assertRaises(ValueError): direct.validate_association_proof(association)

    def test_unresolved_high_correlation_rival_cannot_disappear_from_competition(self):
        winner = {"supported": True, "reason": "authored-winner",
                  "forwardInitialization": {"correlation": .80},
                  "reverseInitialization": {"correlation": .80}}
        rival = {"supported": False, "reason": "ambiguous-template-peak",
                 "forwardInitialization": {"correlation": .95,
                     "runnerUpCorrelation": .94, "peakMargin": .01}}
        self.assertEqual(direct._pair_score(rival), .95)
        self.assertEqual(direct._pair_score({"supported": False}), 1.)
        old, new = snapshots(0), snapshots(4, np.exp(.014*4))
        origin = direct.Exposure(0., old.frame, [old, deepcopy(old)])
        current = direct.Exposure(320., new.frame, [new])
        with patch.object(direct, "measure_pair", side_effect=[winner, rival]):
            answer = direct.match_origin(origin, current, [])[0]
        self.assertFalse(answer["supported"])
        self.assertEqual(answer["anchorDetectionIndex"], 1)
        self.assertEqual(answer["reason"], "ambiguous-template-peak")

    def test_refine_all_modes_merges_only_same_fine_solution(self):
        image = np.zeros((48, 48), np.uint8)
        grid = np.array([(10., 10.), (20., 10.), (30., 10.), (10., 20.), (20., 20.),
                         (30., 20.), (10., 30.), (20., 30.), (30., 30.)], np.float32)
        initial = {"modes": [{"affine": [[1., 0., 0.], [0., 1., 0.]]}]*2}
        fits = [np.array([[1.02, 0., .1], [0., 1.02, .1]], np.float32),
                np.array([[1.0201, 0., .11], [0., 1.0201, .11]], np.float32)]
        cost = {"eccCalls": 0}
        with patch.object(cv2, "findTransformECC", side_effect=[(.95, f) for f in fits]):
            result, proof = direct._refine_modes(image, image, image, initial, grid, cost)
        self.assertEqual(len(result), 2)
        self.assertEqual(cost["eccCalls"], 2)
        self.assertLess(proof["maxGridDisplacementPx"], .5)
        far = fits[1].copy(); far[:, 2] += 1.374
        with patch.object(cv2, "findTransformECC", side_effect=[(.95, fits[0]), (.95, far)]):
            result, proof = direct._refine_modes(image, image, image, initial, grid, {"eccCalls": 0})
        self.assertIsNone(result)
        self.assertEqual(proof["reason"], "distinct-refined-template-modes")

    def test_growth_envelope_not_favorable_mode_controls_window(self):
        state = direct.DirectWindowMotion()
        def matched(origin, current, comparisons):
            age = current.at-origin.at
            long = age >= 320.
            point = .05 if long else .01
            lower = -.001 if long else .009
            pair = {"supported": True, "reason": "authored-supported", "startMs": origin.at,
                    "endMs": current.at, "observationMs": age, "linearLogGrowth": point,
                    "linearLogGrowthLowerBound": lower, "linearLogGrowthUpperBound": point,
                    "logAreaGrowth": 2*point, "points": 64}
            return [{"supported": True, "reason": "authored-supported", "pair": pair}]
        with patch.object(direct, "match_origin", side_effect=matched):
            for i in (0, 3, 4): out = run(state, i, np.exp(.014*i))
        self.assertFalse(out["events"])

    def test_envelope_includes_inverse_reverse_modes_and_locked_urban_overflow(self):
        pair = self.expansion[-1]["diagnostics"]["windowEvidence"]["105"]["anchor"]
        forward = pair["modeRefinement"]["forward"]["linearLogGrowths"]
        reverse = pair["modeRefinement"]["reverse"]["linearLogGrowths"]
        envelope = [*forward, *(-v for v in reverse)]
        self.assertEqual(pair["linearLogGrowthLowerBound"], min(envelope))
        self.assertEqual(pair["linearLogGrowthUpperBound"], max(envelope))
        artifact = Path(__file__).resolve().parents[1]/"docs/evidence/tip65/m3l-coarse-alias-probe.json"
        urban = next(c for c in json.loads(artifact.read_text())["cases"] if c["clip"].endswith("urban"))
        self.assertGreater(len(urban["forwardCandidates"]["distinctModesWithinMargin"]), direct.POLICY["maxInitializerModes"])
        self.assertGreater(len(urban["reverseCandidates"]["distinctModesWithinMargin"]), direct.POLICY["maxInitializerModes"])
        self.assertGreater(urban["forwardBestVsRivalMaxGridPx"], direct.POLICY["maxModeConvergencePx"])


if __name__ == "__main__": unittest.main()
