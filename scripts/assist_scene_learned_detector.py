#!/usr/bin/env python3
"""Stateless, local-only RT-DETRv2 adapter for Mac offline experiments.

Inputs are already EXIF-upright BGR pixels from the current source exposure.
The model sees the native image through its pinned upstream 640-square resize;
output boxes are mapped to the existing working image. No labels, temporal
history, identities, metric range, downloads or implicit device fallback.
"""

import hashlib
import math
import os
from pathlib import Path
from time import perf_counter

import cv2
import numpy as np

from assist_scene_motion import Detection


MODEL_ID = "PekingU/rtdetr_v2_r18vd"
REVISION = "5650961749fa93567c0d46fc7f43ea4f9e914107"
ARTIFACTS = {
    "config.json": (5437, "ed051ec77cb41c5d9d5e3af21a979b1e890599dfd68434d7636ff82ded4c1527"),
    "preprocessor_config.json": (444, "cd38cd59999e7a95d68e487fbe5132df3d4e5c32a0836add57e6126ba0c4eaf1"),
    "model.safetensors": (80904640, "d18309d0d7ea57048138885c4c6ecfcb1e24506fc6153b94ad484f8ab62c7115"),
}
POLICY = {
    "confidenceThreshold": .38, "maxDetections": 12,
    "duplicateRule": "score-desc,label,xyxy,index; same canonical label suppress IoU > 0.65",
    "duplicateIouThreshold": .65, "modelInput": [640, 640],
    "preprocessing": "pinned upstream bilinear anisotropic resize; BGR to RGB; rescale 1/255",
    "coordinates": "EXIF-upright top-left source xyxy, linearly mapped to working pixels",
    "maxNativeSide": 4096, "maxNativePixels": 12_000_000, "maxWorkingSide": 768,
}
ALIASES = {"motorbike": "motorcycle", "aeroplane": "airplane", "sofa": "couch",
           "pottedplant": "potted plant", "diningtable": "dining table", "tvmonitor": "tv"}
COCO_LABELS = (
    "person", "bicycle", "car", "motorbike", "aeroplane", "bus", "train", "truck", "boat",
    "traffic light", "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat", "dog",
    "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella",
    "handbag", "tie", "suitcase", "frisbee", "skis", "snowboard", "sports ball", "kite",
    "baseball bat", "baseball glove", "skateboard", "surfboard", "tennis racket", "bottle",
    "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple", "sandwich",
    "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "sofa",
    "pottedplant", "bed", "diningtable", "toilet", "tvmonitor", "laptop", "mouse", "remote",
    "keyboard", "cell phone", "microwave", "oven", "toaster", "sink", "refrigerator", "book",
    "clock", "vase", "scissors", "teddy bear", "hair drier", "toothbrush")
ID2LABEL = {str(index): label for index, label in enumerate(COCO_LABELS)}


def _shape(shape, *, native):
    if (not isinstance(shape, (tuple, list)) or len(shape) != 2
            or any(type(n) is not int or n < 2 for n in shape)):
        raise ValueError("Expected integer height, width")
    h, w = shape
    if max(h, w) > (POLICY["maxNativeSide"] if native else POLICY["maxWorkingSide"]):
        raise ValueError("Image side exceeds detector budget")
    if native and h*w > POLICY["maxNativePixels"]:
        raise ValueError("Native image exceeds detector pixel budget")
    return h, w


def working_shape_for(native_shape):
    h, w = _shape(native_shape, native=True)
    scale = min(1., POLICY["maxWorkingSide"]/max(h, w))
    return round(h*scale), round(w*scale)


def _iou(a, b):
    overlap = max(0., min(a[2], b[2])-max(a[0], b[0])) * max(0., min(a[3], b[3])-max(a[1], b[1]))
    union = (a[2]-a[0])*(a[3]-a[1]) + (b[2]-b[0])*(b[3]-b[1])-overlap
    return overlap/union if union else 0.


def parse_predictions(prediction, id2label, native_shape, target_shape):
    """Pure deterministic parser; prediction boxes are source-pixel xyxy.

    Reject nonfinite/out-of-domain scores and invalid boxes, clip small model
    overhang to source bounds, then deduplicate before the shared 12-box cap.
    Ties do not depend on a GPU's top-k tie order except identical records.
    """
    nh, nw = _shape(native_shape, native=True)
    h, w = _shape(target_shape, native=False)
    if (h, w) != working_shape_for((nh, nw)):
        raise ValueError("Working geometry differs from the declared source resize")
    scores, labels, boxes = (prediction[key] for key in ("scores", "labels", "boxes"))
    if not (len(scores) == len(labels) == len(boxes)) or len(scores) > 300:
        raise ValueError("Malformed or over-budget detector predictions")
    candidates = []
    invalid = 0
    below = 0
    for index, (score, label_id, bounds) in enumerate(zip(scores, labels, boxes, strict=True)):
        if (type(score) not in (int, float) or not math.isfinite(score) or not 0 <= score <= 1
                or type(label_id) is not int or len(bounds) != 4
                or any(type(n) not in (int, float) or not math.isfinite(n) for n in bounds)):
            invalid += 1
            continue
        label = id2label.get(label_id, id2label.get(str(label_id)))
        if not isinstance(label, str) or not label:
            invalid += 1
            continue
        if score < POLICY["confidenceThreshold"]:
            below += 1
            continue
        a, b, c, d = bounds
        a, c = max(0., min(nw, a)), max(0., min(nw, c))
        b, d = max(0., min(nh, b)), max(0., min(nh, d))
        if c <= a or d <= b:
            invalid += 1
            continue
        label = ALIASES.get(label, label)
        box = (a*w/nw, b*h/nh, c*w/nw, d*h/nh)
        candidates.append((float(score), label, box, index))
    candidates.sort(key=lambda item: (-item[0], item[1], item[2], item[3]))
    kept = []
    duplicates = 0
    capped = 0
    for score, label, box, _ in candidates:
        if any(old.label == label and _iou(old.xyxy, box) > POLICY["duplicateIouThreshold"] for old in kept):
            duplicates += 1
        elif len(kept) >= POLICY["maxDetections"]:
            capped += 1
        else:
            kept.append(Detection(label, score, box))
    return kept, {"rawCandidates": len(scores), "invalidRejected": invalid,
                  "belowThreshold": below, "duplicatesSuppressed": duplicates,
                  "overCap": capped, "detections": len(kept)}


def verify_artifacts(model_dir):
    """Only the exact reviewed upstream checkpoint is accepted, never pickle."""
    root = Path(model_dir).resolve(strict=True)
    if not root.is_dir():
        raise ValueError("Expected local checkpoint directory")
    hashes = {}
    for name, (size, expected) in ARTIFACTS.items():
        path = root/name
        if not path.is_file() or path.stat().st_size != size:
            raise ValueError(f"Missing or wrong-sized pinned detector artifact: {name}")
        with path.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        if digest != expected:
            raise ValueError(f"Detector artifact digest mismatch: {name}")
        hashes[name] = digest
    return root, hashes


class LearnedDetector:
    """One explicitly selected device, no tracking state or hidden fallback."""

    def __init__(self, model_dir, *, device="mps"):
        start = perf_counter()
        root, self.model_hashes = verify_artifacts(model_dir)
        if device not in ("mps", "cpu"):
            raise ValueError("Explicit Mac MPS or diagnostic CPU execution only")
        if device == "mps" and os.environ.get("PYTORCH_ENABLE_MPS_FALLBACK") == "1":
            raise ValueError("Disable implicit MPS CPU fallback for attributable timings")
        import torch
        import transformers
        from transformers import RTDetrImageProcessor, RTDetrV2ForObjectDetection

        if device == "mps" and not torch.backends.mps.is_available():
            raise RuntimeError("MPS unavailable; no automatic CPU substitution")
        self.torch = torch
        self.device = device
        self.processor = RTDetrImageProcessor.from_pretrained(str(root), local_files_only=True)
        self.model = RTDetrV2ForObjectDetection.from_pretrained(
            str(root), local_files_only=True, use_safetensors=True,
            dtype=torch.float32, disable_custom_kernels=True).to(device).eval()
        if {str(key): value for key, value in self.model.config.id2label.items()} != ID2LABEL:
            raise ValueError("Checkpoint class mapping differs from pinned COCO mapping")
        self.versions = {"torch": torch.__version__, "transformers": transformers.__version__,
                         "opencv": cv2.__version__, "numpy": np.__version__}
        self._sync()
        self.load_ms = round((perf_counter()-start)*1000, 3)

    def _sync(self):
        if self.device == "mps":
            self.torch.mps.synchronize()

    def provenance(self):
        return {"modelId": MODEL_ID, "revision": REVISION, "artifactSha256": dict(self.model_hashes),
                "license": "Apache-2.0", "device": self.device, "dtype": "float32",
                "cpuFallback": False, "execution": "actual-local-PyTorch",
                "versions": dict(self.versions), "policy": dict(POLICY), "modelLoadMs": self.load_ms}

    def detect(self, image, working_shape=None):
        """Return existing Detection objects in the current working geometry."""
        if (not isinstance(image, np.ndarray) or image.dtype != np.uint8
                or image.ndim != 3 or image.shape[2] != 3):
            raise ValueError("Expected current upright uint8 BGR source image")
        native_shape = tuple(image.shape[:2])
        _shape(native_shape, native=True)
        target_shape = working_shape_for(native_shape) if working_shape is None else tuple(working_shape)
        if target_shape != working_shape_for(native_shape):
            raise ValueError("Working geometry differs from source resize")
        self._sync()
        started = perf_counter()
        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        inputs = self.processor(images=rgb, return_tensors="pt")
        inputs = {key: value.to(self.device) for key, value in inputs.items()}
        self._sync()
        preprocessed = perf_counter()
        with self.torch.inference_mode():
            outputs = self.model(**inputs)
        self._sync()
        inferred = perf_counter()
        sizes = self.torch.tensor([native_shape], device=self.device)
        result = self.processor.post_process_object_detection(
            outputs, threshold=0., target_sizes=sizes)[0]
        prediction = {name: result[name].detach().cpu().tolist() for name in ("scores", "labels", "boxes")}
        detections, counts = parse_predictions(prediction, self.model.config.id2label, native_shape, target_shape)
        self._sync()
        ended = perf_counter()
        timing = {"preprocessMs": round((preprocessed-started)*1000, 3),
                  "inferenceMs": round((inferred-preprocessed)*1000, 3),
                  "postprocessMs": round((ended-inferred)*1000, 3),
                  "wallMs": round((ended-started)*1000, 3)}
        return detections, {"method": "rtdetr-v2-r18vd", "device": self.device,
                            "nativeShape": list(native_shape), "workingShape": list(target_shape),
                            "timing": timing, "prediction": prediction,
                            "id2label": dict(ID2LABEL), **counts}
