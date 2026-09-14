import test from 'node:test';
import assert from 'node:assert/strict';
import {FileAnalysisJob} from '../../src/drive/analysis-job';

test('three-minute metadata plans 901 samples before workers can start',()=>{
  const job=new FileAnalysisJob();job.open(0);
  const times=job.prepare(180000);
  assert.equal(times.length,901);assert.equal(times.at(-1),179950);
  assert.equal(job.phase,'loading');assert.equal(job.view(500).action,'cancel');
  job.start(500);job.advance(1);
  assert.equal(job.view(2500).detail,'1/901 khung · còn ≈30 phút');
});
test('unsupported metadata fails preflight without running any inference initializer',()=>{
  for(const duration of [300001,Infinity,NaN,0]){
    const job=new FileAnalysisJob();job.open(0);let initialised=0;
    try{job.prepare(duration);initialised++;}catch(e){job.fail((e as Error).message,'choose');}
    assert.equal(initialised,0);
    const view=job.view(60000);assert.equal(view.phase,'error');assert.equal(view.visible,true);
    assert.equal(view.action,'choose');assert.ok(view.detail.length>10);
  }
});
test('errors remain visible rather than being overwritten by idle status polling',()=>{
  const job=new FileAnalysisJob();job.open(0);job.prepare(180000);job.start(100);
  job.advance(50);job.fail('Detector không tải được. Kiểm tra mạng.');
  assert.deepEqual(job.view(1000),job.view(120000));
  job.advance(901);assert.equal(job.view(120000).phase,'error');
  assert.throws(()=>job.complete('xong'));
});
test('partial completion is not ready; cancelled/stale progress cannot resume itself',()=>{
  const job=new FileAnalysisJob();job.open(0);job.prepare(180000);job.start(1);job.advance(100);
  assert.throws(()=>job.complete('xong'));job.cancel();job.advance(901);
  assert.equal(job.view(2000).phase,'cancelled');assert.equal(job.view(2000).completed,100);
  job.prepare(180000);job.start(2000);
  for(let i=1;i<=901;i++)job.advance(i);
  job.complete('901 khung · phát để xem.');
  assert.equal(job.view(5000).phase,'ready');assert.equal(job.view(5000).action,'play');
});
test('metadata timeout and source reset cannot retain the previous file notice',()=>{
  const job=new FileAnalysisJob();job.open(1000);
  assert.equal(job.metadataExpired(16000),false);assert.equal(job.metadataExpired(16001),true);
  job.fail('Không đọc được video.','choose');job.reset();
  assert.equal(job.view(17000).visible,false);
  job.open(17000);assert.equal(job.view(17001).detail.includes('Không đọc được'),false);
});
test('progress is bounded and the displayed ETA uses actual elapsed work, not rounded seconds',()=>{
  const job=new FileAnalysisJob();assert.throws(()=>job.start(0));
  job.open(0);job.prepare(1000);job.start(100);
  job.advance(1);assert.equal(job.view(200).detail,'1/6 khung · còn ≈1 giây');
  for(const count of [-1,0,1.5,7,NaN])assert.throws(()=>job.advance(count));
  assert.equal(job.view(200).completed,1);
});
