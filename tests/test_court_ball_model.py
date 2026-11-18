"""Frozen learned preprocessing/decode/safety contract; not model accuracy."""

import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import cv2
import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import court_ball_model as model


class CourtModelContract(unittest.TestCase):
    def test_manifest_and_reviewed_vendor_source_hash(self):
        manifest = model.load_manifest()
        self.assertEqual(manifest["config"]["heatmap_threshold"], 0.5)
        self.assertEqual(manifest["config"]["frames_in"], 3)
        self.assertEqual(manifest["config"]["fill_policy"], "none")

    def test_affine_native_roundtrip_not_anisotropic_guess(self):
        forward, inverse = model.affine_matrices(854, 480)
        for xy in [(0, 0), (427, 240), (853, 479), (125.5, 312.75)]:
            transformed = forward @ np.array([*xy, 1])
            restored = inverse @ np.array([*transformed, 1])
            np.testing.assert_allclose(restored, xy, atol=5e-5)
        self.assertAlmostEqual(forward[0, 0], forward[1, 1])

    def test_three_frames_chronological_rgb_and_imagenet(self):
        frames = [np.full((288, 512, 3), colour, np.uint8) for colour in [(0, 0, 255), (0, 255, 0), (255, 0, 0)]]
        tensor, _ = model.preprocess_triplet(frames)
        self.assertEqual(tuple(tensor.shape), (1, 9, 288, 512))
        self.assertEqual(tensor.dtype, torch.float32)
        centre = tensor[0, :, 144, 256].numpy()
        expected = (np.array([[1, 0, 0], [0, 1, 0], [0, 0, 1]]) - np.array([0.485, 0.456, 0.406])) / np.array([0.229, 0.224, 0.225])
        np.testing.assert_allclose(centre, expected.ravel(), atol=1e-6)

    def test_incomplete_temporal_context_is_not_padded(self):
        with self.assertRaises(model.CourtAnalysisError):
            model.preprocess_triplet([np.zeros((288, 512, 3), np.uint8)])

    def test_decode_fixed_threshold_strictly_greater_than_half(self):
        heatmap = np.full((288, 512), 0.5, np.float32)
        result = model.decode_heatmap(heatmap, np.array([[1, 0, 0], [0, 1, 0]], np.float32), 512, 288)
        self.assertEqual(result["status"], "missing")
        self.assertIsNone(result["ball"])

    def test_decode_weights_centroid_and_prefers_component_mass(self):
        heatmap = np.zeros((288, 512), np.float32)
        heatmap[100, 150] = 0.99
        heatmap[200, 250:253] = [0.6, 0.8, 0.6]
        result = model.decode_heatmap(heatmap, np.array([[1, 0, 0], [0, 1, 0]], np.float32), 512, 288)
        self.assertEqual(result["status"], "observed")
        self.assertAlmostEqual(result["ball"]["x"], 251, places=3)
        self.assertAlmostEqual(result["ball"]["confidence"], 0.8, places=5)

    def test_exact_mass_tie_abstains(self):
        heatmap = np.zeros((288, 512), np.float32)
        heatmap[100, 150] = heatmap[200, 250] = 0.8
        result = model.decode_heatmap(heatmap, np.array([[1, 0, 0], [0, 1, 0]], np.float32), 512, 288)
        self.assertEqual(result["status"], "ambiguous")
        self.assertIsNone(result["ball"])

    def test_heatmap_padding_outside_source_does_not_create_point(self):
        heatmap = np.zeros((288, 512), np.float32)
        heatmap[250, 400] = 0.8
        result = model.decode_heatmap(heatmap, np.array([[1, 0, -450], [0, 1, 0]], np.float32), 512, 288)
        self.assertIsNone(result["ball"])

    def test_nonfinite_heatmap_rejected(self):
        heatmap = np.zeros((288, 512), np.float32)
        heatmap[0, 0] = np.nan
        with self.assertRaises(model.CourtAnalysisError):
            model.decode_heatmap(heatmap, np.eye(2, 3), 512, 288)

    def test_wrong_weight_digest_never_reaches_pickle_loader(self):
        manifest = model.load_manifest()
        with patch.object(Path, "is_file", return_value=True), patch.object(Path, "stat") as stat, patch.object(model.torch, "load") as loader:
            stat.return_value.st_size = 1
            with self.assertRaises(model.CourtAnalysisError):
                model.verify_weights(Path("/not-a-model"), manifest)
            loader.assert_not_called()

    def test_published_architecture_uses_three_input_output_frames(self):
        net = model.HRNet(model.model_config())
        self.assertEqual(net.conv1.in_channels, 9)
        self.assertEqual(net.final_layers[0].out_channels, 3)

    def test_restricted_loader_no_unsafe_fallback(self):
        with patch.object(model, "verify_weights"), patch.object(model.torch, "load", return_value={"unexpected": 1}) as loader:
            with self.assertRaises(model.CourtAnalysisError):
                model.load_model(Path("/never-executed"), "cpu")
            loader.assert_called_once_with(Path("/never-executed"), map_location="cpu", weights_only=True)

    def test_full_loop_maps_temporal_channels_and_missing_edges(self):
        # Structural wiring mock, not learned model or detector-quality evidence.
        class FakeNetwork:
            def __call__(self, tensor):
                assert tuple(tensor.shape) == (1, 9, 288, 512)
                logits = torch.full((1, 3, 288, 512), -20.0)
                logits[0, 0, 100, 150] = 4
                logits[0, 1, 120, 200] = 4
                logits[0, 2, 140, 250] = 4
                return {0: logits}
        cache = Path(__file__).resolve().parents[1] / ".court-cache/m2"
        cache.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="model-contract-", dir=cache) as directory:
            source = Path(directory) / "structural.avi"
            writer = cv2.VideoWriter(str(source), cv2.VideoWriter_fourcc(*"MJPG"), 25, (512, 288))
            self.assertTrue(writer.isOpened())
            for _ in range(5):
                writer.write(np.zeros((288, 512, 3), np.uint8))
            writer.release()
            with patch.object(model, "load_model", return_value=(FakeNetwork(), "cpu", model.load_manifest(), 0.0)):
                session = model.analyze_video(source)
            self.assertEqual(session["source"]["frameCount"], 5)
            self.assertEqual(session["method"]["runtime"]["modelCalls"], 1)
            self.assertEqual([frame["index"] for frame in session["frames"]], [0, 1, 2, 3, 4])
            self.assertEqual([frame["ball"]["x"] for frame in session["frames"][:3]], [150.0, 200.0, 250.0])
            self.assertTrue(all(frame["ball"] is None and frame["status"] == "missing" for frame in session["frames"][3:]))
            self.assertEqual(session["decision"]["status"], "insufficient-evidence")


if __name__ == "__main__":
    unittest.main()
