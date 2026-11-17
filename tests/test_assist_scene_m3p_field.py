"""Injected CPU-network geometry/color tests, not learned inference evidence."""

from copy import deepcopy
from hashlib import sha256
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/"scripts"))
import assist_scene_m3p_field as field
import assist_scene_global_field as frozen


class ColorGeometryTests(unittest.TestCase):
    def test_640_arm_geometry_matches_frozen_gray_geometry_exactly(self):
        for shape in ((643, 768), (32, 768), (129, 257), (64, 96), (640, 640)):
            plan = field.geometry(shape, 640)
            self.assertEqual({k: plan[k] for k in frozen.geometry(shape)}, frozen.geometry(shape))
            self.assertEqual(plan["processedSideLimit"], 640)

    def test_768_arm_keeps_working_pixels_without_upscale_or_hidden_native_input(self):
        for shape, padded in (((643, 768), (648, 768)), ((129, 257), (136, 264)),
                              ((32, 64), (128, 128)), ((768, 767), (768, 768))):
            plan = field.geometry(shape, 768)
            self.assertEqual(plan["processedShape"], list(shape))
            self.assertEqual(plan["paddedShape"], list(padded))
            self.assertEqual(plan["scaleXY"], [1., 1.])

    def test_bad_dimensions_and_unregistered_resolution_fail_closed(self):
        for shape in ((31, 40), (769, 40), (2048, 2448), (), (1, 2, 3), (True, 80), [32., 32.]):
            with self.assertRaises(ValueError): field.geometry(shape)
        for size in (416, 641, True, 640., None):
            with self.assertRaises(ValueError): field.geometry((64, 96), size)

    def test_flow_vectors_actual_axes_and_half_pixel_centers(self):
        yy, xx = np.indices((536, 640), dtype=np.float32)
        raw = np.stack((.1*xx+2., -.04*yy+3.), axis=-1)
        result = field.restore_flow(raw, (643, 768), (536, 640), 640)
        x, y = 401, 301
        mx, my = (x+.5)*640/768-.5, (y+.5)*536/643-.5
        np.testing.assert_allclose(result[y, x], [(.1*mx+2.)*768/640, (-.04*my+3.)*643/536], atol=1e-4)

    def test_padding_is_never_resized_into_true_support_and_result_owns_bytes(self):
        raw = np.full((128, 640, 2), np.nan, np.float32)
        raw[:27, :640] = (1., -2.)
        result = field.restore_flow(raw, (32, 768), (27, 640), 640)
        self.assertTrue(np.isfinite(result).all())
        np.testing.assert_allclose(result[:, :, 0], 768/640, rtol=1e-6)
        np.testing.assert_allclose(result[:, :, 1], -2.*32/27, rtol=1e-6)
        raw[:] = 99.
        self.assertLess(float(result.max()), 2.)

    def test_restore_rejects_wrong_arm_shape_dtype_or_nonfinite_real_pixels(self):
        raw = np.zeros((648, 768, 2), np.float32)
        with self.assertRaises(ValueError): field.restore_flow(raw, (643, 768), (643, 768), 640)
        with self.assertRaises(ValueError): field.restore_flow(raw.astype(float), (643, 768), (643, 768), 768)
        with self.assertRaises(ValueError): field.restore_flow(raw[:-1], (643, 768), (643, 768), 768)
        raw[0, 0] = np.nan
        with self.assertRaises(ValueError): field.restore_flow(raw, (643, 768), (643, 768), 768)


class ColorNetworkTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import torch
        cls.torch = torch

    def owner(self, model=None):
        torch = self.torch
        if model is None:
            class Network:
                def __init__(self): self.calls = []
                def __call__(self, a, b, *, num_flow_updates):
                    self.calls.append((a.clone(), b.clone(), num_flow_updates))
                    h, w = a.shape[-2:]
                    values = torch.empty((1, 2, h, w))
                    values[:, 0] = 3.; values[:, 1] = -5.
                    return [values]
            model = Network()
        owner = field.TorchvisionRaftSmall.__new__(field.TorchvisionRaftSmall)
        owner._model, owner._torch, owner._device = model, torch, "cpu"
        owner._transform = lambda a, b: (a.float()/127.5-1., b.float()/127.5-1.)
        owner.direction_calls = 7
        owner.metadata = {"kind": "actual-local-pretrained-torchvision", "device": "cpu",
            "weightsSha256": field.POLICY["weightSha256"], "weightUrl": field.POLICY["weightUrl"],
            "weights": field.POLICY["weights"], "torch": "authored-fake-network", "torchvision": "authored-fake-network"}
        return owner

    def test_explicit_bgr_to_rgb_conversion_and_reverse_direction_are_not_grayscale(self):
        owner = self.owner(); state = field.ColorGlobalRaftSmall.from_provider(owner)
        old = np.empty((129, 257, 3), np.uint8); old[:] = (20, 80, 220)
        new = np.empty_like(old); new[:] = (33, 99, 177)
        before = old.copy(); result = state(old, new)
        np.testing.assert_array_equal(old, before)
        calls = owner._model.calls
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0][2], 12)
        self.assertEqual(tuple(calls[0][0].shape), (1, 3, 136, 264))
        np.testing.assert_allclose(calls[0][0][0, :, 0, 0], np.array([220, 80, 20])/127.5-1., atol=1e-6)
        self.assertTrue(self.torch.equal(calls[0][0], calls[1][1]))
        self.assertTrue(self.torch.equal(calls[0][1], calls[1][0]))
        self.assertEqual(state.direction_calls, 2); self.assertEqual(owner.direction_calls, 7)
        self.assertEqual(state.last_call["modelDirectionCalls"], 2)
        self.assertEqual(state.last_call["oldBgrSha256"], sha256(old.tobytes()).hexdigest())
        rgb = cv2.cvtColor(old, cv2.COLOR_BGR2RGB)
        self.assertEqual(state.last_call["processedRgbSha256"][0], sha256(rgb.tobytes()).hexdigest())
        np.testing.assert_array_equal(result[0][:, :, 0], 3.)

    def test_640_and_768_arms_share_model_but_have_distinct_policies_geometry_counters(self):
        owner = self.owner(); base = frozen.GlobalRaftSmall.from_provider(owner)
        low = field.ColorGlobalRaftSmall.from_provider(base, processed_side=640)
        high = field.ColorGlobalRaftSmall.from_provider(base, processed_side=768)
        self.assertIs(low._model, high._model); self.assertIs(low._model, base._model)
        image = np.zeros((643, 768, 3), np.uint8)
        a = low(image, image); b = high(image, image)
        self.assertEqual(low.last_call["processedShape"], [536, 640])
        self.assertEqual(high.last_call["processedShape"], [643, 768])
        self.assertEqual(high.last_call["paddedShape"], [648, 768])
        np.testing.assert_allclose(a[0][:, :, 0], 3.*768/640, rtol=1e-6)
        np.testing.assert_array_equal(b[0][:, :, 0], 3.)
        self.assertEqual(base.direction_calls, 0)
        self.assertEqual(owner.direction_calls, 7)
        self.assertEqual(low.direction_calls, 2); self.assertEqual(high.direction_calls, 2)
        self.assertEqual(low.metadata["modelSharing"], "shared-global-provider")

    def test_color_resize_then_padding_trace_matches_exact_true_pixels(self):
        state = field.ColorGlobalRaftSmall.from_provider(self.owner(), processed_side=640)
        rng = np.random.default_rng(6509)
        image = rng.integers(0, 256, (32, 768, 3), np.uint8)
        state(image, image)
        rgb = cv2.cvtColor(cv2.resize(image, (640, 27), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB)
        padded = np.pad(rgb, ((0, 101), (0, 0), (0, 0)), mode="edge")
        self.assertEqual(state.last_call["processedRgbSha256"][0], sha256(rgb.tobytes()).hexdigest())
        self.assertEqual(state.last_call["paddedRgbSha256"][0], sha256(padded.tobytes()).hexdigest())
        actual = state._model.calls[0][0][0].permute(1, 2, 0).numpy()
        np.testing.assert_allclose(actual, padded/127.5-1., atol=1e-6)

    def test_invalid_images_and_unregistered_resolution_never_call_model(self):
        owner = self.owner(); state = field.ColorGlobalRaftSmall.from_provider(owner)
        good = np.zeros((64, 96, 3), np.uint8)
        for a, b in ((good.astype(float), good), (good[:, :, 0], good), (good, good[:, :-1]),
                     (good[:, :, :2], good[:, :, :2]), (np.zeros((769, 32, 3), np.uint8),)*2):
            with self.assertRaises(ValueError): state(a, b)
        with self.assertRaises(ValueError): field.ColorGlobalRaftSmall.from_provider(owner, processed_side=416)
        self.assertEqual(state.direction_calls, 0); self.assertEqual(len(owner._model.calls), 0)

    def test_provider_pin_device_type_and_metadata_are_guarded(self):
        with self.assertRaises(TypeError): field.ColorGlobalRaftSmall.from_provider(object())
        owner = self.owner()
        with patch.object(field.TorchvisionRaftSmall, "__init__", side_effect=AssertionError("Do not load another model")):
            state = field.ColorGlobalRaftSmall.from_provider(owner)
        altered = state.metadata; altered["policy"]["flowUpdates"] = 99
        self.assertEqual(state.metadata["policy"]["flowUpdates"], 12)
        for key, value in (("weightsSha256", "a"*64), ("device", "mps"), ("kind", "fallback")):
            bad = self.owner(); bad.metadata[key] = value
            with self.assertRaises(ValueError): field.ColorGlobalRaftSmall.from_provider(bad)

    def test_failed_direction_is_counted_and_surfaced_without_retry(self):
        class Broken:
            def __init__(self): self.calls = 0
            def __call__(self, *a, **kw):
                self.calls += 1
                raise RuntimeError("authored unsupported operation")
        broken = Broken(); state = field.ColorGlobalRaftSmall.from_provider(self.owner(broken))
        image = np.zeros((64, 96, 3), np.uint8)
        with self.assertRaisesRegex(RuntimeError, "unsupported"): state(image, image)
        self.assertEqual(broken.calls, 1); self.assertEqual(state.direction_calls, 1)
        self.assertEqual(state.last_call["modelDirectionCalls"], 1)
        self.assertEqual(state.last_call["status"], "runtime-error")

    def test_bad_model_output_cannot_become_supported_field(self):
        torch = self.torch
        for outcome in ([], [torch.zeros((1, 2, 8, 8))], [torch.full((1, 2, 128, 128), float("nan"))]):
            class Wrong:
                def __call__(self, *a, **kw): return outcome
            state = field.ColorGlobalRaftSmall.from_provider(self.owner(Wrong()))
            image = np.zeros((64, 96, 3), np.uint8)
            with self.assertRaises(ValueError): state(image, image)
            self.assertEqual(state.last_call["status"], "runtime-error")
            self.assertEqual(state.direction_calls, 1)

    def test_concurrent_source_pixel_mutation_is_not_supported_evidence(self):
        torch = self.torch
        image = np.zeros((64, 96, 3), np.uint8)
        class Mutating:
            def __call__(self, a, b, **kw):
                image[0, 0, 0] ^= 1
                image[0, 0, 1] += 1
                h, w = a.shape[-2:]
                return [torch.zeros((1, 2, h, w))]
        state = field.ColorGlobalRaftSmall.from_provider(self.owner(Mutating()))
        with self.assertRaisesRegex(RuntimeError, "bytes changed"):
            state(image, image)
        self.assertEqual(state.direction_calls, 2)
        self.assertEqual(state.last_call["status"], "runtime-error")


if __name__ == "__main__": unittest.main()
