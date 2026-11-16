"""Synthetic disjoint support, pose failure and epipolar blind spot controls."""

from pathlib import Path
import sys
import unittest

import cv2
import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from assist_scene_motion import Detection
from assist_scene_pose_accumulation import POLICY, PoseAccumulation


W,H,F=480,320,340
K=np.array([[F,0.,W/2],[0.,F,H/2],[0.,0.,1.]])


def texture(seed, shape):
    img=np.random.default_rng(seed).integers(0,255,shape,np.uint8)
    return cv2.GaussianBlur(img,(5,5),0)


class Fixture:
    def __init__(self, step=.070):
        self.step=step
        self.back=texture(716,(H,W))
        self.front=texture(55,(80,80))

    def frame(self,i,kind="cross",time_ms=None):
        t=i*100 if time_ms is None else time_ms
        p=np.eye(4);p[0,3]=i*self.step
        gx=-round(F*p[0,3]/13)
        gray=cv2.warpAffine(self.back,np.float32([[1,0,gx],[0,1,0]]),(W,H),borderMode=cv2.BORDER_REFLECT_101)
        x=250-round(F*p[0,3]/6)+(5*i if kind=="along" else 0)
        y=80+(4*i if kind=="cross" else 0)
        gray[y:y+80,x:x+80]=self.front
        box=Detection("car",.90,(x,y,x+80,y+80))
        return {"timestampUs":1_000_000+t*1000,"poseTimestampUs":1_000_000+t*1000,
                "cameraToWorld":p, "intrinsics":K},gray,[box]


class TestPoseAccumulation(unittest.TestCase):
    def clean_trace(self, kind, step=.070, end=12):
        p,src=PoseAccumulation(),Fixture(step)
        results=[]
        for i in range(end):
            meta,gray,boxes=src.frame(i,kind)
            results.append(p.update(meta,i*100,gray,boxes))
        return results

    def test_cross_epipolar_two_disjoint_recent_intervals(self):
        out=self.clean_trace("cross")
        # At 100 ms sampling, the first 200 ms candidate (0→200)
        # may legitimately confirm with the later 300→600 candidate.
        self.assertFalse(any(r["events"] for r in out[:6]))
        yes=[(i,r) for i,r in enumerate(out) if r["events"]]
        self.assertTrue(yes)
        for i,r in yes:
            ev=r["events"][0];a,b=ev["disjointPairsMs"]
            self.assertGreaterEqual(b[0]-a[1],POLICY["minTemporalDisjointGapMs"])
            self.assertEqual(ev["timeMs"],b[1])
            self.assertEqual(ev["timeMs"],i*100)
            self.assertEqual(ev["trackId"],r["tracks"][0]["id"])

    def test_stationary_parallax_and_along_epipolar_remain_unobserved(self):
        for mode in ("stationary","along"):
            with self.subTest(mode=mode):
                out=self.clean_trace(mode)
                self.assertTrue(any(r["status"]=="valid" for r in out))
                self.assertFalse(any(r["events"] for r in out))

    def test_adjacent_small_nonzero_translation_accumulates_but_is_not_rotation(self):
        out=self.clean_trace("cross",.012)
        valid=[r for r in out if r["status"]=="valid"]
        self.assertTrue(valid)
        self.assertTrue(any(r["events"] for r in valid))
        for r in valid:
            self.assertEqual(r["diagnostics"]["adjacent"]["status"],"epipolar-baseline-too-small")
            self.assertEqual(r["diagnostics"]["longPair"]["mode"],"epipolar")
        zero=self.clean_trace("cross",0.)
        self.assertTrue(any(r["events"] for r in zero))
        self.assertTrue(all(r["diagnostics"]["longPair"]["mode"]=="rotation" for r in zero if r["status"]=="valid"))
        approximate=self.clean_trace("cross",.003)
        self.assertFalse(any(r["events"] for r in approximate))

    def test_inexact_pose_time_cannot_authorize_rotation(self):
        track,src=PoseAccumulation(),Fixture(0.)
        meta,gray,boxes=src.frame(0)
        track.update(meta,0,gray,boxes)
        meta,gray,boxes=src.frame(1)
        meta["poseTimestampUs"]-=5_000
        result=track.update(meta,100,gray,boxes)
        self.assertEqual(result["status"],"rotation-requires-exact-clock")
        self.assertFalse(result["events"])

    def test_clock_pose_appearance_and_physical_track_resets(self):
        for kind,expected in (("missing","missing-frame-pose"),("skew","pose-skew"),
                              ("cut","cut-or-insufficient-appearance"),("epoch","pose-epoch-mismatch"),
                              ("gap","stream-discontinuity"),("lost","valid"),("switch","valid")):
            with self.subTest(kind=kind):
                p,src=PoseAccumulation(),Fixture()
                for i in range(8):
                    meta,gray,boxes=src.frame(i)
                    previous=p.update(meta,i*100,gray,boxes)
                self.assertTrue(previous["events"])
                meta,gray,boxes=src.frame(8)
                if kind=="missing":
                    meta["cameraToWorld"]=None
                elif kind=="skew":
                    meta["poseTimestampUs"]-=50_000
                elif kind=="cut":
                    gray=texture(919,(H,W))
                elif kind=="epoch":
                    meta["epoch"]=5
                elif kind=="lost":
                    boxes=[]
                elif kind=="switch":
                    boxes=[Detection("truck",.90,boxes[0].xyxy)]
                current=p.update(meta,900 if kind=="gap" else 800,gray,boxes)
                self.assertFalse(current["events"])
                self.assertEqual(current["status"],expected)
                meta,gray,boxes=src.frame(9)
                self.assertFalse(p.update(meta,900,gray,boxes)["events"])


if __name__=="__main__":
    unittest.main()
