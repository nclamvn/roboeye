"""M3M bounded full-working-frame RAFT fields in original pixel coordinates.

One shared pair supplies all objects. This adapter does not associate objects,
retain exposures, infer expansion or manufacture validity for padded pixels.
The pretrained model and preprocessing are the pinned official M3K provider.
Only bounded full-frame resize/pad and coordinate restoration differ here.
"""

from copy import deepcopy
from time import perf_counter
from types import MappingProxyType

import cv2
import numpy as np

from assist_scene_learned_region import POLICY as LEGACY_POLICY, TorchvisionRaftSmall


POLICY = MappingProxyType({**dict(LEGACY_POLICY),
    "algorithm": "torchvision-raft-small-global", "minWorkingSide": 32,
    "maxInputSide": 768, "maxProcessedSide": 640, "maxPaddedSide": 640,
    "resize": "whole-frame-area-downsample-preserve-aspect-rounded",
    "flowCoordinates": "original-working-pixels-half-pixel-resize-inverse-vector-scale",
    "flowUpsampling": "bilinear-after-cropping-true-processed-extent",
    "padding": "bottom-right-replicate-crop-before-flow-restoration",
    "retainedExposures": 0, "directionsPerField": 2,
})


def geometry(shape):
    """Actual x/y scales use rounded dimensions, not the nominal ratio."""
    if (not isinstance(shape, (tuple, list)) or len(shape) != 2
            or any(type(n) is not int for n in shape)
            or min(shape) < POLICY["minWorkingSide"] or max(shape) > POLICY["maxInputSide"]):
        raise ValueError("Expected bounded working grayscale height, width")
    height, width = shape
    factor = min(1., POLICY["maxProcessedSide"]/max(shape))
    processed = (round(height*factor), round(width*factor))
    multiple = POLICY["inputMultiple"]
    padded = tuple(max(POLICY["minInputSide"], ((n+multiple-1)//multiple)*multiple) for n in processed)
    if max(padded) > POLICY["maxPaddedSide"]:
        raise ValueError("Padded field exceeds the preregistered model budget")
    return {"roiShape": [height, width], "processedShape": list(processed),
            "paddedShape": list(padded), "scaleXY": [processed[1]/width, processed[0]/height]}


def restore_flow(padded_field, original_shape, processed_shape):
    """Crop first. Padding is neither sampled nor resized into true support.

    OpenCV resize uses half-pixel centers: x_m=(x_w+.5)*sx-.5. Restoring
    displacements therefore requires u_w=u_m/sx, v_w=v_m/sy with the actual
    rounded axis sizes. The half-pixel origin cancels between both endpoints.
    """
    plan = geometry(original_shape)
    if (not isinstance(processed_shape, (tuple, list)) or len(processed_shape) != 2
            or any(type(n) is not int for n in processed_shape)
            or list(processed_shape) != plan["processedShape"]):
        raise ValueError("Flow restoration differs from the fixed whole-frame resize")
    height, width = original_shape
    ph, pw = processed_shape
    if (not isinstance(padded_field, np.ndarray) or padded_field.ndim != 3
            or padded_field.shape[2] != 2 or padded_field.shape[0] < ph or padded_field.shape[1] < pw
            or padded_field.dtype != np.float32):
        raise ValueError("Malformed model displacement field")
    true = np.ascontiguousarray(padded_field[:ph, :pw])
    if not np.isfinite(true).all():
        raise ValueError("Nonfinite model displacement on true image pixels")
    result = true.copy() if (height, width) == (ph, pw) else cv2.resize(true, (width, height), interpolation=cv2.INTER_LINEAR)
    result[:, :, 0] *= width/pw
    result[:, :, 1] *= height/ph
    if result.shape != (height, width, 2) or not np.isfinite(result).all():
        raise ValueError("Invalid restored displacement field")
    return np.ascontiguousarray(result, dtype=np.float32)


class GlobalRaftSmall:
    """Explicit-device, offline-only model adapter, with two calls per pair.

    Prefer from_provider() when a legacy ROI lane also runs: all wrappers use
    the SAME model sequentially, never concurrently, because RAFT mutates its
    internal correlation pyramid. This wrapper owns a DISTINCT direction_calls
    counter. Calls here do not increment the legacy provider's counter.
    """

    def __init__(self, weights_path, *, device="mps", expected_sha256=None):
        provider = TorchvisionRaftSmall(weights_path, device=device, expected_sha256=expected_sha256)
        self._bind(provider, "owned-provider")

    @classmethod
    def from_provider(cls, provider):
        if not isinstance(provider, TorchvisionRaftSmall):
            raise TypeError("Reuse the explicitly loaded pinned legacy RAFT provider")
        result = cls.__new__(cls)
        result._bind(provider, "shared-legacy-provider")
        return result

    def _bind(self, provider, sharing):
        metadata = provider.metadata
        if (metadata.get("kind") != "actual-local-pretrained-torchvision"
                or metadata.get("weightsSha256") != POLICY["weightSha256"]
                or metadata.get("weightUrl") != POLICY["weightUrl"]
                or metadata.get("weights") != POLICY["weights"]
                or metadata.get("device") not in ("mps", "cpu")
                or metadata["device"] != provider._device):
            raise ValueError("Shared provider does not bind the pinned checkpoint/device")
        self._provider = provider
        self._model, self._torch = provider._model, provider._torch
        self._transform, self._device = provider._transform, provider._device
        self.direction_calls = 0
        self.last_call = {}
        self.metadata = {**deepcopy(metadata), "kind": "actual-local-pretrained-torchvision-global",
                         "algorithm": POLICY["algorithm"], "policy": dict(POLICY),
                         "modelSharing": sharing, "counterScope": "global-wrapper-only-not-legacy-counter"}

    def __call__(self, old, new):
        if (not isinstance(old, np.ndarray) or not isinstance(new, np.ndarray)
                or old.dtype != np.uint8 or new.dtype != np.uint8
                or old.ndim != 2 or old.shape != new.shape):
            raise ValueError("Equal-shaped uint8 working grayscale exposures are required")
        plan = geometry(old.shape)
        ph, pw = plan["processedShape"]
        padded_h, padded_w = plan["paddedShape"]
        started, before = perf_counter(), self.direction_calls
        self.last_call = {**plan, "device": self._device, "modelDirectionCalls": 0,
                          "flowUpdatesPerDirection": POLICY["flowUpdates"], "status": "started"}
        try:
            tensors = []
            for image in (old, new):
                pixels = image if image.shape == (ph, pw) else cv2.resize(image, (pw, ph), interpolation=cv2.INTER_AREA)
                padded = np.pad(pixels, ((0, padded_h-ph), (0, padded_w-pw)), mode="edge")
                rgb = np.repeat(padded[None, :, :], 3, axis=0)
                tensors.append(self._torch.from_numpy(rgb.copy()).unsqueeze(0))
            a, b = self._transform(*tensors)
            a, b = a.to(self._device), b.to(self._device)
            fields = []
            with self._torch.inference_mode():
                for first, second in ((a, b), (b, a)):
                    self.direction_calls += 1
                    predictions = self._model(first, second, num_flow_updates=POLICY["flowUpdates"])
                    last = predictions[-1]
                    if tuple(last.shape) != (1, 2, padded_h, padded_w):
                        raise ValueError("Model returned wrong complete field geometry")
                    # CPU transfer synchronizes completed MPS inference. The
                    # restore helper removes padding before interpolation.
                    raw = last[0].permute(1, 2, 0).cpu().numpy()
                    fields.append(restore_flow(raw, old.shape, (ph, pw)))
            self.last_call.update(status="field-supported", outputShape=list(fields[0].shape))
            return tuple(fields)
        except Exception as error:
            self.last_call.update(status="runtime-error", error=f"{type(error).__name__}: {error}")
            raise
        finally:
            self.last_call.update(modelDirectionCalls=self.direction_calls-before,
                                  wallMs=1000.*(perf_counter()-started))
