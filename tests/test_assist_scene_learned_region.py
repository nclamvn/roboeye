"""Structural/injected-field tests, not real pretrained or field acceptance."""

from collections import deque
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/"scripts"))
import assist_scene_learned_region as learned
from assist_scene_cohort_loom import CohortWindowLoom
import assist_scene_window_loom as window
from assist_scene_dense_window import _sample
from assist_scene_motion import Detection
import test_assist_scene_window_loom as fixtures


class InjectedDIS:
    """Frozen baseline only, explicitly NOT a learned-model inference claim."""

    def __init__(self):
        baseline = CohortWindowLoom()
        self.dis = baseline._dis
        self.direction_calls = 0
        self.metadata = {"kind": "injected-test-DIS-not-pretrained"}

    def __call__(self, p, q):
        self.direction_calls += 2
        return self.dis.calc(p, q, None), self.dis.calc(q, p, None)


class LearnedRegionTests(unittest.TestCase):
    def test_only_field_and_constructor_change_frozen_core(self):
        for name in ("update", "_cohort_flow", "_seed_cohort", "_new_points",
                     "_cumulative_evidence", "_update_common_scale", "_reset"):
            self.assertIs(getattr(learned.LearnedCohortWindowLoom, name), getattr(CohortWindowLoom, name))

    def test_padded_shape_bound_no_upscale_coordinates(self):
        for shape, expected in (((20, 31), (128, 128)), ((129, 257), (136, 264)),
                                ((384, 383), (384, 384)), ((128, 128), (128, 128))):
            self.assertEqual(learned._padded_shape(shape), expected)
        for shape in ((0, 12), (385, 12), (12,), (2, 3, 4)):
            with self.assertRaises(ValueError): learned._padded_shape(shape)

    def test_offline_weight_hash_checked_before_torch_import(self):
        with self.assertRaises(ValueError): learned.TorchvisionRaftSmall(__file__, device="cpu")
        with self.assertRaises(ValueError): learned.TorchvisionRaftSmall(__file__, device="cuda")
        with self.assertRaises(FileNotFoundError):
            learned.TorchvisionRaftSmall("/nonexistent-codex-m3k-model.pth", device="cpu")

    def test_field_geometry_mapping_and_provider_called_once(self):
        provider = InjectedDIS()
        state = learned.LearnedCohortWindowLoom(provider)
        _, pixels, box = fixtures.image(0)
        expected = window._tile(pixels, pixels, box.xyxy, box.xyxy, np.eye(3))
        field, reason = state._field(pixels, pixels, box, box, np.eye(3))
        self.assertEqual(reason, "field-supported")
        for actual, original in zip(field[:3], expected, strict=True): np.testing.assert_array_equal(actual, original)
        self.assertEqual(field[3].shape, (*field[0].shape, 2))
        trace = state.drain_trace()
        self.assertEqual(len(trace), 1)
        self.assertEqual(trace[0]["modelDirectionCalls"], 2)
        self.assertIn("not-pretrained", trace[0]["providerKind"])
        self.assertEqual(state.drain_trace(), [])

    def test_invalid_fields_cannot_enter_frozen_validator(self):
        _, pixels, box = fixtures.image(0)
        for bad in (None, (), (np.zeros((1, 1, 2), np.float32),)*2,
                    (np.full((pixels.shape[0], pixels.shape[1], 2), np.nan, np.float32),)*2):
            state = learned.LearnedCohortWindowLoom(lambda p, q: bad)
            field, reason = state._field(pixels, pixels, box, box, np.eye(3))
            self.assertIsNone(field)
            self.assertEqual(reason, "invalid-learned-flow")
            self.assertEqual(state.drain_trace()[0]["status"], reason)

    def test_runtime_failure_recorded_and_raised_without_retry(self):
        def unavailable(p, q): raise RuntimeError("authored unsupported accelerator op")
        state = learned.LearnedCohortWindowLoom(unavailable)
        _, pixels, box = fixtures.image(0)
        with self.assertRaisesRegex(RuntimeError, "unsupported accelerator"):
            state._field(pixels, pixels, box, box, np.eye(3))
        trace = state.drain_trace()
        self.assertEqual(trace[0]["status"], "runtime-error")
        self.assertIn("unsupported accelerator", trace[0]["error"])

    def test_trace_is_bounded_and_excludes_pixels(self):
        state = learned.LearnedCohortWindowLoom(InjectedDIS())
        _, pixels, box = fixtures.image(0)
        for _ in range(learned.POLICY["maxTraceRows"]+2):
            state._field(pixels, pixels, box, box, np.eye(3))
        trace = state.drain_trace()
        self.assertEqual(len(trace), learned.POLICY["maxTraceRows"])
        self.assertTrue(all(not isinstance(v, np.ndarray) for row in trace for v in row.values()))

    def test_invalid_crop_never_calls_provider(self):
        with patch.object(window, "_tile", return_value=None):
            with patch.object(InjectedDIS, "__call__", side_effect=AssertionError("not allowed")):
                state = learned.LearnedCohortWindowLoom(InjectedDIS())
                _, pixels, box = fixtures.image(0)
                self.assertEqual(state._field(pixels, pixels, box, box, np.eye(3)), (None, "invalid-object-crop"))

    def test_injected_field_exactly_reproduces_frozen_baseline_not_quality_claim(self):
        for growth in (1., 1.025):
            parent = CohortWindowLoom()
            candidate = learned.LearnedCohortWindowLoom(InjectedDIS())
            for i in range(9):
                frame, pixels, box = fixtures.image(i, growth**i)
                expected = parent.update(frame, i*80., pixels, [box])
                actual = candidate.update(frame, i*80., pixels, [box])
                self.assertEqual(actual, expected)
                self.assertLessEqual(len(candidate.drain_trace()), 1)

    def test_current_failure_and_missing_detection_never_coast(self):
        state = learned.LearnedCohortWindowLoom(InjectedDIS())
        for i in range(7): output = fixtures.run(state, i, 1.025**i)
        self.assertTrue(output["events"])
        with patch.object(state, "flow_provider", side_effect=lambda p, q: (np.zeros((*p.shape, 2), np.float32),)*2):
            out = fixtures.run(state, 7, 1.025**7)
        self.assertFalse(out["events"])
        frame, pixels, box = fixtures.image(8, 1.025**8)
        missing = state.update(frame, 640., pixels, [])
        self.assertFalse(missing["events"])
        self.assertEqual(state._previous[3], [])

    def test_padding_coordinates_are_not_sampleable_support(self):
        # The inherited sampler sees only the original returned true ROI.
        flow = np.zeros((20, 31, 2), np.float32)
        _, valid = _sample(flow, np.array([[5, 5], [32, 5], [5, 21]], np.float32))
        self.assertEqual(valid.tolist(), [True, False, False])


class TorchTensorBoundaryTests(unittest.TestCase):
    def test_fixed_updates_normalization_padding_and_crop_without_model_download(self):
        try: import torch
        except ImportError: self.skipTest("torch not installed; root owns installation")

        class FakeModel:
            def __init__(self): self.calls = []
            def __call__(self, a, b, *, num_flow_updates):
                self.calls.append((a.clone(), b.clone(), num_flow_updates))
                h, w = a.shape[-2:]
                output = torch.zeros((1, 2, h, w))
                output[0, 0] = torch.arange(w).expand(h, w)
                output[0, 1] = torch.arange(h)[:, None].expand(h, w)
                return [output]

        backend = learned.TorchvisionRaftSmall.__new__(learned.TorchvisionRaftSmall)
        backend._torch = torch
        backend._model = FakeModel()
        backend._device = "cpu"
        backend._transform = lambda a, b: (a.float()/127.5-1, b.float()/127.5-1)
        backend.direction_calls = 0
        p = np.arange(20*31, dtype=np.uint8).reshape(20, 31)
        q = 255-p
        forward, backward = backend(p, q)
        self.assertEqual(forward.shape, (20, 31, 2))
        self.assertEqual(backward.shape, forward.shape)
        np.testing.assert_array_equal(forward[19, 30], [30, 19])
        self.assertEqual(len(backend._model.calls), 2)
        first, second, updates = backend._model.calls[0]
        self.assertEqual(updates, 12)
        self.assertEqual(tuple(first.shape), (1, 3, 128, 128))
        np.testing.assert_allclose(first[0, 0, :20, :31], p.astype(np.float32)/127.5-1)
        self.assertEqual(first[0, 0, -1, -1], first[0, 0, 19, 30])
        self.assertTrue(torch.equal(first[:, :1], first[:, 1:2]))
        self.assertTrue(torch.equal(backend._model.calls[1][0], second))
        self.assertEqual(backend.last_call["modelDirectionCalls"], 2)
        self.assertEqual(backend.last_call["paddedShape"], [128, 128])


if __name__ == "__main__": unittest.main()
