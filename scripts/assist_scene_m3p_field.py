"""M3P controlled color/detail ablations of the existing global RAFT field.

This module adds no detector, tracker, identity, motion/range decision, hidden
download, device fallback or verifier policy. It consumes explicit working BGR
exposures and returns displacement in those same working-pixel coordinates.
RGB640 isolates loss of color against frozen gray640; RGB768 also avoids the
additional working768-to640 downsample. Neither arm recovers native2448 detail.

Load the pinned existing model once elsewhere and share it sequentially. RAFT
retains correlation buffers, so concurrent wrappers must not share one model.
"""

from copy import deepcopy
from hashlib import sha256
from time import perf_counter
from types import MappingProxyType

import cv2
import numpy as np

from assist_scene_global_field import GlobalRaftSmall
from assist_scene_learned_region import POLICY as PINNED_POLICY, TorchvisionRaftSmall


POLICY = MappingProxyType({
    **dict(PINNED_POLICY),
    "algorithm": "torchvision-raft-small-global-color",
    "input": "explicit-uint8-working-BGR-to-RGB-minus1-plus1",
    "minWorkingSide": 32, "maxInputSide": 768,
    "processedSides": (640, 768),
    "resize": "whole-frame-area-downsample-preserve-aspect-rounded-no-upscale",
    "flowCoordinates": "original-working-pixels-half-pixel-resize-inverse-vector-scale",
    "flowUpsampling": "bilinear-after-cropping-true-processed-extent",
    "padding": "bottom-right-replicate-crop-before-flow-restoration",
    "retainedExposures": 0, "directionsPerField": 2,
})


def geometry(shape, processed_side=640):
    """Return bounded real rounded-axis geometry, not a nominal resize ratio."""
    if type(processed_side) is not int or processed_side not in POLICY["processedSides"]:
        raise ValueError("Choose preregistered processed_side640 or768")
    if (not isinstance(shape, (tuple, list)) or len(shape) != 2
            or any(type(n) is not int for n in shape)
            or min(shape) < POLICY["minWorkingSide"] or max(shape) > POLICY["maxInputSide"]):
        raise ValueError("Expected bounded integer working height, width")
    height, width = shape
    factor = min(1., processed_side/max(shape))
    ph, pw = round(height*factor), round(width*factor)
    multiple = POLICY["inputMultiple"]
    padded = tuple(max(POLICY["minInputSide"], ((n+multiple-1)//multiple)*multiple) for n in (ph, pw))
    if max(padded) > processed_side:
        raise ValueError("Padded dimensions exceed the selected bounded arm")
    return {"roiShape": [height, width], "processedShape": [ph, pw],
        "paddedShape": list(padded), "scaleXY": [pw/width, ph/height],
        "processedSideLimit": processed_side}


def restore_flow(padded_field, original_shape, processed_shape, processed_side=640):
    """Exclude padding before interpolation, rescale displacements on each axis."""
    plan = geometry(original_shape, processed_side)
    if (not isinstance(processed_shape, (tuple, list)) or len(processed_shape) != 2
            or any(type(n) is not int for n in processed_shape)
            or list(processed_shape) != plan["processedShape"]):
        raise ValueError("Flow restoration differs from the declared color arm geometry")
    ph, pw = processed_shape
    if (not isinstance(padded_field, np.ndarray) or padded_field.dtype != np.float32
            or padded_field.shape != (*plan["paddedShape"], 2)):
        raise ValueError("Malformed complete padded color flow field")
    true = np.ascontiguousarray(padded_field[:ph, :pw])
    if not np.isfinite(true).all():
        raise ValueError("Nonfinite model displacement on actual image pixels")
    height, width = original_shape
    result = true.copy() if (height, width) == (ph, pw) else cv2.resize(true, (width, height), interpolation=cv2.INTER_LINEAR)
    result[:, :, 0] *= width/pw
    result[:, :, 1] *= height/ph
    if result.shape != (height, width, 2) or not np.isfinite(result).all():
        raise ValueError("Invalid original-working-coordinate displacement")
    return np.ascontiguousarray(result, dtype=np.float32)


class ColorGlobalRaftSmall:
    """Explicit BGR pair -> exact existing model -> original-coordinate fields.

    from_provider() never constructs a second model or increments its owner's
    counter. Each wrapper owns a distinct count of its actual attempted model
    directions. A failed direction is counted and raised, never silently retried.
    Pixel fingerprints are byte hashes, not proof of physical correspondence.
    """

    @classmethod
    def from_provider(cls, provider, *, processed_side=640):
        # Resolve a previously reviewed owner without inferring device/model
        # authority from an arbitrary object claiming similar metadata.
        if isinstance(provider, GlobalRaftSmall):
            metadata = provider.metadata
            if metadata.get("kind") != "actual-local-pretrained-torchvision-global":
                raise ValueError("Shared global provider kind changed")
            owner = provider._provider
            sharing = "shared-global-provider"
        elif isinstance(provider, TorchvisionRaftSmall):
            owner, sharing = provider, "shared-legacy-provider"
        else:
            raise TypeError("Share an explicitly loaded pinned legacy/global RAFT provider")
        metadata = owner.metadata
        if (metadata.get("kind") != "actual-local-pretrained-torchvision"
                or metadata.get("weightsSha256") != POLICY["weightSha256"]
                or metadata.get("weightUrl") != POLICY["weightUrl"]
                or metadata.get("weights") != POLICY["weights"]
                or metadata.get("device") not in ("cpu", "mps")
                or metadata["device"] != owner._device):
            raise ValueError("Shared owner does not bind the pinned checkpoint/device")
        geometry((32, 32), processed_side)
        result = cls.__new__(cls)
        result._provider = owner
        result._model, result._torch = owner._model, owner._torch
        result._transform, result._device = owner._transform, owner._device
        result._processed_side = processed_side
        result.direction_calls = 0
        result.last_call = {}
        result._metadata = {**deepcopy(metadata),
            "kind": "actual-local-pretrained-torchvision-global-color",
            "algorithm": POLICY["algorithm"], "policy": {**deepcopy(dict(POLICY)),
                "processedSides": list(POLICY["processedSides"]),
                "maxProcessedSide": processed_side, "maxPaddedSide": processed_side},
            "processedSideLimit": processed_side, "inputColorOrder": "BGR",
            "modelColorOrder": "RGB", "modelSharing": sharing,
            "counterScope": "color-wrapper-only-not-shared-owner-counter"}
        return result

    @property
    def metadata(self):
        return deepcopy(self._metadata)

    def __call__(self, old, new):
        if (not isinstance(old, np.ndarray) or not isinstance(new, np.ndarray)
                or old.dtype != np.uint8 or new.dtype != np.uint8
                or old.ndim != 3 or old.shape[2] != 3 or old.shape != new.shape):
            raise ValueError("Equal-shaped explicit uint8 working BGR images required")
        shape = tuple(old.shape[:2])
        plan = geometry(shape, self._processed_side)
        ph, pw = plan["processedShape"]
        padded_h, padded_w = plan["paddedShape"]
        started, before = perf_counter(), self.direction_calls
        self.last_call = {**plan, "device": self._device, "modelDirectionCalls": 0,
            "flowUpdatesPerDirection": POLICY["flowUpdates"], "status": "started",
            "inputColorOrder": "BGR", "modelColorOrder": "RGB",
            "oldBgrSha256": sha256(old.tobytes()).hexdigest(),
            "newBgrSha256": sha256(new.tobytes()).hexdigest()}
        try:
            tensors, processed_hashes, padded_hashes = [], [], []
            for image in (old, new):
                pixels = image if image.shape[:2] == (ph, pw) else cv2.resize(image, (pw, ph), interpolation=cv2.INTER_AREA)
                rgb = cv2.cvtColor(pixels, cv2.COLOR_BGR2RGB)
                processed_hashes.append(sha256(rgb.tobytes()).hexdigest())
                padded = np.pad(rgb, ((0, padded_h-ph), (0, padded_w-pw), (0, 0)), mode="edge")
                padded_hashes.append(sha256(padded.tobytes()).hexdigest())
                chw = np.ascontiguousarray(padded.transpose(2, 0, 1))
                tensors.append(self._torch.from_numpy(chw).unsqueeze(0))
            self.last_call.update(processedRgbSha256=processed_hashes, paddedRgbSha256=padded_hashes)
            first, second = self._transform(*tensors)
            first, second = first.to(self._device), second.to(self._device)
            fields = []
            with self._torch.inference_mode():
                for a, b in ((first, second), (second, first)):
                    self.direction_calls += 1
                    predictions = self._model(a, b, num_flow_updates=POLICY["flowUpdates"])
                    if not isinstance(predictions, (tuple, list)) or not predictions:
                        raise ValueError("Model omitted complete color field predictions")
                    last = predictions[-1]
                    if tuple(last.shape) != (1, 2, padded_h, padded_w):
                        raise ValueError("Model returned wrong complete color field geometry")
                    # CPU transfer synchronizes MPS; padding is removed BEFORE
                    # resizing and cannot become evidence for a true image pixel.
                    raw = last[0].permute(1, 2, 0).cpu().numpy()
                    fields.append(restore_flow(raw, shape, (ph, pw), self._processed_side))
            if (sha256(old.tobytes()).hexdigest() != self.last_call["oldBgrSha256"]
                    or sha256(new.tobytes()).hexdigest() != self.last_call["newBgrSha256"]):
                raise RuntimeError("Input BGR bytes changed during the field call")
            self.last_call.update(status="field-supported", outputShape=list(fields[0].shape))
            return tuple(fields)
        except Exception as error:
            self.last_call.update(status="runtime-error", error=f"{type(error).__name__}: {error}")
            raise
        finally:
            self.last_call.update(modelDirectionCalls=self.direction_calls-before,
                wallMs=1000.*(perf_counter()-started))
