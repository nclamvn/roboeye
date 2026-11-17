"""Authored M3U data preflight tests; no image/model/network execution."""
from copy import deepcopy
from contextlib import redirect_stdout
from datetime import date
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
import fetch_assist_scene_m3u_boreas as m


class Response(io.BytesIO):
    status=200
    def __init__(self,body,etag='authored'):
        super().__init__(body);self.headers={'ETag':etag}


class M3UDataTests(unittest.TestCase):
    def source(self):return ROOT/'native/ios/.build-xcode/scene-qa/boreas-m3r-slice'

    def setUp(self):
        # The real plan was sealed BEFORE its own runtime input existed. Replay
        # that prior-source snapshot in fixtures rather than treating the newly
        # generated M3U input as a pre-existing source and rejecting it forever.
        planpath=ROOT/'docs/evidence/tip65/m3u-data-plan.json'
        if planpath.exists():
            snapshot=json.loads(planpath.read_text())['priorInputFingerprints'];stamps=set()
            for name,digest in snapshot.items():
                path=Path(name);self.assertEqual(m.shared.digest(path.read_bytes()),digest)
                payload=json.loads(path.read_text())
                stamps.update(f['timestampUs']for c in payload.get('clips',[])for f in c.get('frames',[])if f.get('token','').startswith('boreas-'))
            planning=patch.object(m,'previous_inputs',return_value=(snapshot,stamps))
            planning.start();self.addCleanup(planning.stop)

    def test_fixed_cached_windows_100_and_disjoint_all_retained_inputs(self):
        values=m.shared.metadata(self.source());clips=m.select(values[m.shared.METADATA[0]])
        old,stamps=m.previous_inputs(self.source().parent)
        selected=[s for c in clips for s in c['cameraTimestampsUs']]
        self.assertEqual(len(selected),100);self.assertEqual(len(set(selected)),100)
        self.assertFalse(set(selected)&stamps);self.assertGreaterEqual(len(stamps),1699)
        self.assertEqual([(c['cameraTimestampsUs'][0],c['cameraTimestampsUs'][-1])for c in clips],[(x[2],x[3])for x in m.WINDOWS])
        self.assertTrue(old)

    def test_label_listing_exact_population_and_missing_label_reject(self):
        prefix=m.shared.old.SEQ+'labels_detection/'
        stamps=[1000000000000000+i*200000 for i in range(20)]
        body=('<ListBucketResult>'+''.join(f'<Contents><Key>{prefix}{s}.txt</Key></Contents>'for s in stamps)+'</ListBucketResult>').encode()
        with patch.object(m,'urlopen',return_value=Response(body))as network:
            result,note=m.label_listing(stamps[0],stamps[-1])
        self.assertEqual(result,stamps);self.assertEqual(note['bytes'],len(body));self.assertEqual(network.call_count,1)
        with patch.object(m,'urlopen',return_value=Response(b'<ListBucketResult/>')):
            with self.assertRaisesRegex(ValueError,r'18\+'):m.label_listing(stamps[0],stamps[-1])

    def test_plan_seals_heads_metadata_and_prior_sources_no_rgb(self):
        with tempfile.TemporaryDirectory(prefix='codex-tmp-m3u-test-'+date.today().strftime('%Y%m%d')+'-')as folder:
            out=Path(folder)/'plan.json'
            def labels(a,b):return [a+i*200000 for i in range(20)],dict(bytes=1,sha256='0'*64,url='authored://labels')
            with patch.object(m,'label_listing',side_effect=labels),patch.object(m.shared,'head_image',side_effect=lambda s:dict(path=f'camera/{s}.png',bytes=1000,etag='authored')):
                with redirect_stdout(io.StringIO()):result=m.plan(self.source(),out)
            expected=m.shared.digest(out.read_bytes());bound,_=m.validate_plan(out.read_bytes(),expected)
            self.assertEqual(bound['rgbTransfers'],0);self.assertEqual(result['headImageBytes'],100000)
            with self.assertRaisesRegex(ValueError,'plan changed'):m.validate_plan(out.read_bytes()+b' ',expected)
            altered=deepcopy(result);altered['imageHeads'][0]['path']='camera/wrong.png';raw=json.dumps(altered).encode()
            with self.assertRaisesRegex(ValueError,'HEAD population'):m.validate_plan(raw,m.shared.digest(raw))
            altered=deepcopy(result);altered['retainedBudgetBytes']+=1;raw=json.dumps(altered).encode()
            with self.assertRaisesRegex(ValueError,'scope/budgets'):m.validate_plan(raw,m.shared.digest(raw))

    def test_unseen_source_and_budget_fail_before_any_fetch(self):
        with tempfile.TemporaryDirectory(prefix='codex-tmp-m3u-test-'+date.today().strftime('%Y%m%d')+'-')as folder:
            out=Path(folder)/'plan.json'
            with patch.object(m,'previous_inputs',return_value=({}, {m.WINDOWS[0][2]})),patch.object(m,'label_listing')as network:
                with self.assertRaisesRegex(ValueError,'overlaps prior'):m.plan(self.source(),out)
                self.assertFalse(network.called)
            def labels(a,b):return [a+i*200000 for i in range(20)],dict(bytes=1,sha256='0'*64,url='authored://labels')
            with patch.object(m,'label_listing',side_effect=labels),patch.object(m.shared,'head_image',side_effect=lambda s:dict(path=f'camera/{s}.png',bytes=8*1024**2,etag='authored')):
                with self.assertRaisesRegex(ValueError,'retained-source budget'):m.plan(self.source(),out)
            self.assertFalse(out.exists())

    def test_disk_floor_precedes_network_and_no_retry_contract(self):
        with tempfile.TemporaryDirectory(prefix='codex-tmp-m3u-test-'+date.today().strftime('%Y%m%d')+'-')as folder:
            with patch.object(m.shutil,'disk_usage',return_value=type('Disk',(),dict(free=1))()),patch.object(m,'urlopen')as network:
                with self.assertRaisesRegex(ValueError,'Disk floor'):m.fetch(Path('missing-plan'),'0'*64,Path(folder)/'slice')
                self.assertFalse(network.called)
        self.assertEqual(m.MAX_SECONDS,600);self.assertEqual(m.RETAIN_BUDGET,420*1024**2)

    def test_mock_fetch_counts_exact_sources_and_failure_prefix_without_retry(self):
        png=b'\x89PNG\r\n\x1a\n'+b'\x00\x00\x00\x00IEND\xaeB`\x82'
        for broken in (False,True):
            with tempfile.TemporaryDirectory(prefix='codex-tmp-m3u-test-'+date.today().strftime('%Y%m%d')+'-')as folder:
                root=Path(folder);planpath=root/'plan.json'
                def labels(a,b):return [a+i*200000 for i in range(20)],dict(bytes=1,sha256='0'*64,url='authored://labels')
                with patch.object(m,'label_listing',side_effect=labels),patch.object(m.shared,'head_image',side_effect=lambda s:dict(path=f'camera/{s}.png',bytes=len(png),etag='authored')),redirect_stdout(io.StringIO()):m.plan(self.source(),planpath)
                seal=m.shared.digest(planpath.read_bytes());calls=[]
                first=m.WINDOWS[0][2]
                def source(request,timeout):
                    calls.append(request.full_url)
                    body=png if request.full_url.endswith('.png')else b'authored-label'
                    if broken and request.full_url.endswith(f'{first}.png'):body=b'x'*len(png)
                    return Response(body)
                with patch.object(m,'urlopen',side_effect=source),redirect_stdout(io.StringIO()):
                    if broken:
                        with self.assertRaisesRegex(RuntimeError,'valid prefix'):m.fetch(planpath,seal,root/'slice')
                        receipt=json.loads((root/'slice/fetch-incomplete.json').read_text());self.assertFalse(receipt['complete'])
                        self.assertGreater(receipt['failedTransfers'],0)
                    else:
                        receipt=m.fetch(planpath,seal,root/'slice');self.assertTrue(receipt['complete'])
                        self.assertEqual(receipt['imageBytesReceived'],100*len(png));self.assertEqual(len(receipt['files']),143)
                self.assertEqual(receipt['networkRetries'],0);self.assertEqual(receipt['modelCalls'],0)
                self.assertEqual(len(calls),len(set(calls)))


if __name__=='__main__':unittest.main()
