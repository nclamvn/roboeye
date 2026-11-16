"""M3N authored-pixel DIS integration, not pretrained/field acceptance."""

from copy import deepcopy
from hashlib import sha256
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/"scripts"))
import assist_scene_textured_window as textured
import assist_scene_texture_patches as patches
from assist_scene_motion import Detection
from test_assist_scene_global_window import DisProvider, exposure, W, H


def run(state, index, **kwargs):
    frame, pixels, boxes, camera = exposure(index, **kwargs)
    result = state.update(frame, index*80., pixels, boxes, camera_surface=camera)
    for pair in result["diagnostics"]["comparisons"]:
        textured.validate_comparison(pair, result["diagnostics"]["populations"])
    for event in result["events"]:
        proof = result["diagnostics"]["windowEvidence"][str(event["trackId"])]
        for kind in ("fresh", "anchor"):
            textured.validate_pair_proof(proof[kind], result["diagnostics"]["populations"])
            textured.validate_association_proof(proof[kind]["association"])
    return result


class TexturedWindowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cv2.setNumThreads(1)
        cls.outputs = {}
        for mode in ("raw", "warped"):
            state = textured.TexturedGlobalWindowMotion(DisProvider(), mode)
            cls.outputs[mode] = [run(state, i) for i in range(6)]

    def test_actual_dis_both_ablations_positive_with_four_rivals_and_id_replacement(self):
        for mode, rows in self.outputs.items():
            with self.subTest(mode=mode):
                positives = [(i, event) for i, row in enumerate(rows) for event in row["events"]]
                self.assertTrue(positives, [r["diagnostics"]["trackReasons"] for r in rows])
                self.assertFalse(any(r["events"] for r in rows[:4]))
                self.assertTrue(any(len(rows[i]["diagnostics"]["windowEvidence"][str(e["trackId"])]["anchor"]["association"]["eligibleAnchorIndices"]) >= 4 for i, e in positives))
                for index, event in positives:
                    self.assertEqual(event["method"], textured.method_for_mode(mode))
                    self.assertEqual(event["mode"], mode)
                    self.assertGreaterEqual(event["linearLogGrowthLowerBound"], .04)
                    self.assertAlmostEqual(event["linearLogGrowth"], .014*index, delta=.025)
                    self.assertIn(event["trackId"], [100+index*12+j for j in range(4)])

    def test_source_inventory_precedes_provider_and_is_reused_for_both_origins(self):
        provider = DisProvider(); state = textured.TexturedGlobalWindowMotion(provider, "warped")
        for i in range(4): run(state, i)
        original_call = DisProvider.__call__
        observed = []
        def checked_call(instance, old, new):
            pending = state._pending
            self.assertEqual(pending["workingPixelsSha256"], sha256(new.tobytes()).hexdigest())
            self.assertEqual(pending["selectionSha256s"], [textured.selection_sha(s) for s in pending["selections"]])
            observed.append(list(pending["selectionSha256s"]))
            return original_call(instance, old, new)
        with patch.object(patches, "select_seeds", wraps=patches.select_seeds) as selector, \
             patch.object(DisProvider, "__call__", checked_call):
            result = run(state, 4)
        self.assertEqual(selector.call_count, 4)
        self.assertEqual(len(observed), 2)
        self.assertEqual(observed[0], observed[1])
        self.assertEqual(len(result["diagnostics"]["populations"]), 16)
        self.assertEqual(result["diagnostics"]["cost"]["globalDirectionCalls"], 4)

    def test_raw_warped_inventory_is_identical_not_target_conditioned(self):
        for raw, warped in zip(self.outputs["raw"], self.outputs["warped"], strict=True):
            self.assertEqual(raw["diagnostics"]["sourceSelections"], warped["diagnostics"]["sourceSelections"])
        pair = next(p for row in self.outputs["warped"] for p in row["diagnostics"]["comparisons"] if p["supported"])
        self.assertNotIn("population", pair["forward"])

    def test_original_variable_denominator_and_catalog_references_cannot_change(self):
        row = self.outputs["warped"][4]; catalog = row["diagnostics"]["populations"]
        pair = next(p for p in row["diagnostics"]["comparisons"] if p["supported"])
        for case in ("N", "population-hash", "selection-hash", "source", "bound"):
            with self.subTest(case=case):
                bad = deepcopy(pair); entries = deepcopy(catalog)
                if case == "N": bad["forward"]["seedPoints"] = 9
                elif case == "population-hash": bad["forward"]["populationSha256"] = "a"*64
                elif case == "selection-hash": bad["forward"]["selectionSha256"] = "b"*64
                elif case == "source": entries[0]["sourceToken"] = "other"
                else: bad["linearLogGrowthLowerBound"] += .01
                with self.assertRaises(ValueError): textured.validate_pair_proof(bad, entries)

    def test_retained_endpoint_tampering_cannot_keep_stale_assignment_or_affine_summary(self):
        row = self.outputs["raw"][4]
        original = next(p for p in row["diagnostics"]["comparisons"] if p["supported"])
        for shift in (3., 80.):
            with self.subTest(shift=shift):
                pair = deepcopy(original); entries = deepcopy(row["diagnostics"]["populations"])
                entry = next(e for e in entries if e["populationId"] == pair["forward"]["populationId"])
                for point in entry["proof"]["points"]:
                    if point["destinationPoint"] is not None: point["destinationPoint"][0] += shift
                entry["populationSha256"] = textured.selection_sha(entry["proof"])
                pair["forward"]["populationSha256"] = entry["populationSha256"]
                with self.assertRaises(ValueError): textured.validate_pair_proof(pair, entries)

    def test_one_sided_unmeasured_source_keeps_other_measured_catalog_counts(self):
        state = textured.TexturedGlobalWindowMotion(DisProvider(), "raw")
        for i in range(4): run(state, i)
        frame, pixels, boxes, camera = exposure(4)
        pixels[:] = 127; frame["sha256"] = sha256(pixels.tobytes()).hexdigest()
        row = state.update(frame, 320., pixels, boxes, camera_surface=camera)
        self.assertFalse(row["events"])
        pair = row["diagnostics"]["comparisons"][0]
        self.assertEqual(pair["forward"]["seedPoints"], 64)
        self.assertEqual(pair["reverse"]["seedPoints"], 0)
        self.assertEqual(textured.resolve_population(pair, "forward", row["diagnostics"]["populations"])["status"], "measured")
        self.assertEqual(textured.resolve_population(pair, "reverse", row["diagnostics"]["populations"])["status"], "not-measured")
        textured.validate_comparison(pair, row["diagnostics"]["populations"])

    def test_flat_and_small_rivals_preserve_actual_N_and_unknown_upper_one(self):
        state = textured.TexturedGlobalWindowMotion(DisProvider(), "warped")
        for i in range(5):
            frame, pixels, boxes, camera = exposure(i)
            pixels[:] = 127; frame["sha256"] = sha256(pixels.tobytes()).hexdigest()
            result = state.update(frame, i*80., pixels, boxes, camera_surface=camera)
        self.assertFalse(result["events"])
        self.assertTrue(result["diagnostics"]["comparisons"])
        for pair in result["diagnostics"]["comparisons"]:
            self.assertEqual((pair["scoreLower"], pair["scoreUpper"]), (0., 1.))
            self.assertEqual(pair["forward"]["seedPoints"], 0)
            textured.validate_comparison(pair, result["diagnostics"]["populations"])

    def test_static_and_detector_jitter_fail_closed(self):
        for mode in ("raw", "warped"):
            for jitter in (None, .014):
                state = textured.TexturedGlobalWindowMotion(DisProvider(), mode)
                for i in range(6): self.assertFalse(run(state, i, growth=0., box_growth=jitter)["events"])

    def test_occlusion_wrong_texture_and_camera_zoom_veto_fail_closed(self):
        for mode in ("raw", "warped"):
            for case in ("occlusion", "wrong", "zoom"):
                state = textured.TexturedGlobalWindowMotion(DisProvider(), mode)
                for i in range(4): run(state, i)
                frame, pixels, boxes, camera = exposure(4)
                if case == "occlusion": pixels[:] = 127
                elif case == "wrong": pixels[:] = np.random.default_rng(650588).integers(0, 256, pixels.shape, np.uint8)
                else: camera["status"] = "scale-ambiguous"
                frame["sha256"] = sha256(pixels.tobytes()).hexdigest()
                result = state.update(frame, 320., pixels, boxes, camera_surface=camera)
                self.assertFalse(result["events"], (mode, case))

    def test_whole_frame_pan_and_shake_do_not_become_expansion(self):
        for mode in ("raw", "warped"):
            state = textured.TexturedGlobalWindowMotion(DisProvider(), mode)
            for i in range(6):
                frame, pixels, boxes, camera = exposure(i, growth=0.)
                dx, dy = 2*i+(i % 2), (-1)**i*2
                pixels = cv2.warpAffine(pixels, np.array([[1., 0., dx], [0., 1., dy]]), (W, H), borderMode=cv2.BORDER_REFLECT101)
                boxes = [Detection(b.label, b.score, (b.xyxy[0]+dx, b.xyxy[1]+dy, b.xyxy[2]+dx, b.xyxy[3]+dy)) for b in boxes]
                camera["tracks"] = [{"id": 100+i*12+j, **box.record(W, H)} for j, box in enumerate(boxes)]
                frame["sha256"] = sha256(pixels.tobytes()).hexdigest()
                self.assertFalse(state.update(frame, i*80., pixels, boxes, camera_surface=camera)["events"])

    def test_no_frozen_global_or_source_mutation_and_invalid_mode(self):
        import assist_scene_global_window as global_window
        previous = dict(global_window.POLICY)
        frame, pixels, boxes, camera = exposure(0); original = deepcopy(camera)
        state = textured.TexturedGlobalWindowMotion(DisProvider(), "raw")
        result = state.update(frame, 0., pixels, boxes, camera_surface=camera)
        self.assertEqual(camera, original); self.assertEqual(result["tracks"], original["tracks"])
        self.assertEqual(dict(global_window.POLICY), previous)
        with self.assertRaises(ValueError): textured.TexturedGlobalWindowMotion(DisProvider(), "fallback")


if __name__ == "__main__": unittest.main()
