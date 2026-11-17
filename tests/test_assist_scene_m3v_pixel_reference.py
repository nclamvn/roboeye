"""Authored pixel-reference integrity tests; no empirical matcher quality claim."""
from contextlib import redirect_stdout
from copy import deepcopy
from datetime import date
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
import assist_scene_m3v_pixel_reference as m


def selections(empty=False):
    return [dict(cell=[i%4,i//4],sourceCandidate=None if empty and i==0 else[300.+(i%4)*612,300.+(i//4)*682],
        sourceTextureScore=None if empty and i==0 else 1.,split='analysis'if(i%4+i//4)%2==0 else'holdout')for i in range(12)]


def input_fixture(root):
    clips=[]
    for clip in('boreas-m3u-city','boreas-m3u-turn'):
        clips.append(dict(id=clip,frames=[dict(path=f'{clip}-{i}.png',token=f'{clip}-{i}',sha256='0'*64,timestampUs=1000000+i*80000)for i in range(50)]))
    path=root/'input.json';path.write_text(json.dumps(dict(assetRoot='.',clips=clips)))
    return path


class PixelReferenceTests(unittest.TestCase):
    def temporary(self):return tempfile.TemporaryDirectory(prefix='codex-tmp-m3v-test-'+date.today().strftime('%Y%m%d')+'-')

    def test_native_source_selector_one_per_fixed_cell_no_target_parameter(self):
        gray=np.zeros((2048,2448),np.uint8)
        for row in range(3):
            for col in range(4):
                x,y=col*612+300,row*682+300;gray[y:y+20,x:x+20]=120+10*col
        slots,population=m.choose_source(gray)
        self.assertEqual(len(slots),12);self.assertGreaterEqual(population,12)
        self.assertEqual(sum(s['split']=='analysis'for s in slots),6)
        self.assertEqual(sum(s['split']=='holdout'for s in slots),6)
        for s in slots:self.assertIsNotNone(s['sourceCandidate'])
        empty,n=m.choose_source(np.zeros_like(gray));self.assertEqual(n,0)
        self.assertTrue(all(s['sourceCandidate']is None for s in empty))

    def test_source_plan_never_reads_target_and_source_seal_bites(self):
        with self.temporary()as folder:
            root=Path(folder);inp=input_fixture(root);seen=[]
            def read(path,sha):seen.append(path.name);return Image.new('RGB',(2448,2048))
            with patch.object(m,'read_rgb',side_effect=read),patch.object(m,'choose_source',return_value=(selections(True),11)),redirect_stdout(io.StringIO()):
                p=m.source_plan(inp,root/'source')
            expected=[f'{clip}-{start}.png'for clip,start,end in m.PAIRS]
            self.assertEqual(seen,expected);self.assertEqual(p['targetPixelReads'],0)
            self.assertEqual(p['slotCount'],72);self.assertEqual(sum(s['sourceCandidate']is None for x in p['pairs']for s in x['slots']),6)
            file=root/'source/source-selection.json';sha=m.digest(file);self.assertEqual(m.validate_source(file,sha,inp),p)
            file.write_text(file.read_text()+' ')
            with self.assertRaisesRegex(ValueError,'seal mismatch'):m.validate_source(file,sha,inp)

    def test_source_split_or_slot_changes_cannot_pass_even_resealed(self):
        with self.temporary()as folder:
            root=Path(folder);inp=input_fixture(root)
            with patch.object(m,'read_rgb',return_value=Image.new('RGB',(2448,2048))),patch.object(m,'choose_source',return_value=(selections(),12)),redirect_stdout(io.StringIO()):m.source_plan(inp,root/'source')
            file=root/'source/source-selection.json';p=json.loads(file.read_text());p['pairs'][0]['slots'][0]['split']='holdout';file.write_text(json.dumps(p))
            with self.assertRaisesRegex(ValueError,'cell/split'):m.validate_source(file,m.digest(file),inp)

    def test_rectangle_native_inclusive_bounds_context_and_uncertainty(self):
        pair=dict(nativeWidth=2448,nativeHeight=2048);box=dict(x0=98.,y0=98.,x1=102.,y1=102.)
        self.assertEqual(m.rectangle(box,pair,[0,0,241,241]),box)
        for bad in(dict(x0=100,y0=100,x1=101,y1=101),dict(x0=-1,y0=0,x1=4,y1=4),dict(x0=98,y0=98,x1=300,y1=102)):
            with self.assertRaises(ValueError):m.rectangle(bad,pair,[0,0,241,241])

    def test_bind_preserves72_unknowns_or_manual_gold_without_flow(self):
        with self.temporary()as folder:
            root=Path(folder);inp=input_fixture(root)
            with patch.object(m,'read_rgb',return_value=Image.new('RGB',(2448,2048))),patch.object(m,'choose_source',return_value=(selections(True),11)),redirect_stdout(io.StringIO()):m.source_plan(inp,root/'source')
            src=root/'source/source-selection.json';s=m.digest(src)
            with patch.object(m,'read_rgb',return_value=Image.new('RGB',(2448,2048))),redirect_stdout(io.StringIO()):m.target_proposals(inp,src,s,root/'target')
            target=root/'target/target-proposals.json'
            slots={slot['id']:dict(status='unknown',reason='authored ambiguous feature')for pair in json.loads(src.read_text())['pairs']for slot in pair['slots']}
            slots['pair0-cell01']=dict(status='accepted-static-match',reason='authored clear corner',staticEvidence='rigid facade',materialIdentity='same T junction',sameSelectedFeature=True,sourceRectangle=dict(x0=910.,y0=298.,x1=914.,y1=302.),targetRectangle=dict(x0=912.,y0=299.,x1=916.,y1=303.))
            d=root/'annotations.json';d.write_text(json.dumps(dict(inputSha256=m.digest(inp),sourceSelectionSha256=s,targetProposalsSha256=m.digest(target),slots=slots)))
            bound=m.bind(inp,src,s,target,m.digest(target),d,root/'gold.json')
            self.assertEqual(bound['slotCount'],72);self.assertEqual(bound['counts'],{'unknown':71,'accepted-static-match':1})
            self.assertEqual(bound['flowCalls'],0);self.assertEqual(bound['modelCalls'],0)
            forged=json.loads(d.read_text());forged['slots']['pair0-cell00']=deepcopy(slots['pair0-cell01']);d.write_text(json.dumps(forged))
            with self.assertRaisesRegex(ValueError,'No gold for empty'):m.bind(inp,src,s,target,m.digest(target),d,root/'forged-empty.json')
            del slots['pair5-cell11'];payload=json.loads(d.read_text());payload['slots']=slots;d.write_text(json.dumps(payload))
            with self.assertRaisesRegex(ValueError,'All72'):m.bind(inp,src,s,target,m.digest(target),d,root/'bad.json')
            badtarget=json.loads(target.read_text());badtarget['pairs']=[];target.write_text(json.dumps(badtarget))
            with self.assertRaisesRegex(ValueError,'target pair inventory'):m.bind(inp,src,s,target,m.digest(target),d,root/'bad-target.json')

    def test_empty_source_slot_cannot_be_laundered_into_manual_gold(self):
        self.assertTrue(m.POLICY['noBackfill']);self.assertFalse(m.POLICY['fullCameraCertification'])
        self.assertEqual(m.native_rect([100.,200.],40),[60,160,141,241])
        source=Path(m.__file__).read_text()
        self.assertNotIn('calcOpticalFlow',source);self.assertNotIn('GlobalRaft',source)


if __name__=='__main__':unittest.main()
