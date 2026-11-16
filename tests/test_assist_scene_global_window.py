"""Authored pixels with actual OpenCV DIS; not pretrained model acceptance."""

from copy import deepcopy
from hashlib import sha256
from pathlib import Path
import sys
from time import perf_counter
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/"scripts"))
import assist_scene_global_window as global_window
from assist_scene_motion import Detection


W, H = 320, 256
K = [[260., 0., W/2], [0., 260., H/2], [0., 0., 1.]]
CENTERS = ((110., 90.), (190., 90.), (110., 170.), (190., 170.))
RNG = np.random.default_rng(650513)
BACKGROUND = cv2.GaussianBlur(RNG.integers(30, 220, (H, W), np.uint8), (5, 5), .9)
TEXTURES = [cv2.GaussianBlur(RNG.integers(0, 256, (H, W), np.uint8), (3, 3), .6) for _ in CENTERS]


def exposure(index, *, growth=.014, count=4, box_growth=None, status=None, epoch=0):
    scale = float(np.exp(growth*index)); box_scale = scale if box_growth is None else float(np.exp(box_growth*index))
    pixels = BACKGROUND.copy(); boxes = []
    for (x, y), texture in zip(CENTERS[:count], TEXTURES[:count]):
        affine = np.array([[scale, 0., x*(1-scale)], [0., scale, y*(1-scale)]])
        mask = np.zeros((H, W), np.uint8)
        cv2.rectangle(mask, (round(x-26), round(y-30)), (round(x+26), round(y+30)), 255, -1)
        moved = cv2.warpAffine(texture, affine, (W, H), borderMode=cv2.BORDER_REFLECT101)
        visible = cv2.warpAffine(mask, affine, (W, H), flags=cv2.INTER_NEAREST) > 0
        pixels[visible] = moved[visible]
        boxes.append(Detection("car", .94, (x-26*box_scale, y-30*box_scale, x+26*box_scale, y+30*box_scale)))
    frame = {"token": f"g-{index}", "timestampUs": 3_000_000+80_000*index,
        "poseTimestampUs": 3_000_000+80_000*index, "epoch": epoch, "intrinsics": K,
        "cameraToWorld": np.eye(4).tolist(), "sha256": sha256(pixels.tobytes()).hexdigest()}
    tracks = [{"id": 100+index*12+j, **box.record(W, H)} for j, box in enumerate(boxes)]
    surface = {"status": status or ("first-frame" if index == 0 else "valid"), "epoch": epoch,
        "tracks": tracks, "events": [], "diagnostics": {"identityDecisions": {str(t["id"]): {"kept": False} for t in tracks}}}
    return frame, pixels, boxes, surface


class DisProvider:
    """Actual deterministic CPU correspondence only, never reported as RAFT."""
    def __init__(self):
        self.direction_calls = 0; self.last_call = {}
        self.metadata = {"kind": "actual-local-OpenCV-DIS-authored-control"}
        self.engine = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
        self.engine.setFinestScale(0)

    def __call__(self, first, second):
        started = perf_counter(); fields = []
        for a, b in ((first, second), (second, first)):
            self.direction_calls += 1; fields.append(self.engine.calc(a, b, None).astype(np.float32).copy())
        self.last_call = {"roiShape": list(first.shape), "processedShape": list(first.shape),
            "paddedShape": list(first.shape), "scaleXY": [1., 1.], "status": "model-returned",
            "modelDirectionCalls": 2, "wallMs": (perf_counter()-started)*1000., "device": "cpu-DIS-control"}
        return tuple(fields)


def update(state, index, **kwargs):
    frame, pixels, boxes, surface = exposure(index, **kwargs)
    result = state.update(frame, index*80., pixels, boxes, camera_surface=surface)
    row = {"token": frame["token"], "timeMs": index*80., "sourceSha256": frame["sha256"], "A": surface}
    global_window.validate_surface(result, row, [])
    return result


class GlobalWindowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cv2.setNumThreads(1)
        cls.provider = DisProvider(); state = global_window.GlobalWindowMotion(cls.provider)
        cls.expansion = [update(state, i) for i in range(6)]

    def test_actual_dis_four_object_expansion_with_replaced_ids(self):
        self.assertFalse(any(r["events"] for r in self.expansion[:4]))
        positives = [(i, event) for i, row in enumerate(self.expansion) for event in row["events"]]
        self.assertTrue(positives, [r["diagnostics"]["trackReasons"] for r in self.expansion])
        self.assertGreaterEqual(len({e["trackId"] % 12 for _, e in positives}), 3)
        for index, event in positives:
            proof = self.expansion[index]["diagnostics"]["windowEvidence"][str(event["trackId"])]
            self.assertEqual(proof["realExposureTokens"], ["g-0", f"g-{index-1}", f"g-{index}"])
            self.assertGreaterEqual(event["linearLogGrowthLowerBound"], .04)
            self.assertAlmostEqual(event["linearLogGrowth"], .014*index, delta=.025)
            self.assertNotIn("metres", event)
        certificates = [self.expansion[i]["diagnostics"]["windowEvidence"][str(e["trackId"])]["anchor"]["association"] for i, e in positives]
        self.assertTrue(any(len(a["eligibleAnchorIndices"]) >= 4
            and len(a["eligibleCompetitors"][str(a["anchorDetectionIndex"])]) >= 4 for a in certificates))

    def test_global_calls_and_cached_populations_do_not_scale_with_pair_matrix(self):
        row = self.expansion[4]
        self.assertEqual(row["diagnostics"]["cost"], {"globalPairs": 2, "globalDirectionCalls": 4, "candidateComparisons": 32})
        provider = DisProvider(); state = global_window.GlobalWindowMotion(provider)
        for i in range(4): update(state, i)
        before = provider.direction_calls
        with patch.object(global_window, "_population", wraps=global_window._population) as population:
            result = update(state, 4)
        self.assertTrue(result["events"])
        self.assertEqual(population.call_count, 16)
        self.assertEqual(provider.direction_calls-before, 4)

    def test_static_pixels_and_detector_only_scale_jitter_abstain(self):
        for jitter in (None, .014):
            state = global_window.GlobalWindowMotion(DisProvider())
            for i in range(6):
                self.assertFalse(update(state, i, growth=0., box_growth=jitter)["events"])

    def test_camera_veto_empty_detection_and_missing_token_clear_history(self):
        for case in ("veto", "empty", "token"):
            state = global_window.GlobalWindowMotion(DisProvider()); update(state, 0); update(state, 1)
            frame, pixels, boxes, surface = exposure(2)
            if case == "veto": surface["status"] = "scale-ambiguous"
            elif case == "empty": boxes = []; surface["tracks"] = []; surface["diagnostics"]["identityDecisions"] = {}
            else: frame.pop("token")
            out = state.update(frame, 160., pixels, boxes, camera_surface=surface)
            self.assertFalse(out["events"]); self.assertFalse(state._bank)
            if case == "token": self.assertEqual(out["status"], "unbound-source-exposure")

    def test_unknown_rival_is_not_discarded_or_replaced_by_conditional_support(self):
        old = SimpleNamespace(frame={"token": "old"}, at=0.)
        now = SimpleNamespace(frame={"token": "new"}, at=400.)
        pairs = [{"startDetectionIndex": i, "endDetectionIndex": 0, "scoreLower": lower,
                  "scoreUpper": upper, "supported": supported, "reason": "synthetic"}
                 for i, lower, upper, supported in ((0, .9, .95, True), (1, 0., 1., False))]
        answer = global_window.associate(pairs, 1, 2, old, now)[0]
        self.assertFalse(answer["supported"]); self.assertEqual(answer["eligibleAnchorIndices"], [0, 1])
        self.assertEqual(answer["runnerUpUpper"], 1.)

    def test_full_twelve_by_twelve_competition_has_no_three_rival_cap(self):
        old = SimpleNamespace(frame={"token": "old"}, at=0.)
        now = SimpleNamespace(frame={"token": "new"}, at=400.)
        pairs = [{"startDetectionIndex": i, "endDetectionIndex": j, "scoreLower": .95 if i == j else 0.,
                  "scoreUpper": .98 if i == j else .05, "supported": i == j, "reason": "synthetic"}
                 for j in range(12) for i in range(12)]
        answers = global_window.associate(pairs, 12, 12, old, now)
        self.assertEqual(sum(a["supported"] for a in answers), 12)
        self.assertTrue(all(len(a["eligibleAnchorIndices"]) == 12 for a in answers))

    def test_original_denominator_and_two_way_affine_bounds_cannot_be_forged(self):
        pair = next(p for r in self.expansion for p in r["diagnostics"]["comparisons"] if p["supported"])
        global_window.validate_pair_proof(pair)
        for case in ("denominator", "support", "bound", "center"):
            with self.subTest(case=case):
                bad = deepcopy(pair)
                if case == "denominator": bad["forward"]["seedPoints"] = 9
                elif case == "support": bad["forward"]["points"] = 9
                elif case == "bound": bad["linearLogGrowthLowerBound"] += .01
                else: bad["forward"]["centerErrorPx"] = 10000.
                with self.assertRaises(ValueError): global_window.validate_pair_proof(bad)

    def test_invalid_provider_or_direction_count_fails_loud(self):
        provider = DisProvider(); state = global_window.GlobalWindowMotion(provider); update(state, 0)
        with patch.object(provider, "__call__", return_value=(np.zeros((2, 2, 2), np.float32),)*2):
            # Special method lookup uses the provider type, covered explicitly below.
            pass
        class Broken:
            direction_calls = 0
            def __call__(self, a, b): return (np.zeros((*a.shape, 2), np.float32),)*2
        state = global_window.GlobalWindowMotion(Broken()); update(state, 0)
        with self.assertRaises(ValueError): update(state, 1)

    def test_final_refined_affine_residual_is_rechecked_not_only_ransac_mask(self):
        box = Detection("car", .9, (10., 10., 110., 110.))
        a = global_window._seeds(box)
        b = a+np.random.default_rng(650901).normal(0, .65, a.shape).astype(np.float32)
        cv2.setRNGSeed(650901)
        proof = global_window._direction((a, b, np.zeros(64), np.ones(64, bool)), box, box, np.eye(3))
        self.assertTrue(proof["supported"])
        self.assertLessEqual(proof["maxSupportedFitResidualPx"], 1.2)


if __name__ == "__main__": unittest.main()
