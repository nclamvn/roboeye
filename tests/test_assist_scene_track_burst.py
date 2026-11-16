"""Deterministic synthetic burst controls; no YOLO or real-world motion truth."""

from pathlib import Path
import sys
import unittest

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from assist_scene_motion import Detection
from assist_scene_track_burst import BurstTracker


W, H = 480, 300
PAN = np.array([[1., 0., 9.], [0., 1., -1.]])
IDENTITY = np.array([[1., 0., 0.], [0., 1., 0.]])


def texture(seed, shape):
    noise = np.random.default_rng(seed).integers(0, 255, size=shape, dtype=np.uint8)
    return cv2.GaussianBlur(noise, (3, 3), 0)


BG = texture(913, (H, W))
ACTOR = texture(471, (78, 94))


def scene(index, *, motion=-4, pan=9, label="bus", score=.92, detector_adjust=0):
    image = cv2.warpAffine(BG, np.array([[1., 0., pan*index], [0., 1., -index]]), (W, H))
    x, y = 164+(pan+motion)*index, 112-index
    image[y:y+78, x:x+94] = ACTOR
    result = Detection(label, score, (x+detector_adjust, y, x+94+detector_adjust, y+78))
    return image, result


def push(tracker, index, *, matrix=PAN, acquisition=None, **options):
    gray, detection = scene(index, **options)
    if acquisition is None:
        acquisition = index % 5 == 0
    return tracker.update(gray, None if index == 0 else matrix, index*40,
                          [detection] if acquisition else None)


class BurstTrackTests(unittest.TestCase):
    def test_real_pixels_not_box_center_vote_across_intermediate_frames(self):
        tracker = BurstTracker()
        for i in range(11):
            tracks, result = push(tracker, i)
            self.assertTrue(tracks)
            self.assertEqual(tracks[0]["id"], 1)
            if i != 10:
                self.assertFalse(result)
        claim = result[0]
        self.assertEqual(claim["direction"], "image-left")  # Raw image motion was right.
        self.assertAlmostEqual(claim["netPixels"], 40, delta=2)
        self.assertEqual(claim["timeMs"], 400)
        self.assertEqual(claim["epoch"], tracker.epoch)
        self.assertEqual(claim["localEvidence"]["confirmedDetections"], 3)
        self.assertGreaterEqual(claim["localEvidence"]["minSupportingPoints"], 7)

    def test_frozen_camera_pan_and_bounding_box_jitter_without_motion_claim(self):
        tracker = BurstTracker()
        for i in range(16):
            _, claimed = push(tracker, i, motion=0, detector_adjust=(i//5)*7)
            self.assertFalse(claimed)

    def test_detection_miss_disposes_prior_and_no_stale_republish(self):
        tracker = BurstTracker()
        for i in range(11):
            _, first = push(tracker, i)
        self.assertTrue(first)
        gray, _ = scene(11)
        self.assertEqual(tracker.update(gray, PAN, 440, []), ([], []))
        self.assertEqual(push(tracker, 12), ([], []))
        tracks, next_claim = push(tracker, 13, acquisition=True)
        self.assertGreater(tracks[0]["id"], 1)
        self.assertFalse(next_claim)

    def test_actual_occlusion_suppresses_feature_track_without_yolo_refresh(self):
        tracker = BurstTracker()
        for i in range(11):
            _, first = push(tracker, i)
        self.assertTrue(first)
        covered, detector_false_positive = scene(11)
        a, b, c, d = detector_false_positive.xyxy
        covered[b:d, a:c] = 127
        self.assertEqual(tracker.update(covered, PAN, 440), ([], []))
        tracks, next_claim = push(tracker, 12, acquisition=True)
        self.assertGreater(tracks[0]["id"], 1)
        self.assertFalse(next_claim)

    def test_reset_gap_clear_and_detector_timeout(self):
        for kind in ("reset", "cut", "gap", "timeout"):
            with self.subTest(kind=kind):
                tracker = BurstTracker()
                for i in range(8):
                    push(tracker, i)
                epoch = tracker.epoch
                gray, found = scene(8)
                if kind == "reset":
                    tracker.reset()
                elif kind == "timeout":
                    for i in range(8, 14):
                        push(tracker, i, acquisition=False)
                    self.assertFalse(tracker.predicted_boxes())
                    continue
                matrix = None if kind == "cut" else PAN
                time = 360 if kind == "gap" else 320
                tracks, proposals = tracker.update(gray, matrix, time, [found])
                self.assertGreater(tracker.epoch, epoch)
                self.assertGreater(tracks[0]["id"], 1)
                self.assertFalse(proposals)

    def test_bus_truck_flicker_requires_reliable_bus_anchor_and_neutral_label(self):
        for support, want in ((.91, True), (.55, False)):
            with self.subTest(support=support):
                tracker = BurstTracker()
                for i in range(11):
                    tracks, proposals = push(tracker, i, label="bus" if i<10 else "truck", score=support)
                self.assertEqual(bool(proposals), want)
                if want:
                    self.assertEqual(tracks[0]["id"], 1)
                    self.assertEqual(proposals[0]["label"], "vehicle")
                    self.assertEqual(proposals[0]["localEvidence"]["detectorLabel"], "truck")
                else:
                    self.assertNotEqual(tracks[0]["id"], 1)

    def test_two_detector_boxes_covering_trajectory_are_ambiguous(self):
        tracker = BurstTracker()
        for i in range(10):
            push(tracker, i)
        gray, found = scene(10)
        x, y, r, b = found.xyxy
        overlapping = Detection("bus", .89, (x+4, y+3, r+9, b+2))
        tracks, proposals = tracker.update(gray, PAN, 400, [found, overlapping])
        self.assertFalse(proposals)
        self.assertFalse(any(row["id"] == 1 for row in tracks))


if __name__ == "__main__":
    unittest.main()
