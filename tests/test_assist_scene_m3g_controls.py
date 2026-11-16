"""Control geometry/provenance tests; not detector-quality evidence."""

import json
from pathlib import Path
import sys
import tempfile
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/"scripts"))
from assist_scene_m3g_controls import (BOX, FRAME_COUNT, SCENARIOS, approach_state,
                                     frame_targets, geometry, pixel_box, prepare, write_groups)
from assist_scene_motion import sha256


class M3GControlsTests(unittest.TestCase):
    def test_all_targets_stay_in_view_including_competitor_under_zoom_and_pan(self):
        width, height = 1920, 1606
        intrinsics = np.asarray([[1240., 0., width/2], [0., 1240., height/2], [0., 0., 1.]])
        source_box = pixel_box(BOX, width, height)
        for scenario in SCENARIOS:
            for index in range(FRAME_COUNT):
                with self.subTest(scenario=scenario, index=index):
                    warp, rot = geometry(scenario, index, width, height, intrinsics, source_box)
                    targets = frame_targets(scenario, index, width, height, warp)
                    self.assertTrue(np.allclose(rot.T@rot, np.eye(3)))
                    for target in targets:
                        x, y, w, h = (target["box"][key] for key in ("x", "y", "width", "height"))
                        self.assertTrue(0 <= x < x+w <= 1 and 0 <= y < y+h <= 1)
                    self.assertEqual(targets[1]["approach"], "not-approaching")
                    if scenario.startswith("approach-"):
                        self.assertTrue(np.allclose(rot, np.eye(3)))

    def test_authored_positive_requires_elapsed_400ms_not_frame_three(self):
        for scenario in SCENARIOS:
            self.assertEqual(approach_state(scenario, 4),
                             "unknown" if scenario.startswith("approach-") else "not-approaching")
            self.assertEqual(approach_state(scenario, 5),
                             "approaching" if scenario.startswith("approach-") else "not-approaching")

    def test_groups_share_assets_but_truth_binds_exact_group_manifest(self):
        clips = [{"id": name, "frames": [{"path": name+".jpg"}]} for name in SCENARIOS]
        manifest = {"schemaVersion": 1, "dataset": "synthetic-m3c", "clips": clips}
        gold = {"schemaVersion": 1, "review": {"kind": "NOT-physical-GT"}, "clips": clips}
        with tempfile.TemporaryDirectory(prefix="codex-tmp-m3g-controls-test-20261116-") as directory:
            destination = Path(directory)
            write_groups(destination, manifest, gold)
            for suffix, count in (("", 6), ("-negatives", 4), ("-positives", 2)):
                runtime = json.loads((destination/f"input{suffix}.json").read_text())
                truth = json.loads((destination/f"truth{suffix}.json").read_text())
                self.assertEqual(len(runtime["clips"]), count)
                self.assertEqual(truth["inputSha256"], sha256(destination/f"input{suffix}.json"))
                self.assertEqual(runtime["clips"], truth["clips"])
            self.assertEqual(len(list(destination.iterdir())), 6)
            self.assertNotEqual(sha256(destination/"input-negatives.json"), sha256(destination/"input-positives.json"))

    def test_wrong_source_rejected_before_output_creation(self):
        with tempfile.TemporaryDirectory(prefix="codex-tmp-m3g-controls-source-test-20261116-") as directory:
            source = Path(directory)
            (source/"camera").mkdir()
            from assist_scene_m3g_controls import SOURCE_SUBPATH
            (source/SOURCE_SUBPATH).write_bytes(b"not-the-reviewed-pinned-real-photo")
            destination = source/"output"
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                prepare(source, destination)
            self.assertFalse(destination.exists())


if __name__ == "__main__":
    unittest.main()
