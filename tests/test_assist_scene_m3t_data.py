"""Authored transport/import contracts, no real network or camera-quality claim."""
from copy import deepcopy
from contextlib import redirect_stdout
from datetime import date
import gzip
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import cv2
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import fetch_assist_scene_m3t_tum as fetcher
import assist_scene_m3t_tum_import as importer
TMP_PREFIX='codex-tmp-m3t-test-'+date.today().strftime('%Y%m%d')+'-'


def quiet_import(root,output):
    captured=io.StringIO()
    with redirect_stdout(captured):result=importer.import_slice(root,output)
    # Exercise the CLI summary without leaking buffered fixture JSON after the
    # unittest completion marker used by the strict structural QA collector.
    assert json.loads(captured.getvalue())['pairs']==48
    return result


class Response(io.BytesIO):
    status=200
    def __init__(self,body,etag='fixed'):
        super().__init__(body);self.headers={'ETag':etag,'Content-Length':str(len(body))}


def png(depth=False):
    raw=np.zeros((480,640),np.uint16)if depth else np.zeros((480,640,3),np.uint8)
    ok,body=cv2.imencode('.png',raw);assert ok
    return body.tobytes()


def archive_fixture(link=False):
    ident='authored';root='rgbd_dataset_freiburg3_'+ident;times=[1000000+i*100000 for i in range(3)]
    members={};index={k:[]for k in ('rgb','depth')}
    for kind in index:
        for t in times:
            text=f'{t/1e6:.6f}';name=f'{kind}/{text}.png';members[root+'/'+name]=png(kind=='depth')
            index[kind].append(f'{text} {name}')
        members[root+'/'+kind+'.txt']=('\n'.join(index[kind])+'\n').encode()
    gt=b'# authored metadata\n';members[root+'/groundtruth.txt']=gt
    buffer=io.BytesIO()
    with tarfile.open(fileobj=buffer,mode='w')as tar:
        if link:
            entry=tarfile.TarInfo(root+'/link');entry.type=tarfile.SYMTYPE;entry.linkname='/outside';tar.addfile(entry)
        for name,body in members.items():
            entry=tarfile.TarInfo('./'+name);entry.size=len(body);tar.addfile(entry,io.BytesIO(body))
    body=gzip.compress(buffer.getvalue())
    sequence=dict(id=ident,archiveUrl='https://authored.invalid/data',archiveBytes=len(body),archiveETag='fixed',groundtruthSha256=fetcher.digest(gt))
    return body,sequence,times


def import_fixture(root,unavailable=False):
    plan=json.loads((ROOT/'docs/evidence/tip65/m3t-data-plan.json').read_text());files=[];sequences=[]
    bodies={'rgb':png(),'depth':png(True)}
    def add(rel,data):
        path=root/rel;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
        files.append(dict(path=rel,bytes=len(data),sha256=fetcher.digest(data)))
    for s in plan['sequences']:
        frames=[];indexes={k:[]for k in ('rgb','depth')};poses=[]
        for i,at in enumerate(s0+offset for s0 in s['windowStartsUs']for offset in fetcher.OFFSETS):
            frame=dict(id=f"{s['id']}-{i:02d}",nominalTimestampUs=at,association=dict(status='valid',deltaUs=1000))
            for kind,stamp in (('rgb',at),('depth',at+1000)):
                text=f'{stamp//1000000}.{stamp%1000000:06d}';rel=f"{s['id']}/{kind}/{text}.png"
                add(rel,bodies[kind]);indexes[kind].append(f'{text} {kind}/{text}.png')
                frame[kind]=dict(timestampUs=stamp,sourceMember='rgbd_dataset_freiburg3_'+s['id']+'/'+kind+'/'+text+'.png',**({'status':'available'}if kind=='rgb'else{}))
                if not(unavailable and i==0):poses.append((stamp,f'{text} 0 0 0 0 0 0 1'))
            frames.append(frame)
        poses.sort();gt=('\n'.join(row for _,row in poses)+'\n').encode()
        s.update(groundtruthSha256=fetcher.digest(gt),groundtruthBytes=len(gt),poseRows=len(poses),firstPoseTimestampUs=poses[0][0],lastPoseTimestampUs=poses[-1][0])
        add(s['id']+'/groundtruth.txt',gt)
        for kind in indexes:add(s['id']+'/'+kind+'.txt',('\n'.join(indexes[kind])+'\n').encode())
        sequences.append(dict(id=s['id'],frames=frames))
    raw=(json.dumps(plan,indent=2)+'\n').encode();seal=fetcher.digest(raw)
    record=dict(complete=True,planSha256=seal,planRawUtf8=raw.decode(),plan=plan,
        sourceCodeSha256=fetcher.digest(Path(fetcher.__file__).read_bytes()),files=files,sequences=sequences)
    (root/'slice.json').write_text(json.dumps(record))
    return seal,record


class DataTests(unittest.TestCase):
    def test_real_plan_is_sealed_before_any_images_and_fixed_strata(self):
        raw=(ROOT/'docs/evidence/tip65/m3t-data-plan.json').read_bytes();plan=fetcher.validate_plan(raw)
        self.assertEqual(plan['selection']['nominalPairsTotal'],48)
        self.assertEqual([fetcher.OFFSETS[b]-fetcher.OFFSETS[a]for a,b in fetcher.PAIRS],[100000,200000]*4)
        self.assertEqual(sum(s['archiveBytes']for s in plan['sequences']),731814825)
        self.assertLess(731814825+322099*2,fetcher.MAX_NETWORK)
        with self.assertRaisesRegex(ValueError,'plan changed'):fetcher.validate_plan(raw+b' ')

    def test_decimal_nearest_ties_and_timestamp_direction(self):
        self.assertEqual(fetcher.timestamp('1341839113.777000'),1341839113777000)
        with self.assertRaises(ValueError):fetcher.timestamp('1341839113.7770001')
        self.assertEqual(fetcher.nearest([(100,'a'),(200,'b')],150)[1],'ambiguous-nearest')
        self.assertEqual(fetcher.nearest([(100,'a')],201,100)[1],'nearest-too-far')
        pose=importer.own_pose([(1000000,[1,2,3,0,0,0,1])],1004000)
        self.assertEqual(pose['status'],'valid');self.assertEqual(pose['skewUs'],-4000)
        self.assertEqual(importer.own_pose([(1000000,[1,2,3,0,0,0,1])],1006000)['status'],'nearest-pose-exceeds5ms')
        self.assertEqual(importer.own_pose([(1000000,[0]*7),(1010000,[0]*7)],1005000)['status'],'ambiguous-nearest-pose')

    def test_pose_format_and_no_interpolation(self):
        rows=importer.parse_poses(b'# authored\n1.000000 0 0 0 0 0 0 1\n1.010000 1 0 0 0 0 0 1\n')
        self.assertEqual(importer.own_pose(rows,1001000)['translation'],[0.,0.,0.])
        for body in (b'1.000000 0 0 0 0 0 0 0\n',b'1.000000 nan 0 0 0 0 0 1\n',b'1.000000 0 0 0 0 0 0 1\n1.000000 0 0 0 0 0 0 1\n'):
            with self.assertRaises(ValueError):importer.parse_poses(body)

    def test_counted_reader_has_byte_and_time_teeth(self):
        state=dict(networkBytesReceived=0);reader=fetcher.CountedReader(io.BytesIO(b'abc'),state,float('inf'))
        self.assertEqual(reader.read(2),b'ab');self.assertEqual(state['networkBytesReceived'],2)
        with patch.object(fetcher,'MAX_NETWORK',2):
            with self.assertRaisesRegex(ValueError,'Network budget'):reader.read(2)
        with self.assertRaisesRegex(ValueError,'wall budget'):fetcher.CountedReader(io.BytesIO(b'x'),state,-1).read(1)

    def test_onepass_tar_selects_by_clock_and_validates_full_crc_without_archive(self):
        body,sequence,targets=archive_fixture()
        with tempfile.TemporaryDirectory(prefix=TMP_PREFIX)as folder:
            state=dict(networkBytesReceived=0,persistedSelectedBytes=0);progress={}
            with patch.object(fetcher,'urlopen',return_value=Response(body)):
                result=fetcher.stream_sequence(sequence,targets,Path(folder),state,float('inf'),progress)
            self.assertEqual(result['archiveBytes'],len(body));self.assertEqual(result['archiveSha256'],fetcher.digest(body))
            self.assertEqual(len(result['frames']),3)
            self.assertTrue(all(f['association']['status']=='valid'for f in result['frames']))
            self.assertEqual(state['networkBytesReceived'],len(body))
            self.assertEqual(len(list(Path(folder).rglob('*.png'))),6)
            self.assertEqual(list(Path(folder).rglob('*.tgz')),[])

    def test_crc_failure_retains_valid_candidates_and_does_not_retry(self):
        body,sequence,targets=archive_fixture();body=body[:-8]+b'broken!!'
        with tempfile.TemporaryDirectory(prefix=TMP_PREFIX)as folder:
            state=dict(networkBytesReceived=0,persistedSelectedBytes=0);progress={}
            with patch.object(fetcher,'urlopen',return_value=Response(body))as network:
                with self.assertRaises((gzip.BadGzipFile,EOFError)):
                    fetcher.stream_sequence(sequence,targets,Path(folder),state,float('inf'),progress)
            self.assertEqual(network.call_count,1)
            self.assertGreater(len(progress['validCandidateFilesRetained']),0)

    def test_unsafe_archive_and_candidate_cap_fail_closed(self):
        body,sequence,targets=archive_fixture(link=True)
        with tempfile.TemporaryDirectory(prefix=TMP_PREFIX)as folder:
            state=dict(networkBytesReceived=0,persistedSelectedBytes=0)
            with patch.object(fetcher,'urlopen',return_value=Response(body)):
                with self.assertRaisesRegex(ValueError,'links/devices'):fetcher.stream_sequence(sequence,targets,Path(folder),state,float('inf'),{})
        body,sequence,targets=archive_fixture()
        with tempfile.TemporaryDirectory(prefix=TMP_PREFIX)as folder:
            with patch.object(fetcher,'urlopen',return_value=Response(body)),patch.object(fetcher,'MAX_KEEP',1):
                with self.assertRaisesRegex(ValueError,'candidate byte cap'):fetcher.stream_sequence(sequence,targets,Path(folder),dict(networkBytesReceived=0,persistedSelectedBytes=0),float('inf'),{})
        with self.assertRaisesRegex(ValueError,'Unsafe tar'):fetcher.image_stamp('../rgb/1.000000.png','root')

    def test_metadata_candidates_never_substitute_selected_nearest_outcome(self):
        targets=[1000000];rows=[[]]
        rows=fetcher.candidates(rows,995000,'a',targets,'rgb')
        rows=fetcher.candidates(rows,1002000,'b',targets,'rgb')
        self.assertEqual(rows,[[(1002000,'b')]])
        rows=fetcher.candidates(rows,1000001,'outside',targets,'depth')
        self.assertEqual(len(rows[0]),2)

    def test_full_import_preserves48_pairs_54_frames_and_separate_sensor_poses(self):
        with tempfile.TemporaryDirectory(prefix=TMP_PREFIX)as folder:
            root=Path(folder);seal,_=import_fixture(root)
            with patch.object(fetcher,'PLAN_SHA256',seal):r=quiet_import(root,root/'input.json')
            self.assertEqual(r['pairs'],48);self.assertEqual(sum(len(s['frames'])for s in r['sequences']),54)
            self.assertEqual(r['modelCalls'],0);self.assertEqual(r['depthScale'],5000)
            for s in r['sequences']:
                for frame in s['frames']:
                    self.assertEqual(frame['depth']['pose']['timestampUs']-frame['rgb']['pose']['timestampUs'],1000)
                self.assertEqual([p['nominalIntervalUs']for p in s['pairs']],[100000,200000]*12)

    def test_unavailable_pose_stays_in_full_pair_denominator(self):
        with tempfile.TemporaryDirectory(prefix=TMP_PREFIX)as folder:
            root=Path(folder);seal,_=import_fixture(root,unavailable=True)
            with patch.object(fetcher,'PLAN_SHA256',seal):r=quiet_import(root,root/'input.json')
            self.assertEqual(r['pairs'],48);self.assertGreater(r['poseUnavailableObservations'],0)
            self.assertEqual(r['sequences'][0]['frames'][0]['rgb']['pose']['status'],'nearest-pose-exceeds5ms')

    def test_unavailable_nominal_rgb_is_not_fabricated_or_dropped(self):
        body,sequence,targets=archive_fixture();targets=[900000,*targets[1:]]
        with tempfile.TemporaryDirectory(prefix=TMP_PREFIX)as folder:
            with patch.object(fetcher,'urlopen',return_value=Response(body)):
                value=fetcher.stream_sequence(sequence,targets,Path(folder),dict(networkBytesReceived=0,persistedSelectedBytes=0),float('inf'),{})
            self.assertEqual(len(value['frames']),3)
            first=value['frames'][0]
            self.assertEqual(first['rgb']['status'],'unavailable')
            self.assertEqual(first['rgb']['timestampUs'],1000000)
            self.assertNotEqual(first['rgb']['timestampUs'],first['nominalTimestampUs'])
            self.assertEqual(first['association']['status'],'rgb-unavailable')
        with tempfile.TemporaryDirectory(prefix=TMP_PREFIX)as folder:
            root=Path(folder);seal,record=import_fixture(root);s=record['sequences'][0];ident=s['id']
            indexpath=root/ident/'rgb.txt';lines=indexpath.read_text().splitlines();indexpath.write_text('\n'.join(lines[1:])+'\n')
            item=next(x for x in record['files']if x['path']==ident+'/rgb.txt')
            item.update(bytes=indexpath.stat().st_size,sha256=fetcher.digest(indexpath.read_bytes()))
            nearest=s['frames'][1]['rgb'];s['frames'][0]['rgb']=dict(status='unavailable',reason='nearest-too-far',timestampUs=nearest['timestampUs'],sourceMember=nearest['sourceMember'])
            s['frames'][0]['depth']=None;s['frames'][0]['association']=dict(status='rgb-unavailable',deltaUs=None)
            (root/'slice.json').write_text(json.dumps(record))
            with patch.object(fetcher,'PLAN_SHA256',seal):r=quiet_import(root,root/'input.json')
            self.assertEqual(r['pairs'],48);self.assertEqual(sum(len(s['frames'])for s in r['sequences']),54)
            self.assertEqual(r['sequences'][0]['pairs'][0]['status'],'rgb-exposure-unavailable')
            self.assertIsNone(r['sequences'][0]['pairs'][0]['actualRgbIntervalUs'])

    def test_import_rejects_mutated_nominal_selection_and_source_bytes(self):
        for mutation in ('nominal','bytes','association'):
            with tempfile.TemporaryDirectory(prefix=TMP_PREFIX)as folder:
                root=Path(folder);seal,record=import_fixture(root)
                if mutation=='nominal':record['sequences'][0]['frames'][0]['nominalTimestampUs']+=1
                elif mutation=='association':record['sequences'][0]['frames'][0]['association']['status']='not-mutual-nearest'
                else:(root/record['files'][0]['path']).write_bytes(b'tampered')
                (root/'slice.json').write_text(json.dumps(record))
                with patch.object(fetcher,'PLAN_SHA256',seal):
                    with self.assertRaises(ValueError):quiet_import(root,root/'input.json')


if __name__=='__main__':unittest.main()
