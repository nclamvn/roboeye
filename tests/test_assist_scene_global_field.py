"""Pure geometry and fake-network tests, not pretrained inference evidence."""

from copy import deepcopy
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/"scripts"))
import assist_scene_global_field as field


class GeometryTests(unittest.TestCase):
    def test_fixed_full_frame_geometry_and_actual_rounded_scales(self):
        for shape, processed, padded in (((643, 768), (536, 640), (536, 640)),
                                         ((32, 768), (27, 640), (128, 640)),
                                         ((129, 257), (129, 257), (136, 264)),
                                         ((64, 96), (64, 96), (128, 128)),
                                         ((640, 640), (640, 640), (640, 640))):
            plan = field.geometry(shape)
            self.assertEqual(plan["processedShape"], list(processed))
            self.assertEqual(plan["paddedShape"], list(padded))
            self.assertEqual(plan["scaleXY"], [processed[1]/shape[1], processed[0]/shape[0]])
            self.assertLessEqual(max(padded), 640)
            self.assertTrue(all(n % 8 == 0 for n in padded))

    def test_bad_or_native_sized_inputs_rejected_before_allocation(self):
        for shape in ((31, 40), (769, 40), (2048, 2448), (1, 2, 3), (), (True, 80), [32., 32.]):
            with self.assertRaises(ValueError): field.geometry(shape)

    def test_displacement_vectors_rescaled_in_both_original_axes(self):
        values = np.empty((536, 640, 2), np.float32); values[:] = (3., 5.)
        out = field.restore_flow(values, (643, 768), (536, 640))
        self.assertEqual(out.shape, (643, 768, 2))
        self.assertEqual(out.dtype, np.float32)
        np.testing.assert_allclose(out[:, :, 0], 3.*768/640, rtol=1e-6)
        np.testing.assert_allclose(out[:, :, 1], 5.*643/536, rtol=1e-6)

    def test_half_pixel_centers_and_spatially_varying_flow_not_box_normalized(self):
        yy, xx = np.indices((536, 640), dtype=np.float32)
        values = np.stack((.1*xx+2., -.04*yy+3.), axis=-1)
        out = field.restore_flow(values, (643, 768), (536, 640))
        y, x = 301, 401
        mx = (x+.5)*640/768-.5
        my = (y+.5)*536/643-.5
        np.testing.assert_allclose(out[y, x], [(.1*mx+2.)*768/640, (-.04*my+3.)*643/536], atol=1e-4)

    def test_padding_is_cropped_before_flow_interpolation(self):
        padded = np.full((128, 640, 2), np.nan, np.float32)
        padded[:27, :640] = (1., -2.)
        out = field.restore_flow(padded, (32, 768), (27, 640))
        self.assertTrue(np.isfinite(out).all())
        np.testing.assert_allclose(out[:, :, 0], 768/640, rtol=1e-6)
        np.testing.assert_allclose(out[:, :, 1], -2.*32/27, rtol=1e-6)
        padded[:27] = 90.
        self.assertLess(float(out.max()), 2.)

    def test_malformed_nonfinite_true_fields_and_aliases_rejected(self):
        valid = np.ones((128, 128, 2), np.float32)
        for original, processed in ((None, (32, 32)), ((32, 32), None),
                                    ((32, 32), (32,)), ((32, 32), (32., 32.)),
                                    ((32, 32), (0, 32)), ((32, 32), (33, 32)),
                                    ((32, 32), (True, 32))):
            with self.assertRaises(ValueError): field.restore_flow(valid, original, processed)
        for values in (np.zeros((30, 40), np.float32), np.zeros((30, 40, 3), np.float32),
                       np.zeros((30, 40, 2), np.float64), np.zeros((2, 2, 2), np.float32),
                       np.full((30, 40, 2), np.nan, np.float32)):
            with self.assertRaises(ValueError): field.restore_flow(values, (30, 40), (30, 40))
        values = np.ones((32, 32, 2), np.float32)
        out = field.restore_flow(values, (32, 32), (32, 32))
        values[:] = 99.
        np.testing.assert_array_equal(out, 1.)


class FakeNetworkTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try: import torch
        except ImportError: raise unittest.SkipTest("Root owns torch installation")
        cls.torch = torch

    def provider(self, model=None):
        torch = self.torch
        if model is None:
            class Model:
                def __init__(self): self.calls = []
                def __call__(self, a, b, *, num_flow_updates):
                    self.calls.append((a.clone(), b.clone(), num_flow_updates))
                    height, width = a.shape[-2:]
                    output = torch.empty((1, 2, height, width))
                    output[:, 0] = 3.; output[:, 1] = -5.
                    return [output]
            model = Model()
        legacy = field.TorchvisionRaftSmall.__new__(field.TorchvisionRaftSmall)
        legacy._model, legacy._torch, legacy._device = model, torch, "cpu"
        legacy._transform = lambda a, b: (a.float()/127.5-1., b.float()/127.5-1.)
        legacy.direction_calls = 7
        legacy.metadata = {"kind": "actual-local-pretrained-torchvision", "device": "cpu",
                           "weightsSha256": field.POLICY["weightSha256"], "weightUrl": field.POLICY["weightUrl"],
                           "weights": field.POLICY["weights"], "torch": "unit-fake-network",
                           "torchvision": "unit-fake-network", "policy": {"fixture": True}}
        return legacy

    def test_shared_model_no_loading_and_distinct_actual_direction_counter(self):
        legacy = self.provider()
        with patch.object(field.TorchvisionRaftSmall, "__init__", side_effect=AssertionError("Do not reload")):
            state = field.GlobalRaftSmall.from_provider(legacy)
        self.assertIs(state._model, legacy._model)
        old = np.full((129, 257), 20, np.uint8); new = np.full(old.shape, 220, np.uint8)
        out, back = state(old, new)
        self.assertEqual(out.shape, (129, 257, 2))
        np.testing.assert_array_equal(out[:, :, 0], 3.)
        np.testing.assert_array_equal(back[:, :, 1], -5.)
        self.assertEqual(state.direction_calls, 2)
        self.assertEqual(legacy.direction_calls, 7)
        self.assertEqual(state.last_call["modelDirectionCalls"], 2)
        self.assertEqual(state.last_call["status"], "field-supported")
        self.assertEqual(state.last_call["paddedShape"], [136, 264])
        self.assertEqual(state.metadata["modelSharing"], "shared-legacy-provider")
        self.assertEqual(state.metadata["torch"], "unit-fake-network")
        self.assertNotIn("pixels", state.last_call)
        calls = state._model.calls
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0][2], 12)
        self.assertTrue(self.torch.equal(calls[0][0], calls[1][1]))
        self.assertTrue(self.torch.equal(calls[0][1], calls[1][0]))
        self.assertEqual(tuple(calls[0][0].shape), (1, 3, 136, 264))
        self.assertAlmostEqual(float(calls[0][0][0, 0, 0, 0]), 20/127.5-1., places=6)
        self.assertTrue(self.torch.equal(calls[0][0][:, :1], calls[0][0][:, 1:2]))
        self.assertFalse(self.torch.is_grad_enabled() is False, "Global context must be restored")

    def test_full_frame_resize_applied_once_not_per_object(self):
        state = field.GlobalRaftSmall.from_provider(self.provider())
        pixels = np.zeros((643, 768), np.uint8)
        forward, backward = state(pixels, pixels)
        self.assertEqual(len(state._model.calls), 2)
        self.assertEqual(tuple(state._model.calls[0][0].shape), (1, 3, 536, 640))
        self.assertEqual(state.last_call["processedShape"], [536, 640])
        np.testing.assert_allclose(forward[:, :, 0], 3.*768/640, rtol=1e-6)
        np.testing.assert_allclose(backward[:, :, 1], -5.*643/536, rtol=1e-6)

    def test_native_oversized_or_malformed_images_never_call_model(self):
        state = field.GlobalRaftSmall.from_provider(self.provider())
        good = np.zeros((64, 96), np.uint8)
        for a, b in ((good.astype(np.float32), good), (good[:, :, None], good),
                     (good, good[:, :-1]), (np.zeros((769, 32), np.uint8), np.zeros((769, 32), np.uint8))):
            with self.assertRaises(ValueError): state(a, b)
        self.assertEqual(state.direction_calls, 0)

    def test_shared_provider_pin_device_and_metadata_copy(self):
        with self.assertRaises(TypeError): field.GlobalRaftSmall.from_provider(object())
        legacy = self.provider(); state = field.GlobalRaftSmall.from_provider(legacy)
        state.metadata["policy"]["flowUpdates"] = 99
        self.assertEqual(field.POLICY["flowUpdates"], 12)
        self.assertEqual(legacy.metadata["policy"], {"fixture": True})
        for key, value in (("weightsSha256", "a"*64), ("device", "mps"), ("kind", "silent-fallback")):
            bad = self.provider(); bad.metadata[key] = value
            with self.assertRaises(ValueError): field.GlobalRaftSmall.from_provider(bad)

    def test_constructor_delegates_only_explicit_local_provider(self):
        provider = self.provider()
        with patch.object(field, "TorchvisionRaftSmall", return_value=provider) as constructor:
            state = field.GlobalRaftSmall("/explicit/local.pth", device="cpu", expected_sha256="b"*64)
        constructor.assert_called_once_with("/explicit/local.pth", device="cpu", expected_sha256="b"*64)
        self.assertEqual(state.metadata["modelSharing"], "owned-provider")

    def test_runtime_errors_are_surfaced_without_retry_or_fallback(self):
        class Broken:
            calls = 0
            def __call__(self, *args, **kwargs):
                self.calls += 1
                raise RuntimeError("authored unsupported device operation")
        broken = Broken(); state = field.GlobalRaftSmall.from_provider(self.provider(broken))
        pixels = np.zeros((64, 96), np.uint8)
        with self.assertRaisesRegex(RuntimeError, "unsupported device"):
            state(pixels, pixels)
        self.assertEqual(broken.calls, 1)
        self.assertEqual(state.direction_calls, 1)
        self.assertEqual(state.last_call["modelDirectionCalls"], 1)
        self.assertEqual(state.last_call["status"], "runtime-error")
        self.assertGreaterEqual(state.last_call["wallMs"], 0.)

    def test_wrong_model_field_geometry_rejected(self):
        torch = self.torch
        class Wrong:
            def __call__(self, *args, **kwargs): return [torch.zeros((1, 2, 8, 8))]
        state = field.GlobalRaftSmall.from_provider(self.provider(Wrong()))
        pixels = np.zeros((64, 96), np.uint8)
        with self.assertRaisesRegex(ValueError, "geometry"): state(pixels, pixels)
        self.assertEqual(state.last_call["status"], "runtime-error")


if __name__ == "__main__": unittest.main()
