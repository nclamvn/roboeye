"""Behaviour checks for Court's classical candidate baseline, not accuracy QA."""

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import cv2
import numpy as np


SPEC = importlib.util.spec_from_file_location("court_analyze", Path(__file__).resolve().parents[1] / "scripts/court_analyze.py")
court = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(court)


class CourtImageChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        (Path(__file__).resolve().parents[1] / ".court-cache").mkdir(exist_ok=True)

    def canvas(self):
        return np.full((240, 400, 3), 30, np.uint8)

    def ball(self, frame, xy):
        cv2.circle(frame, xy, 4, (0, 245, 245), -1)
        return frame

    def test_first_frame_has_no_fabricated_observation(self):
        result = court.observe_frame(self.ball(self.canvas(), (100, 120)), None, 0, 25)
        self.assertEqual(result["status"], "missing")
        self.assertIsNone(result["ball"])

    def test_static_colour_and_white_lights_are_not_motion(self):
        frame = self.ball(self.canvas(), (100, 120))
        cv2.circle(frame, (200, 60), 5, (255, 255, 255), -1)
        result = court.observe_frame(frame, frame.copy(), 1, 25)
        self.assertEqual(result["candidates"], [])
        self.assertIsNone(result["ball"])

    def test_small_moving_ball_is_observed_in_current_pixels(self):
        previous = self.ball(self.canvas(), (90, 120))
        current = self.ball(self.canvas(), (105, 118))
        result = court.observe_frame(current, previous, 1, 25)
        self.assertEqual(result["status"], "observed")
        self.assertAlmostEqual(result["ball"]["x"], 105, delta=0.1)
        self.assertAlmostEqual(result["timeSeconds"], 0.04)

    def test_similar_candidates_are_ambiguous_not_forced(self):
        current = self.ball(self.ball(self.canvas(), (105, 118)), (250, 150))
        result = court.observe_frame(current, self.canvas(), 1, 25)
        self.assertEqual(result["status"], "ambiguous")
        self.assertIsNone(result["ball"])
        self.assertEqual(len(result["candidates"]), 2)

    def test_occlusion_does_not_hold_or_predict_old_ball(self):
        result = court.observe_frame(self.canvas(), self.canvas(), 5, 25,
                                     {"x": 100, "y": 120, "radius": 4})
        self.assertEqual(result["status"], "missing")
        self.assertIsNone(result["ball"])

    def test_large_coloured_clothing_rejected(self):
        current = self.canvas()
        cv2.rectangle(current, (100, 100), (140, 150), (0, 245, 245), -1)
        self.assertEqual(court.image_candidates(current, self.canvas()), [])

    def test_fragmented_garment_not_many_small_false_balls(self):
        current = self.canvas()
        for y in range(85, 126, 6):
            for x in range(180, 211, 6):
                cv2.rectangle(current, (x, y), (x + 3, y + 3), (0, 245, 245), -1)
        self.assertEqual(court.image_candidates(current, self.canvas()), [])

    def test_two_pixel_compression_speck_cannot_outrank_ball(self):
        current = self.ball(self.canvas(), (100, 150))
        current[75, 200:202] = (0, 245, 245)
        result = court.observe_frame(current, self.canvas(), 1, 25)
        self.assertEqual(result["status"], "observed")
        self.assertAlmostEqual(result["ball"]["x"], 100, delta=0.1)
        self.assertEqual(len(result["candidates"]), 1)

    def test_ball_near_player_separated_by_visible_gap_survives(self):
        current = self.canvas()
        cv2.rectangle(current, (160, 80), (190, 145), (0, 245, 245), -1)
        self.ball(current, (203, 130))
        result = court.observe_frame(current, self.canvas(), 1, 25)
        self.assertEqual(result["status"], "observed")
        self.assertAlmostEqual(result["ball"]["x"], 203, delta=0.1)

    def test_true_bright_blur_component_remains_candidate(self):
        current = self.canvas()
        # A thin blur inside the unchanged max-area baseline budget.
        cv2.ellipse(current, (120, 150), (7, 1), 20, 0, 360, (0, 245, 245), -1)
        result = court.observe_frame(current, self.canvas(), 1, 25)
        self.assertEqual(result["status"], "observed")
        self.assertAlmostEqual(result["ball"]["x"], 120, delta=1)

    def test_static_bulb_with_tiny_colour_compression_change_is_refused(self):
        previous = self.canvas()
        cv2.circle(previous, (250, 80), 6, (245, 245, 245), -1)
        current = previous.copy()
        current[80, 250:252] = (0, 245, 245)
        result = court.observe_frame(current, previous, 1, 25)
        self.assertIsNone(result["ball"])

    def test_shape_change_does_not_inherit_coordinates(self):
        result = court.observe_frame(self.canvas(), np.zeros((200, 400, 3), np.uint8), 5, 25)
        self.assertIsNone(result["ball"])

    def test_hough_suggestions_are_always_unconfirmed(self):
        frame = self.canvas()
        cv2.line(frame, (40, 200), (340, 90), (255, 255, 255), 4)
        lines = court.suggest_image_lines(frame)
        self.assertTrue(lines)
        self.assertTrue(all(line["provenance"] == "image-hough" and line["confirmed"] is False for line in lines))
        self.assertLessEqual(len(lines), 14)

    def test_empty_or_invalid_file_fails(self):
        with tempfile.TemporaryDirectory(prefix="court-unit-", dir=Path(__file__).resolve().parents[1] / ".court-cache") as directory:
            with self.assertRaises(court.CourtAnalysisError):
                court.analyze_video(Path(directory) / "missing.mp4")

    def test_size_limit_checked_before_decode(self):
        with patch.object(Path, "is_file", return_value=True), patch.object(Path, "stat") as stat:
            stat.return_value.st_size = court.MAX_BYTES + 1
            with self.assertRaisesRegex(court.CourtAnalysisError, "500 MiB"):
                court.analyze_video("/not-opened.mp4")

    def test_real_synthetic_decode_has_nulls_and_source_binding(self):
        cache = Path(__file__).resolve().parents[1] / ".court-cache"
        cache.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="court-unit-", dir=cache) as directory:
            path = Path(directory) / "synthetic.avi"
            writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"MJPG"), 25, (400, 240))
            self.assertTrue(writer.isOpened())
            for index in range(10):
                frame = self.canvas()
                if index not in (5, 6):
                    self.ball(frame, (70 + index * 12, 150))
                writer.write(frame)
            writer.release()
            session = court.analyze_video(path)
            self.assertEqual(session["schemaVersion"], court.SCHEMA)
            self.assertEqual(session["source"]["sha256"], court.source_sha256(path))
            self.assertEqual(session["source"]["frameCount"], 10)
            self.assertEqual(session["decision"]["status"], "insufficient-evidence")
            self.assertIsNone(session["frames"][5]["ball"])
            self.assertIsNone(session["frames"][6]["ball"])
            self.assertEqual(sum(session["summary"][key] for key in ("observedFrames", "ambiguousFrames", "missingFrames")), 10)
            output = Path(directory) / "session.json"
            court.write_session(session, output)
            restored = json.loads(output.read_text())
            self.assertEqual(restored, session)
            self.assertEqual(list(Path(directory).glob(".court-session-*")), [])


if __name__ == "__main__":
    (Path(__file__).resolve().parents[1] / ".court-cache").mkdir(exist_ok=True)
    unittest.main()
