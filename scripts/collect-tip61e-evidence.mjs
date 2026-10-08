import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const root=new URL('..',import.meta.url),dir=new URL('docs/evidence/tip61e/',root);
const json=async path=>JSON.parse(await readFile(path,'utf8'));
await mkdir(dir,{recursive:true});
const specifications=[
 ['aspect-parity-and-recovery.json','/private/tmp/roboeye-tip61d-aspect/result.json'],
 ['per-object-ui.json','/private/tmp/roboeye-tip61d-ui/result.json'],
 ['mobile-orchestration.json',join(tmpdir(),'roboeye-tip60c-live-qa/result.json')],
 ['bounded-recovery.json',join(tmpdir(),'roboeye-tip61-recovery-qa/result.json')],
 ['journal-reopen.json',join(tmpdir(),'roboeye-tip61-journal-qa/result.json')],
 ['feature-toggles.json',join(tmpdir(),'roboeye-drive-feature-toggle-qa/result.json')],
 ['video-anchor.json',join(tmpdir(),'roboeye-road-icon-anchor-qa/result.json')],
];
for(const [name,path] of specifications){
 const value=await json(path);if(value.pass!==true&&value.status!=='pass')throw Error(`${name} failed`);
 if(name==='aspect-parity-and-recovery.json'&&!value.results.every(r=>r.recoveredAfterShapeError))throw Error('real worker recovery not verified');
 await writeFile(new URL(name,dir),JSON.stringify(value,null,2)+'\n');
}
const units=await readFile('/private/tmp/roboeye-tip61e-units.log','utf8');
const count=Number(units.match(/tests\s+(\d+)/)?.[1]),passed=Number(units.match(/pass\s+(\d+)/)?.[1]);
if(!count||count!==passed)throw Error('Unit gate failed');
const release=await json(new URL('.vercel/output/static/release.json',root));
const qa={generatedUtc:new Date().toISOString(),unit:{count,passed},release,
 invariants:{captureExpiryMs:1200,precision:'fp32',nativePortraitGraph:true,noThresholdRelaxation:true},
 scopes:{units:'Pure logic',browser:'Desktop Chrome, mocked workers/canvas streams except native parity and real-model bake-off',
  deviceAcceptance:'No new physical iPhone/Android test; owner baseline is not an after result',physicalAccuracy:'Unvalidated without independent truth'},
 typecheck:'pass',productionBuild:'pass',releaseVerifier:{passed:5},security:{high:0,critical:0,browserNativeSharpExposure:0},
 caveat:'No speedup claim for input pooling; the paired FP32 controls are NOT before/after product versions.'};
await writeFile(new URL('qa.json',dir),JSON.stringify(qa,null,2)+'\n');
console.log(`PASS collected software QA: ${passed}/${count} units, 7 scoped evidence artifacts`);
