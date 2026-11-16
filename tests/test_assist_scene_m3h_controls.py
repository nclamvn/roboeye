"""Structural checks for authored still-photo negatives, not field quality."""

import json
from pathlib import Path
import sys
import tempfile
import unittest

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/"scripts"))
from assist_scene_m3h_controls import prepare
from assist_scene_motion import sha256
from assist_scene_motion_m3c import load_input


class M3HControlsTests(unittest.TestCase):
    def test_generated_negatives_are_bound_and_do_not_leak_truth_to_runtime(self):
        with tempfile.TemporaryDirectory(prefix="codex-tmp-m3h-controls-test-20261116-") as scratch:
            root = Path(scratch)
            image = root/"source.png"
            self.assertTrue(cv2.imwrite(str(image), np.full((2048, 2448, 3), 95, np.uint8)))
            pose = np.eye(4).tolist()
            frames = [{"token": f"source-{i}", "path": "source.png", "timestampUs": 1_000_000+i*90_000,
                       "poseTimestampUs": 1_000_000+i*90_000, "cameraToWorld": pose,
                       "intrinsics": [[1200, 0, 1224], [0, 1200, 1024], [0, 0, 1]],
                       "sha256": sha256(image), "isKeyFrame": False} for i in range(4)]
            inputs = root/"source.json"
            inputs.write_text(json.dumps({"schemaVersion": 1, "dataset": "Boreas-real", "clips": [
                {"id": "one", "frames": frames}, {"id": "two", "frames": frames}]}))
            destination = root/"controls"
            prepare(inputs, destination)
            runtime, _ = load_input(destination/"input.json")
            truth = json.loads((destination/"truth.json").read_text())
            self.assertEqual(truth["inputSha256"], sha256(destination/"input.json"))
            self.assertEqual(truth["review"]["sourceSha256"], sha256(image))
            self.assertEqual(len(runtime["clips"]), 4)
            self.assertEqual(sum(len(c["frames"]) for c in runtime["clips"]), 80)
            self.assertNotIn("review", runtime)
            for clip, gold in zip(runtime["clips"], truth["clips"], strict=True):
                self.assertTrue(gold["allSceneNegative"])
                for i, (frame, target) in enumerate(zip(clip["frames"], gold["frames"], strict=True)):
                    self.assertEqual(frame["timestampUs"], 1_000_000+i*90_000)
                    self.assertEqual(frame["poseTimestampUs"], frame["timestampUs"])
                    self.assertEqual(target["targets"], [])
                    self.assertEqual(frame["sha256"], sha256(destination/frame["path"]))
            with self.assertRaises(FileExistsError):
                prepare(inputs, destination)
            manifest = json.loads(inputs.read_text())
            manifest["clips"][0]["frames"][0]["sha256"] = "0"*64
            inputs.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, "hash-bound"):
                prepare(inputs, root/"bad-hash")
            self.assertFalse((root/"bad-hash").exists())


if __name__ == "__main__":
    unittest.main()
