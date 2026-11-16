"""Authored uint8 image experiments with analytic fields, NOT model evidence."""

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
import assist_scene_texture_patches as texture
import assist_scene_scale_approach as frozen


SHAPE = (192, 192)
BOX = (48., 48., 144., 144.)


def fixture(seed=650701):
    rng = np.random.default_rng(seed)
    return cv2.GaussianBlur(rng.integers(0, 256, SHAPE, np.uint8), (3, 3), .55)


def fields(matrix, shape=SHAPE):
    yy, xx = np.mgrid[:shape[0], :shape[1]]
    points = np.stack((xx, yy), axis=-1).astype(np.float32)
    inverse = cv2.invertAffineTransform(np.asarray(matrix, float))
    return tuple((points@m[:, :2].T+m[:, 2]-points).astype(np.float32) for m in (matrix, inverse))


class TexturePatchesTests(unittest.TestCase):
    def setUp(self):
        self.image = fixture()
        self.zero = np.zeros((*SHAPE, 2), np.float32)

    def test_source_inventory_deterministic_cached_and_complete(self):
        cache = texture.texture_maps(self.image)
        first = texture.select_seeds(self.image, BOX)
        self.assertEqual(first, texture.select_seeds(self.image, BOX, cache))
        self.assertTrue(texture.validate_selection(first))
        self.assertEqual(first["seedPoints"], 64)
        self.assertEqual(first["cells"], [[y, x] for y in range(8) for x in range(8)])
        self.assertEqual(first["sourceSha256"], sha256(self.image.tobytes()).hexdigest())
        for x, y in first["points"]:
            p = self.image[y-3:y+4, x-3:x+4].astype(float)
            self.assertGreaterEqual(p.var(), 16)
        self.assertFalse(cache["corner"].flags.writeable)

    def test_selected_point_is_cell_max_source_corner(self):
        maps = texture.texture_maps(self.image)
        selection = texture.select_seeds(self.image, BOX, maps)
        lo = np.array(BOX[:2])+.12*(np.array(BOX[2:])-BOX[:2]); hi = np.array(BOX[2:])-.12*(np.array(BOX[2:])-BOX[:2])
        for (x, y), (row, col), score in zip(selection["points"], selection["cells"], selection["cornerScores"]):
            yy, xx = np.mgrid[int(np.ceil(lo[1])):int(np.floor(hi[1]))+1, int(np.ceil(lo[0])):int(np.floor(hi[0]))+1]
            cellx = np.minimum(7, np.floor((xx-lo[0])/(hi[0]-lo[0])*8).astype(int))
            celly = np.minimum(7, np.floor((yy-lo[1])/(hi[1]-lo[1])*8).astype(int))
            valid = (cellx == col) & (celly == row) & (maps["variance"][yy, xx] >= 16)
            self.assertEqual(score, float(maps["corner"][yy, xx][valid].max()))
            self.assertEqual(score, float(maps["corner"][y, x]))

    def test_precomputed_inventory_never_reselected_or_filtered(self):
        selection = texture.select_seeds(self.image, BOX)
        with patch.object(texture, "select_seeds", side_effect=AssertionError("reselection")):
            first = texture.population(self.image, self.image, BOX, self.zero, self.zero, selection=selection)
            bad = self.zero.copy(); bad[:] = np.nan
            second = texture.population(self.image, 255-self.image, BOX, bad, bad, "warped", selection=selection)
        self.assertEqual(first[-1]["selectionSha256"], second[-1]["selectionSha256"])
        np.testing.assert_array_equal(first[0], second[0])
        self.assertEqual(len(second[0]), 64); self.assertFalse(second[3].any())
        self.assertTrue(texture.validate_population(second[-1]))

    def test_raw_matches_exact_frozen_patch_gate(self):
        matrix = np.array([[1., 0., 2.25], [0., 1., -1.5]])
        new = cv2.warpAffine(self.image, matrix, SHAPE[::-1])
        forward, backward = fields(matrix)
        a, b, cycles, good, proof = texture.population(self.image, new, BOX, forward, backward)
        np.testing.assert_array_equal(good, frozen._matching_patches(self.image, new, a, b))
        self.assertTrue(texture.validate_population(proof))
        self.assertLess(cycles.max(), .001)

    def test_actual_authored_deformation_improves_pixel_agreement(self):
        # Fixed authored deformation near (but inside) existing shape bounds.
        matrix = cv2.getRotationMatrix2D((96., 96.), 12., 1.35)
        matrix[:, 2] += [-4., 3.]
        new = cv2.warpAffine(self.image, matrix, SHAPE[::-1], flags=cv2.INTER_LINEAR)
        forward, backward = fields(matrix)
        raw = texture.population(self.image, new, BOX, forward, backward, "raw")
        warped = texture.population(self.image, new, BOX, forward, backward, "warped")
        self.assertEqual(raw[-1]["selectionSha256"], warped[-1]["selectionSha256"])
        self.assertGreaterEqual(int(warped[3].sum()), 45)
        self.assertGreater(int(warped[3].sum()), int(raw[3].sum()))
        self.assertTrue(texture.validate_population(warped[-1]))
        self.assertTrue(all(p["patchValidSamples"] == 49 for p in warped[-1]["points"] if p["good"]))

    def test_second_authored_texture_wrong_image_and_periodic_alias(self):
        yy, xx = np.mgrid[:192, :192]
        repeat = np.where(((xx//4)+(yy//4)) % 2, 220, 25).astype(np.uint8)
        wrong = texture.population(repeat, 245-repeat, BOX, self.zero, self.zero, "warped")
        self.assertFalse(wrong[3].any())
        # A complete repeated period is honestly indistinguishable locally.
        matrix = np.array([[1., 0., 8.], [0., 1., 0.]])
        forward, backward = fields(matrix)
        alias = texture.population(repeat, repeat, BOX, forward, backward, "warped")
        self.assertEqual(int(alias[3].sum()), 64)
        self.assertNotIn("identity", alias[-1])
        self.assertTrue(texture.validate_population(alias[-1]))

    def test_flat_and_subnine_remain_actual_unknown_population(self):
        flat = np.full(SHAPE, 100, np.uint8)
        result = texture.population(flat, flat, BOX, self.zero, self.zero)
        self.assertEqual(result[0].shape, (0, 2)); self.assertEqual(result[-1]["seedPoints"], 0)
        self.assertTrue(texture.validate_population(result[-1]))
        small = texture.select_seeds(self.image, (60., 60., 67., 67.))
        self.assertLess(small["seedPoints"], 9)
        self.assertTrue(texture.validate_selection(small))

    def test_reflection_is_not_positive_deformation(self):
        matrix = np.array([[-1., 0., 191.], [0., 1., 0.]])
        forward, backward = fields(matrix)
        result = texture.population(self.image, np.fliplr(self.image).copy(), BOX, forward, backward, "warped")
        self.assertFalse(result[3].any())
        self.assertEqual(result[-1]["reasonCounts"], {"invalid-local-affine": 64})

    def test_center_cycle_does_not_replace_patch_cycles(self):
        selection = texture.select_seeds(self.image, BOX)
        backward = self.zero.copy(); backward[:, :, 0] = 4.
        for x, y in selection["points"]: backward[y, x] = 0
        result = texture.population(self.image, self.image, BOX, self.zero, backward, "warped", selection=selection)
        self.assertTrue((result[2] == 0).all()); self.assertFalse(result[3].any())
        self.assertEqual(result[-1]["reasonCounts"], {"patch-cycle": 64})

    def test_warped_failure_never_falls_back_to_raw(self):
        matrix = np.array([[1.6, 0., -57.6], [0., 1.6, -57.6]])
        forward, backward = fields(matrix)
        with patch.object(texture, "_ncc", side_effect=AssertionError("shape veto must precede NCC")):
            result = texture.population(self.image, self.image, BOX, forward, backward, "warped")
        self.assertFalse(result[3].any()); self.assertEqual(len(result[0]), 64)

    def test_boundary_and_invalid_field_preserve_denominator(self):
        forward = self.zero.copy(); backward = self.zero.copy()
        forward[:, :, 0] = -60.; backward[:, :, 0] = 60.
        result = texture.population(self.image, self.image, (0., 0., 40., 40.), forward, backward, "warped")
        self.assertGreater(len(result[0]), 0); self.assertFalse(result[3].any())
        self.assertEqual(result[-1]["seedPoints"], len(result[-1]["points"]))
        self.assertTrue(texture.validate_population(result[-1]))

    def test_guards_stale_cache_inventory_and_invalid_modes(self):
        cache = texture.texture_maps(self.image)
        with self.assertRaises(ValueError): texture.select_seeds(255-self.image, BOX, cache)
        for image in (self.image.astype(float), self.image[:, :, None], np.zeros((0, 7), np.uint8)):
            with self.assertRaises(ValueError): texture.select_seeds(image, BOX)
        for box in ((0, 0, 0, 8), (0, 0, np.nan, 8)):
            with self.assertRaises(ValueError): texture.select_seeds(self.image, box)
        for kw in ({"mode": "best"}, {"selection": texture.select_seeds(255-self.image, BOX)}):
            with self.assertRaises(ValueError): texture.population(self.image, self.image, BOX, self.zero, self.zero, **kw)
        with self.assertRaises(ValueError): texture.population(self.image, self.image, BOX, self.zero[:10], self.zero)
        for field in (self.zero.astype(np.float64), self.zero[:, :, 0]):
            with self.assertRaises(ValueError): texture.population(self.image, self.image, BOX, field, self.zero)
        self.assertEqual(texture.select_seeds(self.image, (1e100, 1e100, 2e100, 2e100))["seedPoints"], 0)

    def test_all_local_shape_and_full_grid_residual_floors(self):
        start = np.array([96., 96.], np.float32)
        offsets = texture._OFFSETS
        for linear in (np.diag([1.3, .8]), cv2.getRotationMatrix2D((0., 0.), 16., 1.)[:, :2],
                       np.diag([1.6, 1.6]), np.diag([-1., 1.])):
            _, good = texture._local_affine(start, start, offsets@linear.T+start)
            self.assertFalse(good)
        mapped = offsets+start; mapped = mapped.copy(); mapped[0] += [3., 0.]
        proof, good = texture._local_affine(start, start, mapped)
        self.assertFalse(good); self.assertGreater(proof["maxAffineResidualPx"], 1.2)

    def test_certificate_tampering_rejected(self):
        proof = texture.population(self.image, self.image, BOX, self.zero, self.zero, "warped")[-1]
        self.assertTrue(texture.validate_population(proof))
        for mutate in (lambda p: p.update(seedPoints=63), lambda p: p["points"][0].update(patchCycleCount=0),
                       lambda p: p["points"][0].update(localLinearLogGrowth=.39),
                       lambda p: p["selection"]["sourceVariances"].__setitem__(0, 0),
                       lambda p: p.update(oldWorkingSha256="0"*64),
                       lambda p: p["points"][0].update(sourcePoint=[0, 0]),
                       lambda p: p["points"][0].update(normProduct=float("nan"))):
            altered = deepcopy(proof); mutate(altered)
            with self.assertRaises(ValueError): texture.validate_population(altered)
        json.dumps(proof, allow_nan=False)


if __name__ == "__main__": unittest.main()
