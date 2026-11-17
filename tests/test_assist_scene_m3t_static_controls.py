"""Authored geometry/isolation tests; not sensor or traffic quality evidence."""
from copy import deepcopy
from pathlib import Path
import json
import sys
import unittest

import cv2
import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
import assist_scene_m3t_static_controls as m

K=np.asarray(m.PROFILES["primary-fr3"])


def sensor(ts,xyz=(0.,0.,0.),q=(0.,0.,0.,1.)):
    return dict(timestampUs=ts,pose=dict(status="valid",timestampUs=ts,skewUs=0,
        translation=list(xyz),quaternion=list(q)))


def frame(ts,xyz=(0.,0.,0.),depth_ts=None,depth_xyz=None):
    dt=ts if depth_ts is None else depth_ts
    return dict(rgb=sensor(ts,xyz),depth=sensor(dt,xyz if depth_xyz is None else depth_xyz),
        association=dict(status="valid",deltaUs=dt-ts))


def plane(z):return np.full((480,640),round(z*5000),np.uint16)


class StaticControlTests(unittest.TestCase):
    def test_optical_Z_not_radial_range_and_active_quaternion(self):
        old=np.eye(4);new=np.eye(4);new[0,3]=.1
        a=np.array([[600.,400.]])
        p,z=m.project(a,np.array([2.]),old,new,K)
        self.assertAlmostEqual(p[0,0],600-K[0,0]*.1/2,places=10)
        self.assertEqual(z[0],2.)
        s=sensor(1_000_000,q=(0.,0.,np.sqrt(.5),np.sqrt(.5)))
        t=m.pose_transform(s)
        np.testing.assert_allclose(t[:3,:3]@np.array([1.,0.,0.]),[0.,1.,0.],atol=1e-12)
        s["pose"]["quaternion"]=[1.,0.,0.,0.]
        np.testing.assert_allclose(m.pose_transform(s)[:3,:3],np.diag([1.,-1.,-1.]),atol=1e-12)

    def test_async_depth_uses_own_pose_and_does_not_fill_holes(self):
        f=frame(1_020_000,xyz=(.075,0,0),depth_ts=1_000_000,depth_xyz=(0,0,0))
        z,reason,xy,points=m.registered_depth_at_rgb(plane(2),f,K)
        self.assertEqual(reason,"timestamp-aware-zbuffer-no-hole-filling")
        self.assertAlmostEqual(z[240,320],2.)
        self.assertTrue(np.isnan(z[240,639]))
        self.assertAlmostEqual(xy[240,320,0],340-K[0,0]*.075/2,places=6)
        self.assertAlmostEqual(points[240,320,2],2.)
        current=frame(1_120_000,xyz=(.1,0,0))
        ref=m.reference([[320.,240.]],f,current,plane(2),plane(2),K)
        self.assertAlmostEqual(ref["expectedEndpoints"][0][0],320-K[0,0]*.025/2,places=7)
        self.assertIsNotNone(ref["sourceSamplingOffsetPx"][0])
        self.assertIsNotNone(ref["sourceRegistrationSensitivity"][0])

    def test_zbuffer_nearest_collision_and_independent_occlusion(self):
        depth=np.zeros((480,640),np.uint16);depth[240,320]=10000;depth[240,310]=20000
        f=frame(1_020_000,xyz=(.075,0,0),depth_ts=1_000_000,depth_xyz=(0,0,0))
        projected,_,_,points=m.registered_depth_at_rgb(depth,f,K)
        self.assertAlmostEqual(projected[240,300],2.)
        self.assertAlmostEqual(points[240,300,2],2.)
        old,current=frame(1_000_000),frame(1_100_000)
        ref=m.reference([[320.,240.]],old,current,plane(4),plane(2),K)
        self.assertEqual(ref["status"],["occluded-by-nearer-depth"])
        current_hole=plane(4);current_hole[240,320]=0
        hole=m.reference([[320.,240.]],old,current,plane(4),current_hole,K)
        self.assertEqual(hole["status"],["current-depth-unavailable"])

    def test_unavailable_pose_depth_outside_and_wrong_clocks_not_pass(self):
        old,current=frame(1_000_000),frame(1_100_000)
        old["rgb"]["pose"]["timestampUs"]+=5001
        self.assertIsNone(m.pose_transform(old["rgb"]))
        self.assertEqual(m.reference([[320.,240.]],old,current,plane(2),plane(2),K)["status"],["rgb-pose-unavailable"])
        old=frame(1_000_000);old["association"]["deltaUs"]=1
        self.assertEqual(m.reference([[320.,240.]],old,current,plane(2),plane(2),K)["status"],["source-depth-unavailable"])
        old=frame(1_000_000)
        self.assertEqual(m.reference([[320.,240.]],old,current,plane(0),plane(2),K)["status"],["source-depth-unavailable"])
        self.assertEqual(m.reference([[-2.,240.]],old,current,plane(2),plane(2),K)["status"],["source-outside-image"])
        self.assertEqual(m.reference([[320.,240.]],old,current,plane(7),plane(7),K)["status"],["source-depth-outside-evaluation-range"])
        edge=plane(2);edge[240,321]=0
        self.assertEqual(m.reference([[320.,240.]],old,current,edge,plane(2),K)["status"],["source-depth-edge-or-hole-reference-unknown"])

    def test_RGB_LK_isolated_from_depth_reference_and_all_seeds_retained(self):
        rng=np.random.default_rng(651004)
        old=cv2.GaussianBlur(rng.integers(0,256,(480,640),np.uint8),(3,3),.6)
        new=cv2.warpAffine(old,np.array([[1.,0.,-2.],[0.,1.,0.]]),(640,480))
        rgb=m.rgb_evidence(old,new);sealed=m.canonical(rgb)
        self.assertEqual(rgb["originalSeedCount"],256);self.assertEqual(rgb["calcOpticalFlowDirectionCalls"],2)
        self.assertEqual(len(rgb["lkAccepted"]),256)
        f,g=frame(1_000_000),frame(1_100_000,xyz=(.01,0,0))
        ref=m.reference(rgb["sourceSeeds"],f,g,plane(2),plane(2),K)
        missing=m.reference(rgb["sourceSeeds"],f,g,plane(0),plane(0),K)
        self.assertEqual(m.canonical(rgb),sealed)
        self.assertEqual(ref["originalSeedCount"],missing["originalSeedCount"])
        self.assertTrue(all(s=="source-depth-unavailable"for s in missing["status"]))
        self.assertFalse(rgb["referenceInputsSeen"])

    def test_negative_endpoints_do_not_change_gold_or_visibility(self):
        f,g=frame(1_000_000),frame(1_100_000)
        seeds=[[320.,240.],[420.,300.]];ref=m.reference(seeds,f,g,plane(2),plane(2),K);sealed=m.canonical(ref)
        rgb=dict(originalSeedCount=2,sourceSeeds=seeds,forwardEndpoints=seeds,lkAccepted=[True,True])
        result=m.compare(rgb,ref,f,g,K)
        self.assertEqual(result["visibleAcceptedEpe"]["medianPx"],0.)
        self.assertAlmostEqual(result["negativeControls"]["shiftedLkEndpoints"]["medianPx"],np.sqrt(200))
        self.assertEqual(result["negativeControls"]["poseClockPlus40Ms"]["status"],"reference-pose-skew-exceeds5ms")
        self.assertEqual(m.canonical(ref),sealed)
        altered=deepcopy(rgb);altered["forwardEndpoints"]=[[330.,250.],[430.,310.]]
        self.assertGreater(m.compare(altered,ref,f,g,K)["visibleAcceptedEpe"]["medianPx"],10.)
        self.assertEqual(m.canonical(ref),sealed)

    def test_predeclared_calibrations_not_selected_and_failure_prefix(self):
        self.assertEqual(len(m.PROFILES),2)
        self.assertEqual(m.PROFILES["primary-fr3"][0][0],535.4)
        self.assertEqual(m.PROFILES["documented-ros-default-sensitivity"][0][0],525.)
        with self.assertRaises(json.JSONDecodeError)as caught:m.run(__file__,m.digest(__file__))
        prefix=caught.exception.m3t_progress
        self.assertEqual(prefix["completedPairs"],0);self.assertFalse(prefix["motionAuthorized"])
        self.assertEqual(prefix["codeSha256"],prefix["codeAfterSha256"])
        self.assertEqual(prefix["learnedModelCalls"],0)
        with self.assertRaisesRegex(ValueError,"unapproved-manifest-hash")as rejected:m.run(__file__,"0"*64)
        self.assertEqual(rejected.exception.m3t_progress["completedPairs"],0)

    def test_profile_restored_on_empty_RGB_and_no_fabricated_seed(self):
        before=sys.getprofile();rgb=m.rgb_evidence(np.zeros((480,640),np.uint8),np.zeros((480,640),np.uint8))
        self.assertIs(sys.getprofile(),before);self.assertEqual(rgb["originalSeedCount"],0)
        self.assertEqual(rgb["calcOpticalFlowDirectionCalls"],0)
        self.assertFalse(rgb["motionAuthorized"])

    def test_frozen_native640_guard_floors_and_actual_direction_accounting(self):
        rng=np.random.default_rng(651005)
        image=cv2.GaussianBlur(rng.integers(0,256,(480,640),np.uint8),(3,3),.6)
        old,current=frame(1_000_000),frame(1_100_000,xyz=(.1,0,0))
        before=sys.getprofile();guard=m.frozen_camera_guard(image,image,old,current,0)
        self.assertIs(sys.getprofile(),before)
        self.assertEqual(guard["actualResidualCriterionPx"],1.625)
        self.assertEqual(guard["correspondenceCalls"],1);self.assertEqual(guard["lkDirectionCalls"],2)
        current=frame(1_100_000,xyz=(.01,0,0))
        fallback=m.frozen_camera_guard(image,image,old,current,0)
        self.assertEqual(fallback["actualResidualCriterionPx"],1.3)
        self.assertEqual(fallback["modelMode"],"checked-near-rotation-fallback")
        self.assertTrue(m.compare(dict(originalSeedCount=1,sourceSeeds=[[320.,240.]],forwardEndpoints=[[320.,240.]],lkAccepted=[True]),
            m.reference([[320.,240.]],old,frame(1_100_000),plane(2),plane(2),K),old,frame(1_100_000),K)["projectionGeometrySelfConsistency"]["byConstruction"])


if __name__=="__main__":unittest.main()
