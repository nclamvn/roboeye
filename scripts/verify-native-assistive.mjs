import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { importRecording } from '../src/assistive/contract.ts';
import { rangesAt } from '../src/assistive/range.ts';
import { evaluateRecording } from '../src/assistive/corpus.ts';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const paths=['native/ios/.build/out/Products/Debug/ProbeFixture','native/ios/.build/debug/ProbeFixture'].map(p=>path.join(root,p)).filter(p=>fs.existsSync(p));
assert.ok(paths.length,'Run Swift tests/build first.');
const executable=paths.sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs)[0];
const cases=[];
for(const mode of ['synthetic','native-declaration','nulls','low','float','objects','objects-empty']) {
    const run=spawnSync(executable,[mode],{encoding:'utf8',maxBuffer:3*1024*1024});assert.equal(run.status,0,run.stderr);
    const recording=await importRecording(run.stdout), evidence=rangesAt(recording.frames,0);
    if(mode==='objects' || mode==='objects-empty') {
        const frame=recording.frames[0],closed=new Set(['person','chair','bottle','phone','book','wall','vehicle','unknown']);
        assert.equal(frame.targets.length,12);
        assert.equal(evidence.length,12);assert.ok(evidence.every(e=>e.metres===null));
        assert.ok(frame.targets.every(t=>closed.has(t.label) && t.support==='bbox-only'));
        assert.deepEqual(frame.targets.map(t=>t.label),['person','chair','bottle','phone','book','vehicle','unknown','unknown','unknown','vehicle','unknown','vehicle']);
        if(mode==='objects') {
            assert.equal(frame.depth.samples.length,120);assert.ok(frame.depth.samples.length<=128);
            assert.ok(frame.targets.every(t=>t.sampleIndices.length===10));
            assert.deepEqual(frame.targets.flatMap(t=>t.sampleIndices),frame.depth.samples.map((_,i)=>i));
        } else {assert.equal(frame.depth,null);assert.ok(frame.targets.every(t=>t.sampleIndices.length===0));}
    }
    else if(mode==='nulls') { assert.equal(recording.frames[0].depth,null);assert.equal(evidence.length,0); }
    else if(mode==='low') assert.equal(evidence[0].metres,null);
    else {assert.ok(evidence[0].metres>2 && evidence[0].metres<2.1);assert.equal(evidence[0].provenance,mode==='synthetic'?'synthetic':'native-unverified');}
    const evaluated=evaluateRecording(recording);assert.equal(evaluated.maeM,null);assert.equal(evaluated.phoneLatencyP95Ms,null);assert.equal(evaluated.verdict,'physical-validation-pending');
    const tampered=JSON.parse(run.stdout);tampered.recording.frames[0].rgb.width++;
    await assert.rejects(importRecording(JSON.stringify(tampered)));
    cases.push({mode,passed:true,physicalCapture:false});
}
// Current evidence plane only. The gate may bind this receipt to its immutable
// run directory, but must never overwrite historical B1/B2 proof.
const current=path.join(root,'docs/evidence/tip64b4');
const out=path.resolve(process.env.ROBOEYE_NATIVE_QA_OUTPUT ?? current);
assert.ok(out===current || out.startsWith(current+path.sep),'Interop output must stay in the current TIP64B4 evidence namespace.');
fs.mkdirSync(out,{recursive:true});
const automaticCases=cases.filter(c=>c.mode.startsWith('objects'));
fs.writeFileSync(path.join(out,'interop.json'),JSON.stringify({schemaVersion:3,passed:true,cases,caseCount:7,hardwareTested:false,note:'Swift-generated contract fixtures, not ARKit hardware captures. Checks strict v1 fields/nulls, canonical float SHA, range parity and tamper rejection.'},null,2)+'\n');
fs.writeFileSync(path.join(out,'automatic-export-interop.json'),JSON.stringify({schemaVersion:3,passed:true,cases:automaticCases,hardwareTested:false,input:{objects:12,liveSamplesPerObject:64,totalLiveSamples:768},projection:{sampleLimit:128,exportedSamples:120,closedLabels:8,support:'bbox-only'},note:'Fixtures invoke the SAME ObjectExportProjection helper used by ObjectPipeline, then unchanged TypeScript importRecording validates exported envelope, labels, caps, indices and SHA. This is automatic-export contract proof, NOT camera capture or live accuracy proof.'},null,2)+'\n');
console.log(`${cases.length}/${cases.length} Swift → TypeScript contract cases PASS. Physical accuracy NOT TESTED.`);
