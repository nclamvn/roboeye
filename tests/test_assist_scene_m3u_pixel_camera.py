"""Authored geometry/authority controls; not natural traffic quality."""
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
import sys
import unittest

import cv2
import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
import assist_scene_m3u_pixel_camera as m


def frame(i,position=(0.,0.,0.),rotation=None,image=None):
    t=np.eye(4);t[:3,3]=position
    if rotation is not None:t[:3,:3]=rotation
    return dict(token=f"authored-{i}",timestampUs=1_000_000+i*80000,poseTimestampUs=1_000_000+i*80000,
        intrinsics=[[120.,0.,80.],[0.,120.,80.],[0.,0.,1.]],cameraToWorld=t.tolist(),
        sha256="a"*64 if image is None else sha256(image.tobytes()).hexdigest())


def controls(a,b,good=None):
    n=len(a);good=np.ones(n,bool)if good is None else np.asarray(good,bool)
    return dict(sourceSeeds=np.asarray(a).tolist(),endpoints=np.asarray(b).tolist(),originalSeedCount=n,
        lkAccepted=good.tolist(),photometric=good.tolist(),outsideCurrentForeground=good.tolist())


def grid():
    x,y=np.meshgrid(np.linspace(20,140,10),np.linspace(20,140,10))
    return np.column_stack((x.ravel(),y.ravel()))


def recorded(f,index,camera,working):
    return dict(index=index,token=f["token"],timestampUs=f["timestampUs"],sourcePoseTimestampUs=f["poseTimestampUs"],
        timeMs=float(index*80),sourceSha256=f["sha256"],sourcePoseEpoch=None,workingPixelsSha256=working,
        cameraIntrinsics=f["intrinsics"],cameraToWorld=f["cameraToWorld"],width=160,height=160,detections=[],T_B=camera)


class PixelCameraTests(unittest.TestCase):
    def test_small_translation_large_pixel_impact_and_world_scale_invariance(self):
        a=grid();b=a+[-2.4,0.]
        p,info=m.candidate_pose(frame(0),frame(1,(.01,0,0)),160,160)
        self.assertEqual(info["frozenPoseStatus"],"epipolar-baseline-too-small")
        e=m.evaluate(controls(a,b),p,(160,160))
        self.assertEqual(e["selectedMode"],"epipolar-observed-parallax")
        self.assertFalse(e["rotationQuality"]["supported"])
        p2,_=m.candidate_pose(frame(0),frame(1,(1.,0,0)),160,160)
        e2=m.evaluate(controls(a,b),p2,(160,160))
        self.assertEqual(e["epipolarParallaxAgreement"],e2["epipolarParallaxAgreement"])
        self.assertEqual(e["selectedMode"],e2["selectedMode"])

    def test_reversed_translation_same_F_lines_fails_signed_cheirality(self):
        a=grid();b=a+[-2.4,0.]
        forward,_=m.candidate_pose(frame(0),frame(1,(.01,0,0)),160,160)
        reverse,_=m.candidate_pose(frame(0),frame(1,(-.01,0,0)),160,160)
        yes=m.evaluate(controls(a,b),forward,(160,160));no=m.evaluate(controls(a,b),reverse,(160,160))
        np.testing.assert_allclose(yes["maxDualEpipolarResidualPx"],no["maxDualEpipolarResidualPx"],atol=1e-9)
        self.assertFalse(any(no["positiveCheiralityBoth"]));self.assertIsNone(no["selectedMode"])

    def test_rotation_low_impact_not_claiming_zero_translation(self):
        a=grid();p,_=m.candidate_pose(frame(0),frame(1,(.01,0,0)),160,160)
        e=m.evaluate(controls(a,a+[-.5,0]),p,(160,160))
        self.assertEqual(e["selectedMode"],"rotation-low-observed-impact")
        self.assertTrue(e["rotationQuality"]["supported"])
        r,_=cv2.Rodrigues(np.array([0.,.03,0.]));p,_=m.candidate_pose(frame(0),frame(1,rotation=r),160,160)
        expected=m.base._project(a,p.homography)
        self.assertEqual(m.evaluate(controls(a,expected),p,(160,160))["selectedMode"],"rotation-low-observed-impact")

    def test_full_seed_denominator_spatial_coverage_and_epipole(self):
        a=grid();p,_=m.candidate_pose(frame(0),frame(1,(.01,0,0)),160,160)
        e=m.evaluate(controls(a,a+[-2.4,0],np.arange(100)<69),p,(160,160))
        self.assertEqual(e["epipolarQuality"]["originalSeeds"],100);self.assertIsNone(e["selectedMode"])
        localized=np.column_stack((np.linspace(40,80,100),np.linspace(40,60,100)))
        self.assertIsNone(m.evaluate(controls(localized,localized+[-2.4,0]),p,(160,160))["selectedMode"])
        p,_=m.candidate_pose(frame(0),frame(1,(0,0,.01)),160,160)
        near=np.tile([80.,80.],(100,1));e=m.evaluate(controls(near,near+[2.,0.]),p,(160,160))
        self.assertFalse(any(e["epipolarUsable"]));self.assertIsNone(e["selectedMode"])

    def test_common_scale_veto_uses_plausible_not_original_denominator(self):
        x,y=np.meshgrid(np.linspace(15,145,12),np.linspace(15,145,12));a=np.column_stack((x.ravel(),y.ravel()))
        a=a[np.linalg.norm(a-[80,80],axis=1)>40][:100]
        self.assertEqual(len(a),100);b=(a-[80,80])*1.04+[80,80];good=np.arange(100)<75
        p,_=m.candidate_pose(frame(0),frame(1,(0,0,.01)),160,160)
        cv2.setRNGSeed(650500);e=m.evaluate(controls(a,b,good),p,(160,160))
        self.assertTrue(e["epipolarQuality"]["supported"])
        self.assertAlmostEqual(e["commonLogScale"],np.log(1.04),places=6)
        self.assertTrue(m.base.ScaleApproach()._update_common_scale(80,e))

    def test_only_baseline_rejection_is_reconstructed(self):
        original=frame(0);bad=frame(1,(.01,0,0));bad["poseTimestampUs"]+=40_000
        p,info=m.candidate_pose(original,bad,160,160)
        self.assertIsNone(p);self.assertEqual(info["status"],"pose-skew")
        bad=frame(1,(.01,0,0));bad["intrinsics"][0][0]=121.
        p,info=m.candidate_pose(original,bad,160,160)
        self.assertIsNone(p);self.assertEqual(info["status"],"calibration-changed")

    def test_actual_RGB_source_denominator_current_handles_and_veto_reset(self):
        rng=np.random.default_rng(651006);old=cv2.GaussianBlur(rng.integers(0,256,(160,160),np.uint8),(3,3),.6)
        new=cv2.warpAffine(old,np.array([[1.,0.,-2.4],[0.,1.,0.]]),(160,160))
        camera=m.PixelCameraAuthority();first=camera.update(frame(0,image=old),0.,old,[])
        cv2.setRNGSeed(650501);second=camera.update(frame(1,(.01,0,0),image=new),80.,new,[])
        self.assertEqual(first["status"],"first-frame");self.assertEqual(second["status"],"valid")
        self.assertEqual(second["diagnostics"]["controls"]["originalSeedCount"],256)
        self.assertEqual(second["events"],[]);self.assertFalse(second["diagnostics"]["persistentIdentity"])
        bad=frame(2,(.02,0,0),image=new);bad["poseTimestampUs"]+=40_000
        rejected=camera.update(bad,160.,new,[]);self.assertEqual(rejected["status"],"pose-skew")
        self.assertEqual(rejected["epoch"],second["epoch"]+1)
        self.assertEqual(camera.update(frame(3,(.03,0,0),image=new),240.,new,[])["status"],"first-frame")

    def test_numeric_validator_reconstructs_scale_veto_not_only_acceptance(self):
        x,y=np.meshgrid(np.linspace(15,145,12),np.linspace(15,145,12));a=np.column_stack((x.ravel(),y.ravel()))
        a=a[np.linalg.norm(a-[80,80],axis=1)>40][:100];b=(a-[80,80])*1.04+[80,80];good=np.arange(100)<75
        f0,f1=frame(0),frame(1,(0,0,.01));pair,pose=m.candidate_pose(f0,f1,160,160)
        c=controls(a,b,good);c.update(sourceGraySha256="a"*64,currentGraySha256="b"*64,
            forwardStatus=good.astype(int)[:,None].tolist(),backwardStatus=np.ones((100,1),int).tolist(),backwardEndpoints=a.tolist())
        cv2.setRNGSeed(650501);e=m.evaluate(c,pair,(160,160))
        first=dict(status="first-frame",epoch=0,diagnostics={})
        surface=dict(status="scale-ambiguous",epoch=1,events=[],tracks=[],diagnostics=dict(method=m.POLICY["method"],policy=dict(m.POLICY),
            sourceToken=f1["token"],sourceSha256=f1["sha256"],sourceTimestampUs=f1["timestampUs"],workingPixelsSha256="b"*64,
            presentationExposure=2,controls=c,evidence=e,pose=pose,previousToken=f0["token"]))
        history=[recorded(f0,0,first,"a"*64)];current=recorded(f1,1,surface,"b"*64)
        self.assertTrue(m.validate_surface(surface,current,history))
        forged=deepcopy(surface);forged["status"]="valid";forged["epoch"]=0
        with self.assertRaisesRegex(ValueError,"scale-veto"):m.validate_surface(forged,current,history)

    def test_missing_exposure_token_fails_before_first_frame(self):
        image=np.zeros((160,160),np.uint8);f=frame(0,image=image);f.pop("token")
        self.assertEqual(m.PixelCameraAuthority().update(f,0.,image,[])["status"],"unbound-source-token")


if __name__=="__main__":unittest.main()
