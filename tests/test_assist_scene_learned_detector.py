"""Deterministic adapter controls. These do not establish real model quality."""

from contextlib import nullcontext
import hashlib
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/"scripts"))
import assist_scene_learned_detector as detector


def prediction(scores=None, labels=None, boxes=None):
    return {"scores": [.9] if scores is None else scores,
            "labels": [0] if labels is None else labels,
            "boxes": [[200., 100., 1000., 500.]] if boxes is None else boxes}


class Tensor:
    def __init__(self, value):
        self.value = value

    def to(self, _device): return self
    def detach(self): return self
    def cpu(self): return self
    def tolist(self): return self.value


class LearnedDetectorTests(unittest.TestCase):
    def parse(self, data, native=(1000, 2000), target=(384, 768)):
        return detector.parse_predictions(data, detector.ID2LABEL, native, target)

    def test_inverse_native_to_working_geometry_without_letterbox_assumption(self):
        boxes, counts = self.parse(prediction())
        self.assertEqual(boxes[0].xyxy, (76.8, 38.4, 384., 192.))
        self.assertEqual((boxes[0].label, boxes[0].score), ("person", .9))
        self.assertEqual(counts["detections"], 1)
        boxes, _ = self.parse(prediction(boxes=[[-5., -10., 2001., 1010.]]))
        self.assertEqual(boxes[0].xyxy, (0., 0., 768., 384.))

    def test_exact_source_working_resize_and_resource_bounds(self):
        for native, target in (((1000, 2000), (400, 768)), ((5000, 2000), (307, 768)),
                               ((4000, 4000), (768, 768)), ((1000, 2000), (1000, 2000)),
                               ((True, 2000), (2, 768)), ((1, 20), (1, 20))):
            with self.subTest(native=native, target=target), self.assertRaises(ValueError):
                self.parse(prediction(), native, target)
        self.assertEqual(detector.working_shape_for((333, 1000)), (256, 768))

    def test_score_floor_and_nonfinite_invalid_rejection(self):
        data = prediction(scores=[.38, .379, float("nan"), float("inf"), 1.1, -.1, True, .8, .7],
                          labels=[0, 0, 0, 0, 0, 0, 0, 999, 0],
                          boxes=[[1., 1., 50., 50.]]*8+[[0., 0., float("nan"), 50.]])
        boxes, counts = self.parse(data)
        self.assertEqual(len(boxes), 1)
        self.assertEqual(boxes[0].score, .38)
        self.assertEqual(counts["invalidRejected"], 7)
        self.assertEqual(counts["belowThreshold"], 1)
        for bounds in ([10., 10., 10., 40.], [30., 10., 20., 40.], [-40., -40., -10., -10.]):
            self.assertEqual(self.parse(prediction(boxes=[bounds]))[0], [])

    def test_invalid_shape_and_unbounded_prediction_fail_loud(self):
        for data in (prediction(scores=[]), prediction(boxes=[]),
                     prediction(scores=[.9]*301, labels=[0]*301, boxes=[[1, 1, 5, 5]]*301)):
            with self.assertRaises(ValueError): self.parse(data)

    def test_class_canonicalization_is_fixed(self):
        for class_id, label in ((3, "motorcycle"), (4, "airplane"), (57, "couch"),
                                (58, "potted plant"), (60, "dining table"), (62, "tv")):
            self.assertEqual(self.parse(prediction(labels=[class_id]))[0][0].label, label)
        self.assertEqual(len(detector.ID2LABEL), 80)

    def test_duplicate_rule_is_class_aware_and_deterministic(self):
        data = prediction(scores=[.8, .9, .85, .9], labels=[0, 0, 2, 0],
            boxes=[[10., 10., 100., 100.], [12., 12., 102., 102.],
                   [12., 12., 102., 102.], [11., 11., 101., 101.]])
        boxes, counts = self.parse(data)
        self.assertEqual([b.label for b in boxes], ["person", "car"])
        self.assertEqual(boxes[0].xyxy[0], 11.*768/2000)
        self.assertEqual(counts["duplicatesSuppressed"], 2)
        reverse = {key: list(reversed(value)) for key, value in data.items()}
        self.assertEqual(self.parse(reverse)[0], boxes)

    def test_twelve_box_cap_is_after_score_order_and_dedup(self):
        data = prediction(scores=[.9-i*.01 for i in range(14)], labels=[0]*14,
                          boxes=[[float(i*120), 1., float(i*120+50), 51.] for i in range(14)])
        boxes, counts = self.parse(data)
        self.assertEqual(len(boxes), 12)
        self.assertEqual(counts["overCap"], 2)
        self.assertEqual([b.score for b in boxes], data["scores"][:12])

    def test_artifact_hash_and_size_pin_no_pickle(self):
        with tempfile.TemporaryDirectory(prefix="codex-tmp-m3k-detector-20261116-") as folder:
            path = Path(folder)/"config.json"
            path.touch()
            empty_hash = hashlib.sha256(b"").hexdigest()
            with patch.object(detector, "ARTIFACTS", {"config.json": (0, empty_hash)}):
                root, hashes = detector.verify_artifacts(folder)
                self.assertEqual(root, Path(folder).resolve())
                self.assertEqual(hashes, {"config.json": empty_hash})
            with patch.object(detector, "ARTIFACTS", {"config.json": (0, "a"*64)}):
                with self.assertRaises(ValueError): detector.verify_artifacts(folder)
            with patch.object(detector, "ARTIFACTS", {"config.json": (1, empty_hash)}):
                with self.assertRaises(ValueError): detector.verify_artifacts(folder)
        self.assertEqual(set(detector.ARTIFACTS), {"config.json", "preprocessor_config.json", "model.safetensors"})

    def test_mock_runtime_current_bgr_only_and_synchronized_timings(self):
        instance = detector.LearnedDetector.__new__(detector.LearnedDetector)
        instance.device = "mps"
        sync = Mock()
        instance.torch = SimpleNamespace(mps=SimpleNamespace(synchronize=sync),
            inference_mode=nullcontext, tensor=lambda value, device: Tensor(value))
        instance.processor = Mock(return_value={"pixel_values": Tensor([])})
        instance.processor.post_process_object_detection.return_value = [
            {key: Tensor(value) for key, value in prediction().items()}]
        instance.model = Mock()
        instance.model.config.id2label = detector.ID2LABEL
        frame = np.zeros((1000, 2000, 3), np.uint8)
        frame[0, 0] = [1, 2, 3]
        boxes, report = instance.detect(frame, working_shape=(384, 768))
        self.assertEqual(instance.processor.call_args.kwargs["images"][0, 0].tolist(), [3, 2, 1])
        self.assertEqual(boxes[0].xyxy, (76.8, 38.4, 384., 192.))
        self.assertEqual(sync.call_count, 4)
        self.assertEqual(report["prediction"], prediction())
        self.assertEqual(report["id2label"], detector.ID2LABEL)
        for value in report["timing"].values(): self.assertGreaterEqual(value, 0)
        self.assertEqual(instance.model.call_count, 1)
        for invalid in (frame.astype(np.float32), frame[:, :, 0], frame[:, :, :2]):
            with self.assertRaises(ValueError): instance.detect(invalid)
        with self.assertRaises(ValueError): instance.detect(frame, working_shape=(400, 768))

    def test_constructor_local_only_explicit_device_and_no_fallback(self):
        fake_model = Mock()
        fake_model.to.return_value.eval.return_value = fake_model
        fake_model.config.id2label = detector.ID2LABEL
        fake_torch = SimpleNamespace(__version__="mock", float32="float32",
            backends=SimpleNamespace(mps=SimpleNamespace(is_available=lambda: True)),
            mps=SimpleNamespace(synchronize=Mock()))
        fake_transformers = SimpleNamespace(__version__="mock", RTDetrImageProcessor=Mock(),
                                            RTDetrV2ForObjectDetection=Mock())
        fake_transformers.RTDetrV2ForObjectDetection.from_pretrained.return_value = fake_model
        with patch.object(detector, "verify_artifacts", return_value=(Path("/fake"), {"model": "a"*64})), \
             patch.dict(sys.modules, {"torch": fake_torch, "transformers": fake_transformers}), \
             patch.dict(os.environ, {"PYTORCH_ENABLE_MPS_FALLBACK": "0"}):
            instance = detector.LearnedDetector("/fake")
            kwargs = fake_transformers.RTDetrV2ForObjectDetection.from_pretrained.call_args.kwargs
            self.assertTrue(kwargs["local_files_only"])
            self.assertTrue(kwargs["use_safetensors"])
            self.assertTrue(kwargs["disable_custom_kernels"])
            self.assertNotIn("trust_remote_code", kwargs)
            self.assertFalse(instance.provenance()["cpuFallback"])
            with self.assertRaises(ValueError): detector.LearnedDetector("/fake", device="cuda")
            with patch.dict(os.environ, {"PYTORCH_ENABLE_MPS_FALLBACK": "1"}):
                with self.assertRaises(ValueError): detector.LearnedDetector("/fake")
            fake_torch.backends.mps.is_available = lambda: False
            with self.assertRaises(RuntimeError): detector.LearnedDetector("/fake")


if __name__ == "__main__":
    unittest.main()
