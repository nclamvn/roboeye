import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildReplay,replayAt,sampleTimes} from '../src/drive/replay.ts';
import {DRIVE_REPORT_VERSION} from '../src/drive/report-contract.ts';
const root=new URL('..',import.meta.url),dir=new URL('docs/evidence/tip62/',root);await mkdir(dir,{recursive:true});
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const save=async(name,value)=>writeFile(new URL(name,dir),JSON.stringify(value,null,2)+'\n');
const qa=await json('/private/tmp/roboeye-tip62-partner-qa/summary.json');assert.equal(qa.pass,true);assert.equal(qa.unchanged,true);
const unitLog=await readFile('/private/tmp/roboeye-tip62-partner-qa/unit.log','utf8');
const tests=Number(unitLog.match(/tests\s+(\d+)/)?.[1]),passed=Number(unitLog.match(/pass\s+(\d+)/)?.[1]);assert.ok(tests>310&&passed===tests);
const release=await json(new URL('dist/release.json',root));
const audit=await json('/private/tmp/roboeye-tip62-audit.json');assert.equal(audit.counts.high,0);assert.equal(audit.counts.critical,0);await save('dependency-audit.json',audit);
await save('software-qa.json',{...qa,unit:{tests,passed},release,security:audit.counts,captureExpiryMs:1200,precision:'fp32'});
for(const [name,path] of [
 ['source-lifecycle','/private/tmp/roboeye-tip62-lifecycle/after.json'],
 ['recovery',join(tmpdir(),'roboeye-tip61-recovery-qa/result.json')],
 ['journal',join(tmpdir(),'roboeye-tip61-journal-qa/result.json')],
 ['live-orchestration',join(tmpdir(),'roboeye-tip60c-live-qa/result.json')],
 ['portrait-diagnostics','/private/tmp/roboeye-tip61d-ui/result.json'],
 ['real-model-smoke',join(tmpdir(),'roboeye-tip60c-runtime-qa/result.json')],
 ['controls',join(tmpdir(),'roboeye-drive-feature-toggle-qa/result.json')],
 ['video-anchor',join(tmpdir(),'roboeye-road-icon-anchor-qa/result.json')]
]){const value=await json(path);assert.ok(value.pass===true||value.status==='pass');await save(`${name}.json`,value);}
await save('source-lifecycle-before.json',await json('/private/tmp/roboeye-tip62-lifecycle/before.json'));
const hardware=await json('/private/tmp/roboeye-tip62-hardware/camera-probe.json');
await save('camera-source-probe.json',{measuredUtc:hardware.measuredUtc,fakeDeviceFlags:hardware.fakeDeviceFlags,result:hardware.result,
 app:hardware.app?{status:hardware.app.status,frames:hardware.app.frames,execution:hardware.app.execution,backends:hardware.app.backends,
  accounting:{detector:hardware.app.ledger?.detector,metric:hardware.app.ledger?.metric},errors:hardware.app.errors,scope:hardware.app.scope}:null,phone:hardware.phone,scope:hardware.scope});
const clips=[];
for(const stem of ['Test1-balanced','Test2-fast']){
 const summary=await json(`/private/tmp/roboeye-tip62-real-clips/${stem}-summary.json`),report=await json(`/private/tmp/roboeye-tip62-real-clips/${stem}-report.json`);
 assert.equal(report.version,DRIVE_REPORT_VERSION);assert.equal(report.synthetic,false);assert.equal(report.frameTiming.depthFailedFrames,0);
 assert.equal(summary.releaseIdentity?.sourceFingerprint,release.sourceFingerprint,'Recorded clip must run the final verified source');
 const expectedTimes=sampleTimes(summary.state.durationS*1000,report.offlineAnalysis.stepMs);
 assert.equal(report.samples.length,expectedTimes.length);
 const maxTimelineDeviationMs=Math.max(...report.samples.map((sample,i)=>Math.abs(sample.timeMs-expectedTimes[i])));
 // Browser currentTime is decoded media time, not an exact decimal request.
 // Match the existing seekDecoded <5 ms contract, with count/order still strict.
 assert.ok(maxTimelineDeviationMs<5);assert.ok(report.samples.every((s,i)=>i===0||s.timeMs>report.samples[i-1].timeMs));
 const frames=buildReplay(report.samples,report.profile,report.videoZoom);let measured=0,unknown=0,conflicts=0,interpolatedViews=0;
 const reasons={};
 function check(tracks,height){
  for(const track of tracks){if(track.range.distanceM===null)unknown++;else measured++;
   const reason=track.range.reasonCode??'other';reasons[reason]=(reasons[reason]??0)+1;}
  for(const a of tracks)for(const b of tracks){if(a.id===b.id||a.box.score<.65||b.box.score<.65||a.range.distanceM===null||b.range.distanceM===null)continue;
   if((a.box.y1-b.box.y1)*height>=2&&a.range.distanceM>b.range.distanceM)conflicts++;}
 }
 for(let i=0;i<frames.length;i++){
  check(frames[i].tracks,report.samples[i].height);
  if(i+1<frames.length){const view=replayAt(frames,(frames[i].timeMs+frames[i+1].timeMs)/2,report.offlineAnalysis.stepMs+5);check(view.tracks,report.samples[i].height);interpolatedViews++;}
 }
 assert.equal(conflicts,0,'Publication cannot reintroduce resolved ground-row order contradictions');
 clips.push({source:summary.source,build:summary.releaseIdentity,mode:report.mode,preset:report.offlineAnalysis,
  timing:report.frameTiming,detection:summary.detection,maxTimelineDeviationMs,publishedAndMidpointViews:{measured,unknown,measuredFraction:measured/(measured+unknown),conflicts,interpolatedViews,reasons},
  accuracy:{referenceCount:report.references.length,maeM:report.summary.maeM,verdict:'UNVALIDATED: no independent distance ground truth'},pageErrors:summary.pageErrors});
}
await save('recorded-offline.json',{pass:true,clips,scope:'Actual pinned models, recorded user road clips. Sampling/unknown counts are not accuracy or phone realtime acceptance. Owner clips/screenshots not copied to repository.'});
const live=await json('/private/tmp/roboeye-tip62-real-live/result.json');assert.equal(live.pass,true);
for(const row of live.results)assert.equal(row.build.sourceFingerprint,release.sourceFingerprint);
await save('recorded-realtime.json',{pass:true,errors:live.errors,external:live.external,results:live.results.map(row=>({
 clipSha256:row.clipSha256,bytes:row.bytes,build:row.build,backends:row.backends,liveMetric:row.liveMetric,
 accounting:{detector:row.ledger.detector,metric:row.ledger.metric},availability:row.ledger.availability,
 objectTerminalReasons:row.ledger.objectTerminalReasons,timing:row.mobileSoak.overall?.stages,scope:row.scope}))});
console.log(`PASS TIP-62 evidence collected; ${passed}/${tests} units; 2 recorded offline + 2 realtime clips; phone NOT TESTED`);
