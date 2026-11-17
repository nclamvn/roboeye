"""Authored secondary-reference geometry tests, not traffic/image quality claims."""
from copy import deepcopy
from datetime import date
import json
import math
from pathlib import Path
import sys
import tempfile
import unittest

import numpy as np

ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
import assist_scene_m3u_review as m


def frame():
    return dict(intrinsics=[[400.,0.,400.],[0.,400.,300.],[0.,0.,1.]],
        cameraToWorld=np.eye(4).tolist(),nativeWidth=800,nativeHeight=600)


def decisions(widths=(100.,150.,210.)):
    return dict(sameIdentity=True,stableAspect=True,roles={role:dict(visibility='usable-visible-extent',
        box=dict(x=200.,y=200.,width=w,height=w))for role,w in zip(m.ROLES,widths,strict=True)})


class ReviewTests(unittest.TestCase):
    def test_exact_triple_uses_frozen_history_not_convenient_frame(self):
        rows=[dict(labelTimestampUs=t)for t in (0,200000,400000,600000,800000)]
        self.assertEqual([r['labelTimestampUs']for r in m.exact_triple(rows,800000)],[0,400000,800000])
        self.assertIsNone(m.exact_triple([dict(labelTimestampUs=t)for t in (0,400000,1000000)],1000000))
        self.assertIsNone(m.exact_triple(rows,900000))

    def test_native_delta_interval_is_conservative_after_projective_rotation(self):
        box=dict(x=200.,y=200.,width=100.,height=80.)
        h=np.array([[1.,.02,2.],[.01,1.,-3.],[.0004,.0002,1.]])
        bound=m.area_interval(box,h,(600,800))
        self.assertEqual(bound['deltaNativePixels'],3.)
        rng=np.random.default_rng(650721)
        for _ in range(50):
            edges=np.array([200.,200.,300.,280.])+rng.uniform(-3,3,4)
            p=np.array([[edges[0],edges[1]],[edges[2],edges[1]],[edges[2],edges[3]],[edges[0],edges[3]]])
            q=np.column_stack((p,np.ones(4)))@h.T;area=m._area(q[:,:2]/q[:,2:])
            self.assertLessEqual(bound['lowerAreaPx2'],area+1e-8);self.assertGreaterEqual(bound['upperAreaPx2'],area-1e-8)

    def test_any_contracting_leg_is_contrary_to_sustained_growth_not_moving_away(self):
        result=m.extent_result([frame()for _ in range(3)],decisions())
        self.assertEqual(result['status'],'concordant')
        result=m.extent_result([frame()for _ in range(3)],decisions((180.,100.,200.)))
        self.assertEqual(result['status'],'contrary-to-sustained-two-leg-expansion')
        self.assertIn('does not mean object moving away',result['scope'])
        self.assertFalse(result['changesRadialTruth']);self.assertFalse(result['materialPointTruth'])

    def test_uncertain_clipped_occluded_identity_and_aspect_abstain(self):
        frames=[frame()for _ in range(3)]
        self.assertEqual(m.extent_result(frames,decisions((100.,102.,104.)))['status'],'unknown')
        for key in ('sameIdentity','stableAspect'):
            d=decisions();d[key]=False;self.assertEqual(m.extent_result(frames,d)['status'],'unknown')
        for visibility in ('clipped','occluded','unknown'):
            d=decisions();d['roles']['mid']['visibility']=visibility
            self.assertEqual(m.extent_result(frames,d)['status'],'unknown')
        self.assertEqual(m.extent_result(None,decisions())['status'],'unknown')

    def test_pose_rotation_not_translation_used_by_extent_homography(self):
        old,new=frame(),frame();angle=.1;r=np.array([[math.cos(angle),0,math.sin(angle)],[0,1,0],[-math.sin(angle),0,math.cos(angle)]])
        new['cameraToWorld']=np.eye(4).tolist();new['cameraToWorld']=[list(row)for row in new['cameraToWorld']]
        for i in range(3):new['cameraToWorld'][i][:3]=r[i].tolist()
        h=m.rotation_homography(old,new);q=h@np.array([400.,300.,1.])
        self.assertAlmostEqual(q[0]/q[2],400.-400.*math.tan(angle),places=10)
        moved=deepcopy(new);moved['cameraToWorld'][0][3]=100.
        self.assertTrue(np.array_equal(h,m.rotation_homography(old,moved)))

    def test_bad_native_box_and_edge_uncertainty_not_clamped(self):
        with self.assertRaises(ValueError):m.area_interval(dict(x=10.,y=10.,width=0.,height=10.),np.eye(3),(100,100))
        self.assertEqual(m.area_interval(dict(x=1.,y=10.,width=20.,height=20.),np.eye(3),(100,100))['status'],'uncertainty-crosses-image-edge')
        self.assertEqual(m.area_interval(dict(x=10.,y=10.,width=5.,height=5.),np.eye(3),(100,100))['status'],'uncertainty-consumes-visible-box')

    def test_bind_requires_source_seal_and_every_role_no_primary_changes(self):
        with tempfile.TemporaryDirectory(prefix='codex-tmp-m3u-review-'+date.today().strftime('%Y%m%d')+'-')as folder:
            root=Path(folder);p=root/'proposals.json';d=root/'decisions.json'
            proposal=dict(inputSha256='0'*64,sourceCodeSha256=m.code_hashes(),policy=m.POLICY,
                units=[dict(key='authored:1',instance='authored',triple=[frame()for _ in range(3)],panels=[])])
            p.write_text(json.dumps(proposal));review=dict(proposalsSha256=m.sha(p),inputSha256='0'*64,units={'authored:1':decisions()})
            d.write_text(json.dumps(review));result=m.bind(p,d,root/'bound.json')
            self.assertFalse(result['primaryRadialTruthChanged']);self.assertEqual(result['counts'],{'concordant':1})
            del review['units']['authored:1']['roles']['mid'];d.write_text(json.dumps(review))
            with self.assertRaisesRegex(ValueError,'three-role'):m.bind(p,d,root/'bad.json')
            review['proposalsSha256']='1'*64;d.write_text(json.dumps(review))
            with self.assertRaisesRegex(ValueError,'Unbound'):m.bind(p,d,root/'bad2.json')


if __name__=='__main__':unittest.main()
