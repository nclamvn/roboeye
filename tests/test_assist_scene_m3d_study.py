import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from assist_scene_boreas_review_2d import bind, trend
from assist_scene_m3d_study import BoxBaseline, score
from assist_scene_motion import Detection


class M3DStudyTest(unittest.TestCase):
    def test_reference_separates_relative_from_unknown(self):
        for data,want in [((12,11,10),'approaching'),((12,12,12),'not-approaching'),
                          ((12,11.95,11.65),'unknown'),((12,12.1,12.5),'not-approaching')]:
            self.assertEqual(trend(list(zip((0,400_000,800_000),data)),800_000),want)
        self.assertEqual(trend([(0,12),(200_000,10)],200_000),'unknown')

    def test_manifest_review_requires_selection_and_bound_bytes(self):
        with tempfile.TemporaryDirectory() as wd:
            w=Path(wd)
            p,q,o=[w/x for x in ('candidates.json','checked.json','output.json')]
            p.write_text(json.dumps(dict(inputSha256='input',rows=[dict(key='k',clip='c',token='f',timestampUs=5,
                size=[100,100],candidates=[dict(instance='i',motion='stationary',approach='approaching')])])))
            check=dict(inputSha256='input',candidatesSha256=hashlib.sha256(p.read_bytes()).hexdigest(),
                       review='test-only',frames={'k':{}})
            q.write_text(json.dumps(check))
            with self.assertRaisesRegex(ValueError,'Every candidate'):
                bind(p,q,o)
            check['frames']['k']['1']=[10,20,60,70]
            q.write_text(json.dumps(check)); bind(p,q,o)
            self.assertEqual(json.loads(o.read_text())['clips'][0]['frames'][0]['targets'][0]['box']['x'],.1)
            p.write_text(p.read_text()+'\n')
            with self.assertRaisesRegex(ValueError,'revision'):
                bind(p,q,o)

    def test_scoring_uses_distinct_truth_for_world_motion_and_approach(self):
        box=dict(x=.1,y=.1,width=.3,height=.3)
        tracks=[dict(id=1,label='car',box=box)]
        notice=dict(trackId=1,label='car',epoch=0,timeMs=30)
        state=dict(epoch=0,tracks=tracks,events=[notice],status='valid',answers={'distance':{'metres':None}})
        other={**box,'x':.6}
        frame=dict(token='f',timeMs=30,timestampUs=1000,timingsMs={k:1 for k in ('detector','A','B','C','D','S')})
        frame.update({k:state if k in 'ABC' else {**state,'events':[{**notice,'kind':'relative-optical-approach'}]} for k in 'ABCDS'})
        truth=dict(schemaVersion=1,inputSha256='in',reviewSha256='review',clips=[dict(id='c',frames=[dict(token='f',timestampUs=1000,targets=[
            dict(instance='i',classFamily='vehicle',motion='stationary',approach='approaching',box=box),
            dict(instance='j',classFamily='vehicle',motion='moving',approach='not-approaching',box=other)])])])
        res=score(dict(schemaVersion=1,inputSha256='in',clips=[dict(id='c',frames=[frame])]),truth)['totals']
        self.assertEqual((res['C']['fp'],res['C']['fn'],res['D']['tp'],res['D']['tn']),(1,1,1,1))

    def test_bbox_baseline_loses_track_after_gap(self):
        lane=BoxBaseline(); image=np.zeros((200,300),np.uint8)
        for i in range(5):
            res=lane.update({},i*100,image,[Detection('car',.8,(100-i,80-i,140+i,120+i))])
        self.assertEqual(len(res['events']),1)
        self.assertEqual(lane.update({},1000,image,[Detection('car',.8,(80,60,160,140))])['events'],[])
