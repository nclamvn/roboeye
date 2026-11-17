"""Authored interval/coordinate/seal controls, not road-model evidence."""
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
import sys
import unittest

import cv2
import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
import assist_scene_m3v_pixel_audit as m


def rect(x,y,r=0.):return dict(x0=x-r,y0=y-r,x1=x+r,y1=y+r)


class PixelAuditTests(unittest.TestCase):
    def test_known_R_t_projection_and_reverse_sign(self):
        k=np.array([[500.,0.,320.],[0.,510.,240.],[0.,0.,1.]])
        r,_=cv2.Rodrigues(np.array([.01,.02,-.01]));t=np.array([-.1,.02,.01]);point=np.array([.3,.4,3.])
        projected=r@point+t;x=k@point;y=k@projected
        source,target=rect(*(x[:2]/x[2])),rect(*(y[:2]/y[2]))
        f=m.fundamental(k,r,t);bound=m.residual_interval(f,source,target)
        self.assertEqual(bound["decision"],"pass")
        self.assertEqual(m.cheirality_interval(source,target,k,r,t)["decision"],"positive")
        self.assertEqual(m.cheirality_interval(source,target,k,r,-t)["decision"],"negative")
        reverse=m.residual_interval(-f,source,target)
        self.assertAlmostEqual(bound["upperWorkingPx"],reverse["upperWorkingPx"])

    def test_true_line_norm_minimum_interior_and_degenerate_epipole(self):
        f=np.array([[1.,0.,-1.],[0.,1.,-1.],[0.,0.,1.]])
        source=dict(x0=0.,y0=0.,x1=2.,y1=2.)
        lower,upper=m.line_norm_bounds(f,source)
        self.assertEqual(lower,0.);self.assertGreaterEqual(upper,np.sqrt(2))
        self.assertEqual(m.residual_interval(f,source,rect(4.,4.))["decision"],"unknown")
        for weights in ((0.,1.),(-1.,1.),(float('nan'),1.)):
            with self.assertRaises(ValueError):m.line_norm_bounds(f,source,weights)

    def test_interval_contains_dense_interior_and_threshold_crossing(self):
        k=np.array([[500.,0.,320.],[0.,510.,240.],[0.,0.,1.]])
        r,_=cv2.Rodrigues(np.array([.01,.02,-.01]));f=m.fundamental(k,r,np.array([-.1,.03,.02]))
        source=rect(380.,300.,2.);target=rect(370.,302.,3.)
        bound=m.residual_interval(f,source,target);rng=np.random.default_rng(651009)
        a=rng.uniform([378.,298.],[382.,302.],(4000,2));b=rng.uniform([367.,299.],[373.,305.],(4000,2))
        x=np.c_[a,np.ones(4000)];y=np.c_[b,np.ones(4000)];l1=x@f.T;l0=y@f
        values=np.abs(np.sum(y*l1,axis=1))/np.minimum(np.linalg.norm(l1[:,:2],axis=1),np.linalg.norm(l0[:,:2],axis=1))
        self.assertGreaterEqual(values.min(),bound["lowerWorkingPx"]-1e-9)
        self.assertLessEqual(values.max(),bound["upperWorkingPx"]+1e-9)
        horizontal=np.array([[0.,0.,0.],[0.,0.,-1.],[0.,1.,0.]])
        crossing=m.residual_interval(horizontal,rect(1.,0.),dict(x0=0.,y0=1.,x1=2.,y1=2.))
        self.assertEqual(crossing["decision"],"unknown")
        self.assertLess(crossing["lowerWorkingPx"],1.3);self.assertGreater(crossing["upperWorkingPx"],1.3)

    def test_anisotropic_metric_and_affine_conjugacy(self):
        k=np.array([[1460.98,0.,1230.],[0.,1460.93,1035.08],[0.,0.,1.]])
        r,_=cv2.Rodrigues(np.array([.003,.002,-.004]));t=np.array([-.1,.02,.03])
        source,target=rect(500.,800.,2.),rect(490.,805.,2.)
        f=m.fundamental(k,r,t);ad=m.resize_map(2448,2048,768,643,False);ac=m.resize_map(2448,2048,768,643,True)
        native=m.residual_interval(f,source,target,[1/ad[0,0],1/ad[1,1]])
        for a in (ad,ac):
            transformed=np.linalg.inv(a).T@f@np.linalg.inv(a)
            actual=m.residual_interval(transformed,m.transformed_rectangle(source,a),m.transformed_rectangle(target,a))
            self.assertAlmostEqual(native["lowerWorkingPx"],actual["lowerWorkingPx"],places=7)
            self.assertAlmostEqual(native["upperWorkingPx"],actual["upperWorkingPx"],places=7)
        self.assertAlmostEqual(ac[0,2],(768/2448-1)/2)

    def test_INTER_AREA_matches_discrete_footprint_not_false_exact_ramp_center(self):
        ramp=np.arange(8,dtype=np.float32)
        actual=cv2.resize(ramp.reshape(1,8),(3,1),interpolation=cv2.INTER_AREA).ravel()
        ratio=8/3
        expected=[m.area_footprint_mean(ramp,i*ratio-.5,(i+1)*ratio-.5)for i in range(3)]
        np.testing.assert_allclose(actual,expected,atol=1e-6)
        self.assertGreater(abs(float(actual[0])-(ratio*.5-.5)),.01)

    def test_clock_variants_keep_true_times_and_wrong_R_does_not_alias(self):
        frames=[]
        for i in range(50):
            pose=np.eye(4);r,_=cv2.Rodrigues(np.array([0.,i*.001,0.]));pose[:3,:3]=r;pose[0,3]=i*.01
            frames.append(dict(timestampUs=1_000_000+i*80000,poseTimestampUs=1_000_000+i*80000,cameraToWorld=pose.tolist()))
        k=np.array([[500.,0.,320.],[0.,500.,240.],[0.,0.,1.]])
        variants=m._variants(frames,13,14,k,np.diag([.3,.4,1.]),m.resize_map(100,100,30,40,True),lambda i:np.asarray(frames[i]["cameraToWorld"]))
        for v in variants:
            if v['name'].startswith('clock-'):
                self.assertFalse(v['runtimeEligible']);self.assertGreater(abs(v['sourceSkewUs']),20000)
                self.assertNotEqual(v['sourcePoseTimestampUs'],frames[13]['timestampUs'])
        transpose=next(v for v in variants if v['name']=='wrong-relative-R-transpose')
        reversed_t=next(v for v in variants if v['name']=='wrong-translation-sign')
        self.assertFalse(np.array_equal(transpose['old'][:3,:3],reversed_t['old'][:3,:3]))

    def test_source_gold_seals_all72_unknown_slots_and_no_replacement(self):
        selected=dict(inputSha256='a'*64,sourceOnly=True,targetPixelReads=0,codeSha256=m.digest(m.HERE/'assist_scene_m3v_pixel_reference.py'),pairs=[])
        fixed=[('boreas-m3u-city',i-1,i)for i in (14,22,30,38,46)]+[('boreas-m3u-turn',21,22)]
        for p,(clip,start,end)in enumerate(fixed):
            selected['pairs'].append(dict(id=f'pair{p}',clipId=clip,startIndex=start,endIndex=end,nativeWidth=2448,nativeHeight=2048,
                sourcePanels=['presentation-only'],slots=[dict(id=f'pair{p}-cell{i:02}',cell=[i%4,i//4],split='analysis'if(i%4+i//4)%2==0 else'holdout',
                    sourceCandidate=[100.,100.],sourceTextureScore=1.)for i in range(12)]))
        gold=deepcopy(selected);gold.update(sourceSelectionSha256='b'*64)
        for pair in gold['pairs']:
            pair.pop('sourcePanels')
            for slot in pair['slots']:slot['reference']=dict(status='unknown',reason='authored unavailable')
        m.validate_references(selected,gold,'a'*64,'b'*64)
        forged=deepcopy(gold);forged['pairs'][0]['slots'][0]['sourceCandidate'][0]+=1
        with self.assertRaisesRegex(ValueError,'slot-replaced'):m.validate_references(selected,forged,'a'*64,'b'*64)
        with self.assertRaisesRegex(ValueError,'seal-mismatch'):m.validate_references(selected,gold,'a'*64,'c'*64)
        selected['targetPixelReads']=1
        with self.assertRaisesRegex(ValueError,'read-target'):m.validate_references(selected,gold,'a'*64,'b'*64)

    def test_invalid_SHA_fails_before_reference_or_RGB_and_keeps_prefix(self):
        args=SimpleNamespace(**{k:v for name in ('input','receipt','reference','source_selection')for k,v in
            ((name,Path(__file__)),(name+'_sha256','0'*64))})
        with self.assertRaisesRegex(ValueError,'SHA-binding')as caught:m.run(args)
        prefix=caught.exception.m3v_progress
        self.assertEqual(prefix['completedPairs'],[]);self.assertEqual(prefix['actualLkDirections'],0)
        self.assertEqual(prefix['learnedModelCalls'],0);self.assertFalse(prefix['motionAuthorized'])

    def test_cancellation_margin_and_oracle_source_LK_has_no_target_input(self):
        f=np.array([[1.,0.,-2000.],[0.,1.,-1000.],[0.,0.,1.]])
        low,high=m.line_norm_bounds(f,rect(2000.,1000.,1e-8))
        self.assertEqual(low,0.);self.assertGreater(high,0.)
        cancelling=np.array([[1.,-1.,1e-6],[-1.,1.,-1e-6],[.001,-.001,1e-9]])
        interval=m.residual_interval(cancelling,rect(2000.,2000.),rect(2000.,2000.))
        # Large positive/negative products cancel. A margin based only on
        # final yFx would incorrectly imply almost exact certainty here.
        self.assertGreater(interval['upperWorkingPx'],.01)
        self.assertLessEqual(interval['lowerWorkingPx'],.001)
        image=np.random.default_rng(651010).integers(0,256,(100,100),np.uint8)
        result=m.query_lk(image,image,[[40.,40.]])
        self.assertEqual(result['directionCalls'],2);self.assertFalse(result['targetReferenceSeen'])
        self.assertTrue(result['points'][0]['accepted'])
        self.assertNotIn('target',result['points'][0])

    def test_sdk_passive_convention_and_projection_offset_equivalence(self):
        csv_row=[1_000_000,2.,3.,4.,0.,0.,0.,0.,0.,np.pi/2,0.,0.,0.]
        offset=np.array([.1,-.02,.03]);raw=m.sdk_pose(csv_row,np.zeros(3));optical=m.sdk_pose(csv_row,offset)
        np.testing.assert_allclose(raw[:3,:3],[[0.,1.,0.],[-1.,0.,0.],[0.,0.,1.]],atol=1e-12)
        k=np.array([[500.,0.,320.],[0.,510.,240.],[0.,0.,1.]])
        point_camera=np.array([.2,.3,4.,1.]);world=raw@point_camera
        projection=np.column_stack((k,k@offset))@np.linalg.inv(raw)@world
        equivalent=k@(np.linalg.inv(optical)@world)[:3]
        np.testing.assert_allclose(projection/projection[2],equivalent/equivalent[2],atol=1e-12)


if __name__=='__main__':unittest.main()
