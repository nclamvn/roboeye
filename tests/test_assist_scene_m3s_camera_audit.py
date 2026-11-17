"""Authored camera-audit checks, not road/pose accuracy certification."""
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
import sys
import unittest
import json

import cv2
import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
import assist_scene_m3s_camera_audit as m


def row(image,index,status="valid",epoch=0):
    h,w=image.shape;stamp=1_000_000+index*80_000;digest=sha256(image.tobytes()).hexdigest()
    return dict(index=index,token=f"authored-{index}",timestampUs=stamp,sourcePoseTimestampUs=stamp,
        sourcePoseEpoch=None,timeMs=float(index*80),sourceSha256=digest,
        workingPixelsSha256=digest,width=w,height=h,
        cameraIntrinsics=[[120.,0.,w/2],[0.,120.,h/2],[0.,0.,1.]],
        cameraToWorld=np.eye(4).tolist(),T=dict(status=status,epoch=epoch,tracks=[],diagnostics={}))


class CameraAuditTests(unittest.TestCase):
    def test_exact_frozen_lk_inventory_background_and_hash_binding(self):
        rng=np.random.default_rng(651003)
        image=cv2.GaussianBlur(rng.integers(0,256,(160,192),np.uint8),(3,3),.5)
        old,new=row(image,0),row(image.copy(),1)
        pair,_=m.pose_pair(m.metadata(old),m.metadata(new),192,160)
        valid,q=m.frozen._background(pair,pair.homography,image,image,[],[])
        new["T"]["diagnostics"]["background"]=q
        observed=m.audit_pair(old,new,image,image)
        self.assertEqual(observed["frozenBackground"],q)
        self.assertEqual(observed["frozenBackgroundValid"],valid)
        self.assertTrue(observed["backgroundReproduces"])
        seeds=observed["sourceSeedInventory"]["points"]
        self.assertGreater(len(seeds),24);self.assertLessEqual(len(seeds),256)
        self.assertEqual(len(seeds),len(observed["lk"]["s"]))
        self.assertEqual(len(seeds),len(observed["lk"]["rev"]))
        self.assertEqual(len(seeds),len(observed["lk"]["keep"]))
        self.assertEqual(observed["events"],[]);self.assertFalse(observed["motionAuthorized"])
        forged=deepcopy(new);forged["workingPixelsSha256"]="0"*64
        with self.assertRaisesRegex(ValueError,"forged-working"):m.audit_pair(old,forged,image,image)

    def test_crossfit_heldout_pixels_never_train_their_own_model(self):
        x,y=np.meshgrid(np.arange(12,192,12),np.arange(10,160,10))
        a=np.column_stack((x.ravel(),y.ravel())).astype(float)
        b=a@np.array([[1.01,.005],[-.002,1.01]])+np.array([1.,-1.])
        records=m.crossfit_models(a,b,(160,192));self.assertTrue(m.validate_crossfit(records,a,b,(160,192)))
        changed=b.copy();changed[m.folds(a,(160,192))==0]+=np.array([17.,-23.])
        other=m.crossfit_models(a,changed,(160,192))
        for first,second in zip(records,other,strict=True):
            self.assertFalse(set(first["trainIndexes"])&set(first["holdoutIndexes"]))
            if first["fold"]==0:
                self.assertEqual(first["model"],second["model"])
                self.assertEqual(first["trainingPairsSha256"],second["trainingPairsSha256"])
                self.assertNotEqual(first["holdoutResidualPx"],second["holdoutResidualPx"])
        forged=deepcopy(records);forged[0]["trainIndexes"].append(forged[0]["holdoutIndexes"][0])
        with self.assertRaisesRegex(ValueError,"holdout used"):m.validate_crossfit(forged,a,b,(160,192))
        empty=m.crossfit_models(np.empty((0,2)),np.empty((0,2)),(160,192))
        self.assertTrue(all(x["trainGeometryDegenerate"] for x in empty))

    def test_raw_lifetime_does_not_become_cross_veto_authority(self):
        image=np.zeros((80,100),np.uint8);ledger=m.RawExposureLedger()
        first=ledger.observe(row(image,0));bad=ledger.observe(row(image,1,"insufficient-background-agreement",9))
        ready=ledger.observe(row(image,2,"valid",9))
        self.assertEqual(bad["count"],2);self.assertEqual(ready["count"],3)
        self.assertTrue(ready["certificateReady"]);self.assertEqual(ready["retainedSoftVetoes"],1)
        self.assertFalse(first["motionAuthorized"] or bad["motionAuthorized"] or ready["motionAuthorized"])
        hard=row(image,3);hard["sourcePoseEpoch"]=1
        self.assertEqual(ledger.observe(hard)["hardReset"],"source-epoch-changed")
        self.assertEqual(len(ledger.rows),0)
        ledger.observe(row(image,4));dup=row(image,4)
        self.assertEqual(ledger.observe(dup)["hardReset"],"clock-discontinuity")
        ledger.observe(row(image,5));calib=row(image,6);calib["cameraIntrinsics"][0][0]=121.
        self.assertEqual(ledger.observe(calib)["hardReset"],"calibration-changed")
        for i in range(7,30):ledger.observe(row(image,i))
        self.assertLessEqual(len(ledger.rows),11)
        self.assertFalse(any(x["motionAuthorized"]for x in ledger.rows))
        for field,value in (("timeMs",float('nan')),("token",""),("sourceSha256","z"*64)):
            forged=row(image,31);forged[field]=value
            self.assertFalse(m.RawExposureLedger().observe(forged)["retained"])

    def test_profile_restored_if_frozen_call_arguments_fail(self):
        image=np.zeros((80,100),np.uint8);old,new=row(image,0),row(image,1)
        old["T"]["tracks"]=None
        before=sys.getprofile()
        with self.assertRaises(TypeError):m.audit_pair(old,new,image,image)
        self.assertIs(sys.getprofile(),before)

    def test_fixed_policy_not_a_camera_candidate(self):
        self.assertEqual(m.POLICY["maxIters"],1000)
        self.assertEqual(m.POLICY["residualPx"],1.8)
        for key in ("minBackgroundPoints","minBackgroundSupport","minBackgroundCells","minBackgroundSpan"):
            self.assertEqual(m.POLICY[key],m.frozen.POLICY[key])

    def test_failure_prefix_has_frozen_sources_and_zero_model_calls(self):
        with self.assertRaises(json.JSONDecodeError) as caught:m.run(__file__,__file__)
        prefix=caught.exception.m3s_progress
        self.assertEqual(prefix["completedPairs"],0);self.assertEqual(prefix["clips"],[])
        self.assertEqual(prefix["newModelCalls"],0);self.assertFalse(prefix["motionAuthorized"])
        self.assertEqual(prefix["codeSha256"],prefix["codeAfterSha256"])
        self.assertIn("assist_scene_pose_motion.py",prefix["codeSha256"])
        self.assertEqual(prefix["phase"],"input-binding")


if __name__=="__main__":unittest.main()
