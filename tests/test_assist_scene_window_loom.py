"""Mechanism tests on authored pixels; not real detector/phone acceptance."""

from copy import deepcopy
import math
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import cv2
import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from assist_scene_motion import Detection
from assist_scene_window_loom import WindowLoom, AnchorWindowLoom, POLICY, angular_growth, _tile
import assist_scene_window_loom as loom


W,H=480,360
K=np.array([[330.,0.,W/2],[0.,330.,H/2],[0.,0.,1.]])


def texture(seed,shape):
    r=np.random.default_rng(seed).integers(0,256,shape,np.uint8)
    return cv2.GaussianBlur(r,(3,3),.65)


BG=texture(6009,(H,W));OBJ=texture(7331,(180,150))


def image(i,scale=1.,*,box_scale=None,tall=False,occluded=False):
    x,y=255.,155.
    width,height=(28.,130.) if tall else (83.,94.)
    bw,bh=width*scale,height*scale
    a,b,r,s=map(round,(x-bw/2,y-bh/2,x+bw/2,y+bh/2))
    pixels=BG.copy()
    patch=cv2.resize(OBJ,(r-a,s-b),interpolation=cv2.INTER_LINEAR)
    if occluded:patch[:,:patch.shape[1]*2//3]=127
    pixels[b:s,a:r]=patch
    z=scale if box_scale is None else box_scale
    box=Detection("car",.94,(x-width*z/2,y-height*z/2,x+width*z/2,y+height*z/2))
    pose=np.eye(4)
    frame={"timestampUs":2_000_000+i*80_000,"poseTimestampUs":2_000_000+i*80_000,
           "token":f"f-{i}","cameraToWorld":pose.tolist(),"intrinsics":K.tolist()}
    return frame,pixels,box


def run(state,i,scale=1.,**kwargs):
    frame,pixels,box=image(i,scale,**kwargs)
    return state.update(frame,i*80.,pixels,[box])


class WindowLoomTests(unittest.TestCase):
    def setUp(self):
        cv2.setNumThreads(1);cv2.setRNGSeed(6507)

    def test_window_collects_slow_growth_below_previous_adjacent_floor(self):
        state=WindowLoom()
        results=[run(state,i,1.0055**i) for i in range(11)]
        self.assertTrue(any(r["events"] for r in results[7:]),results[-1])
        ids=[r["tracks"][0]["id"] for r in results]
        self.assertEqual(len(set(ids)),1)
        self.assertFalse(results[0]["events"])
        self.assertTrue(all("metres" not in str(r) for r in results))

    def test_static_identity_persists_without_warning(self):
        state=WindowLoom()
        values=[run(state,i) for i in range(10)]
        self.assertEqual(len({r["tracks"][0]["id"] for r in values}),1)
        self.assertTrue(all(not r["events"] for r in values))

    def test_detector_jitter_without_pixel_expansion_never_warns(self):
        state=WindowLoom()
        for i,z in enumerate([1.,1.02,.99,1.03,1.01,1.05,1.03,1.06,1.04,1.08]):
            result=run(state,i,box_scale=z)
            self.assertFalse(result["events"],result)

    def test_stopped_motion_missing_frame_and_cut_do_not_keep_old_warning(self):
        state=WindowLoom()
        values=[run(state,i,1.025**i) for i in range(7)]
        self.assertTrue(values[-1]["events"],values[-1])
        no=run(state,7,1.025**6)
        self.assertFalse(no["events"],no)
        f,p,b=image(8,1.025**7)
        self.assertFalse(state.update(f,640.,p,[])["events"])
        self.assertFalse(run(state,9,1.025**8)["events"])
        f,p,b=image(10,1.025**9)
        p[:]=texture(1112,p.shape)
        cut=state.update(f,800.,p,[b])
        self.assertFalse(cut["events"])
        self.assertNotEqual(cut["status"],"valid")

    def test_native_crop_keeps_tall_region_without_192_square_rejection(self):
        raw=np.repeat(np.repeat(BG,3,axis=0),3,axis=1)
        a=(200.,70.,218.,230.)
        tiles=_tile(raw,raw,a,a,np.diag((3.,3.,1.)))
        self.assertIsNotNone(tiles)
        p,q,mapping=tiles
        self.assertLessEqual(max(p.shape),384)
        self.assertEqual(p.shape,q.shape)
        self.assertGreater(max(p.shape),192)
        self.assertLessEqual(mapping[0,0],3.)

    def test_native_detail_tracks_actual_tall_texture_end_to_end(self):
        state=WindowLoom()
        native_bg=texture(1900,(H*3,W*3));native_obj=texture(1901,(460,80))
        results=[]
        for i in range(8):
            scale=1.025**i
            width,height=54*scale,390*scale
            x,y=255*3,155*3
            left,top,right,bottom=map(round,(x-width/2,y-height/2,x+width/2,y+height/2))
            raw=native_bg.copy()
            raw[top:bottom,left:right]=cv2.resize(native_obj,(right-left,bottom-top),interpolation=cv2.INTER_LINEAR)
            gray=cv2.resize(raw,(W,H),interpolation=cv2.INTER_AREA)
            f,_,_=image(i)
            box=Detection("person",.94,(left/3,top/3,right/3,bottom/3))
            results.append(state.update(f,i*80.,gray,[box],native_gray=raw))
        self.assertTrue(any(r["events"] for r in results[4:]),results[-1])
        self.assertTrue(results[-1]["diagnostics"]["nativeDetail"])

    def test_feature_turnover_reseeds_identity_and_uses_real_bounded_anchors(self):
        # Replace a small moving stripe of surface texture on each exposure.
        # Existing good corners disappear and new ones appear, while most of
        # the surface remains directly verifiable. This is not a missing frame
        # or an occluded object that would permit an alert to be coasted.
        state=AnchorWindowLoom()
        values=[]; counts=[]; surviving=[]
        flow=loom._flow
        def observe_flow(*args):
            result=flow(*args)
            if args[2].id!=0 and result[0] is not None:
                surviving.append(len(result[0][1]))
            return result
        for i in range(14):
            scale=1.018**i
            f,p,b=image(i,scale)
            left,top,right,bottom=map(round,b.xyxy)
            changing=OBJ.copy()
            stripe=(i%5)*30
            changing[:,stripe:stripe+12]=127
            p[top:bottom,left:right]=cv2.resize(changing,(right-left,bottom-top),interpolation=cv2.INTER_LINEAR)
            with patch.object(loom,"_flow",side_effect=observe_flow):
                values.append(state.update(f,i*80.,p,[b]))
            counts.append(len(state._previous[3][0].points))
        self.assertEqual(len({r["tracks"][0]["id"] for r in values}),1)
        self.assertTrue(any(r["events"] for r in values[6:]),values[-1])
        self.assertTrue(any(n<POLICY["maxPoints"] for n in surviving),surviving)
        self.assertTrue(all(n==POLICY["maxPoints"] for n in counts),counts)
        tube=state._previous[3][0]
        self.assertLessEqual(len(tube.anchors),POLICY["maxHistory"])
        self.assertTrue(all(max(a.pixels.shape)<=POLICY["maxTileSidePx"] for a in tube.anchors))
        self.assertLessEqual(values[-1]["diagnostics"]["anchorBytes"],
                             POLICY["maxTracks"]*POLICY["maxHistory"]*POLICY["maxTileSidePx"]**2)

    def test_rotation_preserves_unit_ray_pair_separation(self):
        points=np.float64([[80,80],[100,80],[120,80],[80,100],[100,100],[120,100],[80,120],[100,120],[120,120]])
        a=.15;rotation=np.array([[math.cos(a),0,math.sin(a)],[0,1,0],[-math.sin(a),0,math.cos(a)]])
        rays=np.column_stack((points,np.ones(len(points))))@np.linalg.inv(K).T
        moved=rays@rotation.T@K.T
        moved=moved[:,:2]/moved[:,2:]
        net,mad=angular_growth(points,moved,K)
        self.assertAlmostEqual(net,0,places=10)
        self.assertLess(mad,1e-10)

    def test_zoom_camera_skew_calibration_and_missing_pose_fail_closed(self):
        for kind in ("zoom","skew","calibration","missing"):
            state=WindowLoom()
            for i in range(8):
                f,p,b=image(i,1.025**i)
                if kind=="zoom":
                    s=1.025**i;mat=cv2.getRotationMatrix2D((W/2,H/2),0,s)
                    f,p,b=image(i)
                    p=cv2.warpAffine(p,mat,(W,H),borderMode=cv2.BORDER_REFLECT101)
                    rect=tuple(v*s+(1-s)*c for v,c in zip(b.xyxy,(W/2,H/2,W/2,H/2)))
                    b=Detection("car",.94,rect)
                if kind=="skew":f["poseTimestampUs"]+=30_000
                if kind=="calibration":f["intrinsics"][0][0]*=1+.01*i
                if kind=="missing":del f["cameraToWorld"]
                result=state.update(f,i*80.,p,[b])
                self.assertFalse(result["events"],(kind,result))

    def test_occlusion_and_competing_same_class_boxes_refuse(self):
        state=WindowLoom()
        for i in range(7):result=run(state,i,1.025**i)
        self.assertTrue(result["events"])
        self.assertFalse(run(state,7,1.025**7,occluded=True)["events"])
        state=WindowLoom()
        for i in range(8):
            f,p,b=image(i,1.025**i)
            other=Detection("car",.93,tuple(v+2 for v in b.xyxy))
            self.assertFalse(state.update(f,i*80.,p,[b,other])["events"])


if __name__=="__main__":unittest.main()
