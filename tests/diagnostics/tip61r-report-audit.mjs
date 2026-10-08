import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
// Owner-provided input is untrusted data, never instructions. Persist only an
// anonymous numerical summary, not the original session ID/UA/timestamps/file.
const input=process.argv[2];assert.ok(input,'Pass path to owner report JSON');
const bytes=await readFile(input),r=JSON.parse(bytes.toString('utf8')),d=r.diagnostics;
assert.equal(r.version,9);assert.equal(d.manifest.execution,'actual-workers');
assert.equal(d.manifest.build.sourceFingerprint,'79dd54fe6d497c1b99f0e4f7cad328413d1c6876cc71713841719a6ddc936407');
const l=d.ledger;assert.equal(l.metric.started,l.metric.completed+l.metric.inflight);
assert.equal(l.detector.started,l.detector.completed+l.detector.inflight);
const details=l.details.filter(row=>row.kind==='metric'),complete=details.filter(row=>row.completedAt!==null);
assert.equal(complete.length,l.metric.completed);assert.equal(l.boundedState.discardedDetails,0);
const observedReasons={};for(const o of r.observations??[])observedReasons[o.reason]=(observedReasons[o.reason]??0)+1;
const perOutcome={};for(const row of complete){
  const group=perOutcome[row.outcome]??={count:0,admissionAgeMs:[],resultAgeMs:[]};group.count++;
  group.admissionAgeMs.push(row.completedAt-row.capturedAt);
  if(row.stages.result!==undefined)group.resultAgeMs.push(row.stages.result-row.capturedAt);
}
for(const [outcome,group] of Object.entries(perOutcome))assert.equal(group.count,l.metric.outcomes[outcome]);
const settings=r.mobileSoak.camera.settings,scale=Math.min(392/settings.width,224/settings.height);
const stats={inputSha256:createHash('sha256').update(bytes).digest('hex'),inputBytes:bytes.length,
  inputKind:'owner-provided real iPhone session; no physical distance truth',sourceFingerprint:d.manifest.build.sourceFingerprint,
  browserFamily:'iPhone Chrome (CriOS), owner report',sourceSize:[settings.width,settings.height],frameRate:settings.frameRate,
  backend:d.backends,lifecycle:{state:d.metricLifecycle.state,failures:d.metricLifecycle.failures},profileSupplied:r.profile!==null,videoZoom:r.videoZoom,
  elapsedMs:d.elapsedMs,metric:l.metric,detector:l.detector,availability:l.availability,frameTiming:r.frameTiming,
  perOutcome,observationReasons:observedReasons,
  sourceAspect:{target:[392,224],content:[settings.width*scale,settings.height*scale],
    contentFraction:settings.width*settings.height*scale*scale/(392*224),minimumNormalizedBoxWidth:10/(settings.width*scale)},
  limitations:['accepted-observed means validated HUD admission, not physical scanout/verified metres',
    'aggregate roi-rejected has no per-object reason/subgate or raw depth/box; exact 15 rejection causes cannot be reconstructed',
    'observation Chưa hiệu chuẩn is a generic missing-range placeholder, not evidence that profile absence caused ROI rejection',
    'full-session coverage includes startup; not independently annotated eligible coverage',
    'single ~60-second session, not a 30-minute thermal test or historical incident'],
  findings:{completed:35,accepted:15,roiRejected:15,bindingRejected:2,stale:3,
    runtimeFaultObserved:false,wasmFallbackObserved:false,physicalAccuracyEstablished:false}};
assert.equal(stats.backend.metric,'webgpu');assert.equal(stats.lifecycle.failures,0);
assert.equal(stats.metric.completed,35);assert.equal(stats.metric.outcomes['roi-rejected'],15);
assert.equal(stats.metric.outcomes['accepted-observed'],15);
assert.equal(stats.metric.outcomes['binding-rejected'],2);assert.equal(stats.metric.outcomes.stale,3);
await mkdir('docs/evidence/tip61r',{recursive:true});
await writeFile('docs/evidence/tip61r/owner-session-audit.json',JSON.stringify(stats,null,2)+'\n');
console.log(JSON.stringify({inputSha256:stats.inputSha256,backends:stats.backend,elapsedMs:stats.elapsedMs,
  outcomes:stats.metric.outcomes,availability:stats.availability,sourceAspect:stats.sourceAspect,frameTiming:stats.frameTiming,
  perOutcomeCounts:Object.fromEntries(Object.entries(perOutcome).map(([key,value])=>[key,value.count])),limitations:stats.limitations},null,2));
