"""Authored deterministic merger/geometry checks, not model-quality evidence."""

from dataclasses import replace
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/"scripts"))
from assist_scene_motion import Detection
from assist_scene_tiled_detection import POLICY, Tile, TiledDetector


RAW = (1152, 2304)
WORK = (384, 768)
TARGET = Detection("car", .8, (350., 180., 370., 200.))


def local(tile, target=TARGET, score=.9, label=None, native=RAW, working=WORK):
    sx, sy = native[1]/working[1], native[0]/working[0]
    x, y, _, _ = tile.rect
    a, b, r, s = target.xyxy
    return Detection(label or target.label, score, (a*sx-x, b*sy-y, r*sx-x, s*sy-y))


class TiledDetectionTests(unittest.TestCase):
    def setUp(self):
        self.engine = TiledDetector()
        self.tiles = self.engine.plan(RAW, WORK)

    def merge(self, observations, current=()):
        return self.engine.merge(current, self.tiles, observations, RAW, WORK)

    def test_fixed_frame_wide_plan_independent_of_boxes_or_history(self):
        self.assertEqual(self.tiles, [Tile(0, (0, 0, 1383, 692)), Tile(1, (921, 0, 2304, 692)),
                                      Tile(2, (0, 460, 1383, 1152)), Tile(3, (921, 460, 2304, 1152))])
        self.assertEqual(len(self.tiles), POLICY["maxTilesPerFrame"])
        self.assertEqual(self.engine.plan(RAW, WORK), self.tiles)
        self.assertEqual(len(self.engine.plan(WORK, WORK)), 4)
        self.assertFalse(POLICY["temporalState"])
        with self.assertRaises(TypeError):
            POLICY["minimumTileScore"] = .2

    def test_exact_native_to_working_mapping_without_any_full_image_box(self):
        observations = [[], [], [], [local(self.tiles[3])]]
        output, diagnostics = self.merge(observations)
        self.assertEqual(len(output), 1)
        self.assertEqual(output[0].xyxy, TARGET.xyxy)
        self.assertEqual(diagnostics["accepted"], 1)
        self.assertEqual(diagnostics["acceptedSources"][0]["tileIndex"], 3)
        self.assertEqual(diagnostics["acceptedSources"][0]["mappedRect"], list(TARGET.xyxy))
        self.assertEqual(diagnostics["outputSources"][0]["kind"], "native-tile")

    def test_non_integer_native_ratio_maps_both_axes_exactly(self):
        native = (1001, 2003)
        working = (384, 768)
        tiles = self.engine.plan(native, working)
        target = Detection("person", .8, (400., 200., 420., 220.))
        output, _ = self.engine.merge([], tiles, [[], [], [], [local(tiles[3], target,
                                     native=native, working=working)]], native, working)
        for actual, expected in zip(output[0].xyxy, target.xyxy, strict=True):
            self.assertAlmostEqual(actual, expected, places=11)

    def test_overlapping_tile_duplicates_choose_highest_score_once(self):
        observations = [[local(tile, score=.7+i*.05)] for i, tile in enumerate(self.tiles)]
        output, diagnostics = self.merge(observations)
        self.assertEqual(len(output), 1)
        self.assertAlmostEqual(output[0].score, .85)
        self.assertEqual(diagnostics["reasons"]["tile-duplicate"], 3)
        self.assertEqual(diagnostics["candidateCount"], 4)

    def test_equal_score_order_and_diagnostics_are_repeatable(self):
        observations = [[local(tile)] for tile in self.tiles]
        output, diagnostics = self.merge(observations)
        self.assertEqual(self.merge(observations), (output, diagnostics))
        self.assertEqual(diagnostics["acceptedSources"][0]["tileIndex"], 0)

    def test_full_image_observation_is_preserved_without_relabel_or_rescore(self):
        observations = [[local(self.tiles[0], score=.99)], [], [], []]
        output, diagnostics = self.merge(observations, [TARGET])
        self.assertEqual(output, [TARGET])
        self.assertEqual(diagnostics["accepted"], 0)
        self.assertEqual(diagnostics["reasons"]["full-image-duplicate"], 1)
        self.assertEqual(diagnostics["outputSources"], [{"kind": "full-image", "index": 0}])

    def test_conflicting_full_image_class_never_gets_replaced(self):
        observations = [[local(self.tiles[0], label="bus")], [], [], []]
        output, diagnostics = self.merge(observations, [TARGET])
        self.assertEqual(output, [TARGET])
        self.assertEqual(diagnostics["reasons"]["full-image-conflict"], 1)

    def test_competing_crop_classes_abstain_in_both_orders(self):
        for first, second in (("car", "truck"), ("person", "car"), ("truck", "car")):
            observations = [[local(self.tiles[0], label=first)], [local(self.tiles[1], label=second)], [], []]
            output, diagnostics = self.merge(observations)
            self.assertEqual(output, [])
            self.assertEqual(diagnostics["reasons"]["ambiguous-tile-candidates"], 2)

    def test_same_class_shape_disagreement_and_nested_boxes_abstain(self):
        larger = Detection("car", .9, (350., 180., 390., 220.))
        observations = [[local(self.tiles[0])], [local(self.tiles[1], larger)], [], []]
        output, diagnostics = self.merge(observations)
        self.assertEqual(output, [])
        self.assertEqual(diagnostics["reasons"]["ambiguous-tile-candidates"], 2)

    def test_artificial_crop_boundary_is_rejected(self):
        tw = self.tiles[0].rect[2]
        detection = Detection("car", .95, (tw-40., 100., tw-1., 150.))
        output, diagnostics = self.merge([[detection], [], [], []])
        self.assertEqual(output, [])
        self.assertEqual(diagnostics["reasons"]["artificial-crop-edge"], 1)
        # The left/top original sensor edges are not artificial crop edges.
        output, diagnostics = self.merge([[Detection("person", .9, (0., 0., 60., 80.))], [], [], []])
        self.assertEqual(len(output), 1)
        self.assertEqual(diagnostics["accepted"], 1)

    def test_class_and_score_floor(self):
        rejected = [local(self.tiles[0], score=.599), local(self.tiles[0], label="dog")]
        output, diagnostics = self.merge([rejected, [], [], []])
        self.assertEqual(output, [])
        self.assertEqual(diagnostics["reasons"]["class-or-score"], 2)
        output, _ = self.merge([[local(self.tiles[0], score=.60)], [], [], []])
        self.assertEqual(len(output), 1)

    def test_output_budget_retains_all_full_image_boxes(self):
        current = [Detection("dog", .8, (10.+i*30, 10., 20.+i*30, 20.)) for i in range(12)]
        output, diagnostics = self.merge([[local(self.tiles[0])], [], [], []], current)
        self.assertEqual(output, current)
        self.assertEqual(diagnostics["reasons"]["output-budget"], 1)

    def test_empty_tiles_do_not_manufacture_or_remove_observations(self):
        self.assertEqual(self.merge([[], [], [], []])[0], [])
        self.assertEqual(self.merge([[], [], [], []], [TARGET])[0], [TARGET])

    def test_exact_tile_plan_binding_and_budget(self):
        bad_plans = ([], self.tiles[:3], self.tiles+self.tiles[:1], self.tiles[::-1],
                     [self.tiles[0]]*4, [replace(self.tiles[0], rect=(0., 0, 1383, 692)), *self.tiles[1:]])
        for plan in bad_plans:
            with self.subTest(plan=plan), self.assertRaises(ValueError):
                self.engine.merge([], plan, [[]]*len(plan), RAW, WORK)
        with self.assertRaises(ValueError):
            self.engine.merge([], self.tiles, [[], [], []], RAW, WORK)

    def test_malformed_observation_rejected_before_mapping(self):
        invalid = (Detection("car", float("nan"), (0., 0., 10., 10.)),
                   Detection("car", True, (0., 0., 10., 10.)), Detection("car", .9, None),
                   Detection("car", .9, (0., 0., float("inf"), 10.)),
                   Detection("car", .9, (-1., 0., 10., 10.)),
                   Detection("car", .9, (0., 0., 1400., 10.)))
        for detection in invalid:
            with self.subTest(detection=detection), self.assertRaises(ValueError):
                self.merge([[detection], [], [], []])
        with self.assertRaises(ValueError):
            self.merge([[local(self.tiles[0])]*13, [], [], []])
        with self.assertRaises(ValueError):
            self.merge([[], [], [], []], [TARGET]*13)

    def test_invalid_or_upscaled_geometry_rejected(self):
        for native in ((1152, 4097), (100, 100), (1152, 2000), (True, 2304), (32, 32)):
            with self.subTest(native=native), self.assertRaises(ValueError):
                self.engine.plan(native, WORK)


if __name__ == "__main__":
    unittest.main()
