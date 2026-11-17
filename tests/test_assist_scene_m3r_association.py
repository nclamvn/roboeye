"""Authored structural/analytic checks, not road or pretrained quality."""
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
import sys
import unittest

import cv2
import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
import assist_scene_m3r_association as m
from assist_scene_textured_window import TexturedGlobalWindowMotion
from assist_scene_m3o_correspondence_audit import analytic_fields
from assist_scene_motion import Detection
from assist_scene_m3e_study import output


def history(*,skip=None,birth=None,unsupported=False):
    h=w=160;center=np.array([80.,80.]);rng=np.random.default_rng(651001)
    original=cv2.GaussianBlur(rng.integers(0,256,(h,w),np.uint8),(3,3),.6)
    pixels=[];scales={}
    for i in range(10):
        scale=1.02**i;matrix=np.column_stack((np.eye(2)*scale,center*(1-scale)))
        image=cv2.warpAffine(original,matrix,(w,h),flags=cv2.INTER_LINEAR)
        pixels.append(image);scales[sha256(image.tobytes()).hexdigest()]=scale
    class Provider:
        direction_calls=0;metadata={"kind":"authored-exact-affine-test-not-a-model"};last_call={}
        def __call__(self,a,b):
            self.direction_calls+=2;r=scales[sha256(b.tobytes()).hexdigest()]/scales[sha256(a.tobytes()).hexdigest()]
            return analytic_fields(np.column_stack((np.eye(2)*r,center*(1-r))),a.shape)
    provider=Provider();a=TexturedGlobalWindowMotion(provider,mode="warped");b=m.IdentityChainWindowMotion();rows=[];oldpatch=None
    for i,image in enumerate(pixels):
        scale=1.02**i;lo=center+(np.array([45.,45.])-center)*scale;hi=center+(np.array([115.,115.])-center)*scale
        box=Detection("car",.99,tuple(map(float,(*lo,*hi))));patch=m.identity._appearance(image,box,np.eye(3));corr=m.identity._correlation(oldpatch,patch)
        t=dict(status="first-frame" if i==0 else "valid",epoch=0,tracks=[dict(id=7,**box.record(w,h))],events=[],
            diagnostics=dict(nativeDetail=False,pose={} if i==0 else {"intervalUs":80000},
                identityDecisions={"7":dict(kept=i>0 and i!=birth,reason="fresh-appearance-and-reciprocal-box" if i>0 and i!=birth else "new-or-appearance-unverified",appearanceCorrelation=corr)}))
        stamp=1_000_000+i*80000;digest=sha256(image.tobytes()).hexdigest();frame=dict(token=f"authored-{i}",timestampUs=stamp,
            poseTimestampUs=stamp,epoch=0,intrinsics=[[120.,0.,80.],[0.,120.,80.],[0.,0.,1.]],cameraToWorld=np.eye(4).tolist(),sha256=digest)
        ar=output(a.update(frame,float(i*80),image,[box],camera_surface=t),float(i*80))
        if unsupported:
            for pair in ar["diagnostics"]["comparisons"]:pair.update(supported=False,reason="authored-measurement-veto")
        if i==skip:oldpatch=patch;continue
        before=m.canonical(ar);br=output(b.update(frame,float(i*80),image,[box],camera_surface=t,measurement_surface=ar),float(i*80))
        if m.canonical(ar)!=before:raise AssertionError("A mutation")
        row=dict(index=i,token=frame["token"],timeMs=float(i*80),timestampUs=stamp,sourceSha256=digest,
            workingPixelsSha256=digest,width=w,height=h,nativeWidth=w,nativeHeight=h,
            cameraIntrinsics=frame["intrinsics"],cameraToWorld=frame["cameraToWorld"],T=t,A=ar,B=br)
        m.validate_frame(row,rows);rows.append(row);oldpatch=patch
    return rows,provider.direction_calls


class M3RAssociationTests(unittest.TestCase):
    def test_frozen_identity_and_measurement_thresholds(self):
        self.assertEqual(m.POLICY["identityIou"],.25);self.assertEqual(m.POLICY["identityReciprocalMargin"],.12)
        self.assertEqual(m.POLICY["identityCorrelation"],.70);self.assertEqual(m.POLICY["identityPatchStdFloor"],3.)
        for key in ("minPoints","minSupport","maxFlowFbPx","maxEstimatorLogGrowthSpan","minCurrentLinearGrowth","minNetLinearGrowth"):
            self.assertEqual(m.POLICY[key],m.geometry.POLICY[key])

    def test_actual_authored_identity_chain_and_immutable_measurement(self):
        rows,calls=history();self.assertGreater(calls,0)
        self.assertTrue(any(row["B"]["events"] for row in rows))
        for row in rows:self.assertEqual(row["B"]["diagnostics"]["additionalModelDirectionCalls"],0)
        self.assertLessEqual(rows[-1]["B"]["diagnostics"]["bank"]["count"],69)
        self.assertFalse(rows[-1]["B"]["diagnostics"]["bank"]["nativeImagesRetained"])

    def test_unsupported_measurement_cannot_borrow_identity_age(self):
        rows,_=history(unsupported=True);self.assertFalse(any(r["B"]["events"] for r in rows))

    def test_intermediate_birth_blocks_chain(self):
        rows,_=history(birth=5)
        self.assertFalse(rows[5]["B"]["events"])
        self.assertFalse(rows[6]["B"]["events"])

    def test_missing_observed_update_rejected_against_camera_interval(self):
        rows,_=history(skip=5)
        gap=next(r for r in rows if r["index"]==6)
        self.assertFalse(gap["B"]["events"])
        self.assertFalse(gap["B"]["diagnostics"]["identityTransition"]["supported"])

    def test_full_reciprocal_rivals_and_correlation_are_recomputed(self):
        rows,_=history();old=deepcopy(rows[-2]["B"]["diagnostics"]["identityObservation"])
        new=deepcopy(rows[-1]["B"]["diagnostics"]["identityObservation"])
        self.assertTrue(m.transition(old,new)["links"][0]["supported"])
        # Same ID and valid pixels do not resolve a same-label reciprocal tie.
        old["tracks"].append({**deepcopy(old["tracks"][0]),"id":8});old["patches"].append(deepcopy(old["patches"][0]))
        tr=m.transition(old,new);self.assertEqual(tr["links"][0]["reason"],"ambiguous-reciprocal-box")
        self.assertFalse(tr["links"][0]["supported"])

    def test_t_handle_and_appearance_decision_alone_are_not_certificates(self):
        rows,_=history();old=deepcopy(rows[-2]["B"]["diagnostics"]["identityObservation"])
        new=deepcopy(rows[-1]["B"]["diagnostics"]["identityObservation"])
        new["cameraIdentityDecisions"]["7"]["reason"]="fresh-one-pair-pixel-identity"
        self.assertFalse(m.transition(old,new)["links"][0]["supported"])
        new["cameraIdentityDecisions"]["7"]["reason"]="fresh-appearance-and-reciprocal-box"
        new["cameraIdentityDecisions"]["7"]["appearanceCorrelation"]-=.1
        self.assertFalse(m.transition(old,new)["links"][0]["supported"])

    def test_reset_gap_duplicate_id_and_low_contrast_reject(self):
        rows,_=history();old=deepcopy(rows[-2]["B"]["diagnostics"]["identityObservation"])
        new=deepcopy(rows[-1]["B"]["diagnostics"]["identityObservation"])
        for key,value in (("epoch",1),("status","first-frame"),("timeMs",old["timeMs"]+301),("cameraPoseIntervalUs",160000)):
            bad=deepcopy(new);bad[key]=value;self.assertFalse(m.transition(old,bad)["supported"])
        bad=deepcopy(new);bad["tracks"].append(deepcopy(bad["tracks"][0]));bad["patches"].append(deepcopy(bad["patches"][0]))
        with self.assertRaises(ValueError):m.validate_observation(bad)
        bad=deepcopy(new);bad["patches"][0]["sourceStd"]=2.999
        with self.assertRaises(ValueError):m.validate_observation(bad)

    def test_forged_sources_patches_geometry_and_events_fail_validation(self):
        rows,_=history();current=rows[-1]
        for kind in ("source","token","box","patch","transition","measurement","event"):
            bad=deepcopy(current);diag=bad["B"]["diagnostics"]
            if kind=="source":diag["identityObservation"]["sourceSha256"]="f"*64
            elif kind=="token":diag["identityObservation"]["token"]="forged"
            elif kind=="box":diag["identityObservation"]["tracks"][0]["xyxy"][0]+=1
            elif kind=="patch":diag["identityObservation"]["patches"][0]["values"][0]+=.1
            elif kind=="transition":diag["identityTransition"]["geometryMatrix"][0][0]=.999999
            elif kind=="measurement":diag["measurementSurfaceSha256"]="f"*64
            else:bad["B"]["events"][0]["linearLogGrowth"]+=.01
            with self.subTest(kind=kind),self.assertRaises(ValueError):m.validate_frame(bad,rows[:-1])


if __name__=="__main__":unittest.main()
