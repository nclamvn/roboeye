"""M3K learned field substitution for frozen M3H identities and cohorts.

Only _field changes correspondence. All inherited identity, cohort lifetime,
NCC, forward/backward, camera, support, spread and angular growth gates remain.
No new tracker, detector, range, TTC or app fallback.

Model/weight metadata: https://github.com/pytorch/vision/blob/main/torchvision/models/optical_flow/raft.py
Torchvision and upstream RAFT code are BSD-3-Clause. Pretrained dataset/model
terms require separate use-case review; code licensing is not model clearance.
"""

from collections import deque
from hashlib import sha256
import os
from pathlib import Path
from time import perf_counter
from types import MappingProxyType

import numpy as np

from assist_scene_cohort_loom import CohortWindowLoom
import assist_scene_window_loom as window


POLICY = MappingProxyType({
    "algorithm": "torchvision-raft-small", "weights": "C_T_V2",
    "weightUrl": "https://download.pytorch.org/models/raft_small_C_T_V2-01064c6d.pth",
    "weightSha256": "01064c6dba73b0fc9fc8edf772248560a00a3acfd62ac6677e9eeebad9680e27", "flowUpdates": 12,
    "minInputSide": 128, "inputMultiple": 8,
    "maxInputSide": window.POLICY["maxTileSidePx"],
    "padding": "bottom-right-replicate-crop-back", "input": "gray-repeated-RGB-minus1-plus1",
    "directionsPerField": 2, "maxTraceRows": window.POLICY["maxTracks"],
    "fallback": "none; CPU must be explicitly selected",
})


def _padded_shape(shape):
    """No upscaling or coordinate change, including for tiny true ROIs."""
    if len(shape) != 2 or min(shape) < 1 or max(shape) > POLICY["maxInputSide"]:
        raise ValueError("Learned field requires a nonempty bounded 2-D ROI")
    multiple = POLICY["inputMultiple"]
    return tuple(max(POLICY["minInputSide"], ((n+multiple-1)//multiple)*multiple) for n in shape)


class TorchvisionRaftSmall:
    """Offline-only official pretrained RAFT; no downloads or device retry.

    Load once and reuse sequentially across candidate lanes. Concurrent calls
    need separate models because RAFT retains its latest correlation pyramid.
    """

    def __init__(self, weights_path, *, device="mps", expected_sha256=None):
        if device not in ("mps", "cpu"):
            raise ValueError("device must be explicitly mps or cpu")
        path = Path(weights_path).resolve(strict=True)
        digest = sha256(path.read_bytes()).hexdigest()
        if (digest != POLICY["weightSha256"]
                or expected_sha256 is not None and digest != expected_sha256):
            raise ValueError("Not the pinned official C_T_V2 weight bytes")
        # Lazy imports keep all non-learned baselines usable without PyTorch.
        import torch
        import torchvision
        from torchvision.models.optical_flow import Raft_Small_Weights, raft_small

        if device == "mps":
            if not torch.backends.mps.is_available():
                raise RuntimeError("MPS unavailable; select CPU explicitly in a declared trial")
            if os.environ.get("PYTORCH_ENABLE_MPS_FALLBACK") == "1":
                raise RuntimeError("Implicit MPS CPU fallback must be disabled")
        weights = Raft_Small_Weights.C_T_V2
        if weights.url != POLICY["weightUrl"]:
            raise RuntimeError("Installed torchvision differs from the pinned weights")
        self._torch = torch
        self._model = raft_small(weights=None, progress=False)
        state = torch.load(path, map_location="cpu", weights_only=True)
        self._model.load_state_dict(state, strict=True)
        self._model = self._model.to(device).eval()
        if device == "mps":
            torch.mps.synchronize()
        self._device = device
        self._transform = weights.transforms()
        self.direction_calls = 0
        self.last_call = {}
        self.metadata = {"kind": "actual-local-pretrained-torchvision",
                         "algorithm": POLICY["algorithm"], "weights": POLICY["weights"],
                         "weightUrl": weights.url, "weightsSha256": digest,
                         "weightBytes": path.stat().st_size, "torch": torch.__version__,
                         "torchvision": torchvision.__version__, "device": device,
                         "policy": dict(POLICY)}

    def __call__(self, p, q):
        if (not isinstance(p, np.ndarray) or not isinstance(q, np.ndarray)
                or p.dtype != np.uint8 or q.dtype != np.uint8
                or p.ndim != 2 or p.shape != q.shape):
            raise ValueError("RAFT inputs must be equal-shaped uint8 grayscale ROIs")
        height, width = p.shape
        padded = _padded_shape(p.shape)
        torch = self._torch
        started = perf_counter()
        before = self.direction_calls
        self.last_call = {"roiShape": [height, width], "paddedShape": list(padded),
                          "device": self._device, "modelDirectionCalls": 0,
                          "status": "started"}
        try:
            tensors = []
            for pixels in (p, q):
                padded_pixels = np.pad(pixels, ((0, padded[0]-height), (0, padded[1]-width)), mode="edge")
                rgb = np.repeat(padded_pixels[None, :, :], 3, axis=0)
                tensors.append(torch.from_numpy(rgb.copy()).unsqueeze(0))
            first, second = self._transform(*tensors)
            first, second = first.to(self._device), second.to(self._device)
            fields = []
            with torch.inference_mode():
                for a, b in ((first, second), (second, first)):
                    self.direction_calls += 1
                    predictions = self._model(a, b, num_flow_updates=POLICY["flowUpdates"])
                    # CPU transfer synchronizes completion for honest timing.
                    # Crop before _sample: padding cannot become valid proof.
                    field = predictions[-1][0, :, :height, :width].permute(1, 2, 0).cpu().numpy().copy()
                    fields.append(np.ascontiguousarray(field, dtype=np.float32))
            self.last_call["status"] = "model-returned"
            return tuple(fields)
        except Exception as error:
            self.last_call.update(status="runtime-error", error=f"{type(error).__name__}: {error}")
            raise
        finally:
            self.last_call.update(modelDirectionCalls=self.direction_calls-before,
                                  wallMs=1000.*(perf_counter()-started))


class LearnedCohortWindowLoom(CohortWindowLoom):
    """M3H with only its disposable field supplier replaced."""

    def __init__(self, flow_provider, *, native_detail=True):
        if not callable(flow_provider):
            raise TypeError("An explicitly selected flow provider is required")
        super().__init__(native_detail=native_detail)
        self.flow_provider = flow_provider
        self._field_trace = deque(maxlen=POLICY["maxTraceRows"])

    def drain_trace(self):
        """Runner must drain each frame; trace stores no images/flow arrays."""
        records = list(self._field_trace)
        self._field_trace.clear()
        return records

    def _field(self, old, new, old_box, box, transform):
        started = perf_counter()
        before = getattr(self.flow_provider, "direction_calls", None)
        record = {"status": "invalid-object-crop", "modelDirectionCalls": 0}
        try:
            tile = window._tile(old, new, old_box.xyxy, box.xyxy, transform)
            if tile is None:
                return None, record["status"]
            p, q, mapping = tile
            record.update(roiShape=list(p.shape), paddedShape=list(_padded_shape(p.shape)))
            fields = self.flow_provider(p, q)
            if (not isinstance(fields, (tuple, list)) or len(fields) != 2
                    or any(not isinstance(f, np.ndarray) or f.shape != (*p.shape, 2)
                           or f.dtype != np.float32 or not np.isfinite(f).all() for f in fields)):
                record["status"] = "invalid-learned-flow"
                return None, record["status"]
            record["status"] = "field-supported"
            return (p, q, mapping, *fields), record["status"]
        except Exception as error:
            record.update(status="runtime-error", error=f"{type(error).__name__}: {error}")
            # Unsupported execution must not become an apparently complete
            # empty trial. No automatic device or correspondence retry.
            raise
        finally:
            after = getattr(self.flow_provider, "direction_calls", None)
            record["modelDirectionCalls"] = after-before if type(before) is int and type(after) is int else None
            record["wallMs"] = 1000.*(perf_counter()-started)
            record["providerKind"] = getattr(self.flow_provider, "metadata", {}).get("kind", "injected-test-provider")
            self._field_trace.append(record)
