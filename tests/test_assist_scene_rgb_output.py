"""Verify final Mac clip presentation does not consume VLM or naive events."""

import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from assist_scene_evidence import Reason, assess_motion, assess_range
from assist_scene_rgb_output import render_rgb_frame


class RGBOutputTests(unittest.TestCase):
    def setUp(self):
        self.track = {"id": 2, "label": "person"}
        self.event = {"trackId": 2, "epoch": 7, "timeMs": 800, "label": "person"}

    def render(self, tracks=None, events=None, valid=True, epoch=7, time=800):
        return render_rgb_frame(time_ms=time, epoch=epoch, registration_valid=valid,
                                tracks=[self.track] if tracks is None else tracks,
                                compensated_events=[self.event] if events is None else events)

    def test_approved_event_has_no_distance_and_only_frame_relative_motion(self):
        result = self.render()
        self.assertIsNone(result["distance"]["metres"])
        self.assertEqual(result["distance"]["textVi"], "Chưa đo được khoảng cách.")
        self.assertEqual(result["motion"]["status"], "observed-frame-change")
        self.assertIn("so với nền đã căn chỉnh", result["motion"]["textVi"])
        self.assertIn("chưa xác định", result["motion"]["textVi"])

    def test_motion_claim_refused_on_cut_or_ambiguous_or_unsynced_track(self):
        failures = [
            {"events": []}, {"tracks": []}, {"valid": False}, {"epoch": 6},
            {"time": 801}, {"time": 799}, {"tracks": [self.track, self.track]},
            {"events": [self.event, self.event]}, {"tracks": [{"id": 2, "label": "bus"}]},
        ]
        for changes in failures:
            with self.subTest(changes=changes):
                result = self.render(**changes)
                self.assertEqual(result["motion"]["status"], "unknown")
                self.assertEqual(result["motion"]["trackNotices"], [])

    def test_qwen_m2b_actual_raw_outputs_cannot_be_admitted_as_evidence(self):
        data = json.loads((ROOT / "docs/evidence/tip65/m2b-qwen-mac-pilot.json").read_text())
        baits = [row for row in data["runs"] if row["mode"] in ("A", "B")]
        self.assertEqual(len(baits), 24)
        self.assertTrue(any("20 mét" in r["answer"] for r in baits))
        for run in baits:
            for raw in (run["answer"], run):
                with self.subTest(case=run["case"], mode=run["mode"], kind=type(raw)):
                    self.assertEqual(assess_range(None, raw).reason, Reason.UNTRUSTED_EVIDENCE)
                    self.assertEqual(assess_motion(None, raw).reason, Reason.UNTRUSTED_EVIDENCE)
        with self.assertRaises(TypeError):
            render_rgb_frame(time_ms=0, epoch=0, registration_valid=False,
                             tracks=[], compensated_events=[], vlm_reply=baits[0]["answer"])


if __name__ == "__main__":
    unittest.main()
