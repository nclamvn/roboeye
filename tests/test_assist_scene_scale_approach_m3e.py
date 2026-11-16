"""M3E authored pixel fixtures exercise geometry and safety, not field quality."""

from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/"scripts"))
from assist_scene_motion import Detection
from assist_scene_scale_approach import ScaleApproach
from assist_scene_scale_approach_m3e import ScaleApproachM3E, _native_transform, _projected_tile
from test_assist_scene_scale_approach import BG, H, W, frame, run, scene, texture, warp


NATIVE_BG = texture(818310, (H*2, W*2))
NATIVE_OBJECT = texture(818311, (90, 104))


def pixel_scene(s=1., *, obj=NATIVE_OBJECT, center=(W, H), diameter=(32, 37), bg=NATIVE_BG):
    w, h = map(lambda v: round(v*s), diameter)
    x, y = center
    x0, y0 = x-w//2, y-h//2
    img = bg.copy()
    img[y0:y0+h, x0:x0+w] = cv2.resize(obj, (w, h), interpolation=cv2.INTER_LINEAR)
    working = cv2.resize(img, (W, H), interpolation=cv2.INTER_AREA)
    box = Detection("car", .94, (x0/2, y0/2, (x0+w)/2, (y0+h)/2))
    return img, working, box


class M3EDetailRelinkTests(unittest.TestCase):
    def setUp(self):
        cv2.setNumThreads(1)
        cv2.setRNGSeed(6505)

    def test_native_tile_maps_coordinates_and_has_verbatim_source_samples(self):
        native, work, b = pixel_scene()
        n2, _, b2 = pixel_scene(1.06)
        tr = _native_transform(native, work.shape)
        pan = np.array([[1., 0., 2.], [0., 1., 3.], [0., 0., 1.]])
        old, new, a, c, hom, inverse = _projected_tile(native, n2, tr, b.xyxy, b2.xyxy, pan)
        origin = (np.linalg.inv(tr) @ np.array([.0, .0, 1.]))[:2]
        self.assertTrue(np.allclose(hom[:2, 2], [4, 6]))
        self.assertTrue(np.allclose((inverse @ np.r_[a[:2],1])[:2], b.xyxy[:2]))
        self.assertTrue(np.allclose((inverse @ np.r_[c[:2],1])[:2], b2.xyxy[:2]))
        x, y = (tr @ inverse @ np.r_[origin,1])[:2].astype(int)
        self.assertTrue(np.array_equal(old, native[y:y+old.shape[0], x:x+old.shape[1]]))
        self.assertTrue(np.array_equal(new, n2[y:y+old.shape[0], x:x+old.shape[1]]))
        self.assertIsNone(_native_transform(work, work.shape))
        self.assertIsNone(_native_transform(native[:, 25:], work.shape))

    def test_small_approach_gain_requires_native_pixels(self):
        a = ScaleApproach()
        b = ScaleApproachM3E(relink=False)
        without_source = ScaleApproachM3E(relink=False)
        results = []
        for i in range(7):
            raw, working, box = pixel_scene(1.045**i)
            self.assertFalse(a.update(frame(i), 100*i, working, [box])["events"])
            self.assertFalse(without_source.update(frame(i), 100*i, working, [box])["events"])
            results.append(b.update(frame(i), 100*i, working, [box], native_gray=raw))
        self.assertTrue(any(v["events"] for v in results), [(v['status'], v['diagnostics'].get('trackReasons')) for v in results])
        self.assertGreater(sum(x["diagnostics"]["detailEvidencePairs"] for x in results), 2)
        self.assertTrue(all(e['kind'] == 'relative-optical-approach' and 'metres' not in e
                            for result in results for e in result['events']))

    def test_negative_small_static_zoom_and_detector_jitter(self):
        for kind in ('static', 'global-zoom', 'detection-jitter'):
            state = ScaleApproachM3E()
            for i in range(7):
                raw, working, box = pixel_scene()
                if kind != 'static':
                    s = 1.045**i
                    if kind == 'global-zoom':
                        raw = warp(raw, s, (W,H)) if raw.shape == (H,W) else cv2.warpAffine(
                            raw, cv2.getRotationMatrix2D((W,H), 0., s), (W*2, H*2), borderMode=cv2.BORDER_REFLECT101)
                        working = cv2.resize(raw, (W, H), interpolation=cv2.INTER_AREA)
                    box = Detection(box.label, box.score, tuple((v-c)*s+c for v,c in zip(box.xyxy,(W/2,H/2,W/2,H/2))))
                result = state.update(frame(i), 100*i, working, [box], native_gray=raw)
                self.assertFalse(result['events'], (kind, i, result))

    def test_one_detection_gap_keeps_id_but_discards_all_votes(self):
        state = ScaleApproachM3E(detail=False)
        for i in range(4):
            result = run(state, i, scale=1.04**i)
        original = result['tracks'][0]['id']
        self.assertTrue(result["events"])
        miss = run(state, 4, scale=1.04**4, boxes=[])
        self.assertFalse(miss['tracks'])
        self.assertFalse(miss['events'])
        resumed = run(state, 5, scale=1.04**5)
        self.assertEqual(resumed['tracks'][0]['id'], original, resumed)
        self.assertEqual(resumed['diagnostics']['relinkedTracks'], 1)
        self.assertFalse(resumed['events'])
        self.assertFalse(run(state, 6, scale=1.04**6)['events'])
        self.assertFalse(run(state, 7, scale=1.04**7)['events'])
        recovered = run(state, 8, scale=1.04**8)
        self.assertTrue(recovered['events'])
        self.assertEqual(recovered['events'][0]['trackId'], original)

    def test_replacement_two_gaps_cuts_and_competing_boxes_never_reuse_id(self):
        for scenario in ('replacement', 'two-gaps', 'gap-too-long', 'scene-cut', 'competitor', 'occlusion', 'low-score'):
            state = ScaleApproachM3E(detail=False)
            run(state, 0)
            original = run(state, 1)['tracks'][0]['id']
            if scenario == 'scene-cut':
                cut = texture(818207, BG.shape)
                run(state, 2, boxes=[], background=cut)
                end = run(state, 3, background=cut)
            elif scenario == 'occlusion':
                run(state, 2, boxes=[], occluded=True)
                end = run(state, 3)
            else:
                run(state, 2, boxes=[])
                if scenario == 'two-gaps':
                    run(state, 3, boxes=[])
                    end = run(state, 4)
                elif scenario == 'gap-too-long':
                    end = run(state, 4)
                elif scenario == 'replacement':
                    image, box = scene()
                    x, y, u, v = map(round, box.xyxy)
                    image[y:v,x:u] = texture(818209, (v-y, u-x))
                    end = state.update(frame(3), 300, image, [box])
                elif scenario == 'low-score':
                    image, box = scene()
                    end = state.update(frame(3), 300, image, [Detection('car', .30, box.xyxy)])
                else:
                    image, box = scene()
                    competitor = Detection('car', .93, tuple(v+6 if i%2==0 else v for i,v in enumerate(box.xyxy)))
                    end = state.update(frame(3), 300, image, [box, competitor])
            self.assertNotIn(original, [t['id'] for t in end['tracks']], (scenario, end))
            self.assertFalse(end['events'], (scenario, end))

    def test_both_flags_off_matches_baseline_outputs(self):
        one, two = ScaleApproach(), ScaleApproachM3E(detail=False, relink=False)
        for i in range(6):
            self.assertEqual(run(one, i, scale=1.04**i), run(two, i, scale=1.04**i))

    def test_no_relink_flag_never_recovers_missing_identity(self):
        one = ScaleApproachM3E(detail=True, relink=False)
        run(one, 0)
        original = run(one, 1)['tracks'][0]['id']
        with patch.object(one, '_keep_missing', side_effect=AssertionError('disabled path')):
            run(one, 2, boxes=[])
            self.assertNotEqual(run(one, 3)['tracks'][0]['id'], original)


if __name__ == '__main__':
    unittest.main()
