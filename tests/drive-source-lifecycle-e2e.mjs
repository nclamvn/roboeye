import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {browserLaunchOptions,resolveBrowserExecutable} from './helpers/browser.mjs';
import {startDev,waitForPreview,stopPreview} from './helpers/preview-server.mjs';
import {createSyntheticVideo} from './helpers/video-fixture.mjs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
const root=new URL('..',import.meta.url).pathname,port=4230,out=join(tmpdir(),'roboeye-tip62-lifecycle');await mkdir(out,{recursive:true});
const before=process.env.ROBOEYE_EXPECT_PREPATCH==='1';
const server=startDev(root,port);await waitForPreview(server,60000);const browser=await chromium.launch(browserLaunchOptions(await resolveBrowserExecutable()));
const checks=[],errors=[];
try{
 const page=await browser.newPage({viewport:{width:390,height:844},acceptDownloads:true});page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.__DRIVESENSE_TEST_WORKERS__=true;window.__frames=0;window.__streams=[];window.__hidden=false;window.__muted=false;window.__enumerationFailure=false;window.__denyPlay=false;window.__permissionFailure=false;window.__cameraDelay=0;
  Object.defineProperty(document,'hidden',{get:()=>window.__hidden});
  const nativeWorker=window.Worker;window.Worker=class{
   constructor(url,options){this.url=String(url);this.stopped=false;if(!/drive-range-worker|drive-detect-worker|detect-worker/.test(this.url))return new nativeWorker(url,options);this.metric=this.url.includes('drive-range-worker');}
   terminate(){this.stopped=true;}
   emit(data,delay=0){setTimeout(()=>{if(!this.stopped)this.onmessage?.({data});},delay);}
   postMessage(m){if(m.type==='init'){this.emit(this.metric?{channel:'drive-range-v1',type:'ready',backend:'webgpu',warmupMs:1}:{type:'ready',device:'webgpu'});return;}if(m.type!=='frame')return;window.__frames++;
    if(this.metric)this.emit({channel:'drive-range-v1',type:'result',id:m.id,latencyMs:90,map:{width:m.width,height:m.height,depth:new Float32Array(m.width*m.height).fill(24),unit:'metres',distanceKind:'optical-axis-z',provenance:'learned-unverified',focal:null,shift:null,reprojectionRmse:null}},90);
    else this.emit({type:'det',capturedAt:m.capturedAt,boxes:[{label:'car',score:.99,x0:.4,x1:.5,y0:.3,y1:.55}]},70);
   }
  };
  const play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){if(window.__denyPlay)return Promise.reject(new DOMException('fixture autoplay denied','NotAllowedError'));return play.call(this);};
  navigator.mediaDevices.enumerateDevices=async()=>{if(window.__enumerationDelay)await new Promise(r=>setTimeout(r,window.__enumerationDelay));if(window.__enumerationFailure)throw new DOMException('fixture enumeration failure','NotAllowedError');return [];};
  navigator.mediaDevices.getUserMedia=async()=>{
   const delay=window.__cameraDelay;if(delay)await new Promise(r=>setTimeout(r,delay));
   if(window.__permissionFailure)throw new DOMException('fixture permission denied','NotAllowedError');
   const c=document.createElement('canvas');c.width=720;c.height=1280;const ctx=c.getContext('2d'),timer=setInterval(()=>{ctx.fillStyle='#789';ctx.fillRect(0,0,c.width,c.height);},30);
   const stream=c.captureStream(30),track=stream.getVideoTracks()[0];Object.defineProperty(track,'muted',{get:()=>window.__muted});
   track.addEventListener('ended',()=>clearInterval(timer));window.__streams.push(stream);return stream;
  };
  const locks=[];window.__locks=locks;Object.defineProperty(navigator,'wakeLock',{value:{request:async()=>{
   if(window.__wakeDelay)await new Promise(r=>setTimeout(r,window.__wakeDelay));if(window.__wakeDenied)throw new DOMException('fixture wake denied','NotAllowedError');
   const lock=new EventTarget();lock.released=false;lock.release=async()=>{lock.released=true;lock.dispatchEvent(new Event('release'));};locks.push(lock);return lock;
  }}});
 });
 await page.goto(`http://127.0.0.1:${port}/drive.html?v=tip62`);await page.click('#camera');
 await page.waitForFunction(()=>document.querySelector('#range-status').textContent.includes('≈24'),null,{timeout:15000});
 await page.evaluate(()=>{window.__hidden=true;document.dispatchEvent(new Event('visibilitychange'));});await page.waitForTimeout(350);
 const frozen=await page.evaluate(()=>({frames:window.__frames,paused:document.querySelector('video').paused,measured:document.querySelector('#range-status').textContent.includes('≈24')}));
 assert.equal(frozen.paused,true);assert.equal(frozen.measured,false);
 await page.evaluate(()=>{window.__hidden=false;document.dispatchEvent(new Event('visibilitychange'));});
 if(before){await page.waitForTimeout(600);const actual=await page.evaluate(()=>({paused:document.querySelector('video').paused,frames:window.__frames}));assert.equal(actual.paused,true);assert.equal(actual.frames,frozen.frames);
  await writeFile(`${out}/before.json`,JSON.stringify({reproduced:true,bug:'hidden → visible leaves camera video paused; camera Play handler cannot resume',frozen,actual,scope:'Controlled visibility getter + canvas camera/mock workers; not physical OS/browser suspension.'},null,2));console.log('REPRODUCED phone/laptop background-return camera stall');}
 else{
  await page.waitForFunction(()=>!document.querySelector('video').paused&&document.querySelector('#range-status').textContent.includes('≈24'),null,{timeout:15000});checks.push('hidden-visible-owned-camera-resumes-with-new-metres');
  await page.evaluate(()=>{window.__muted=true;window.__streams.at(-1).getVideoTracks()[0].dispatchEvent(new Event('mute'));});await page.waitForTimeout(350);
  const muted=await page.evaluate(()=>({frames:window.__frames,measured:document.querySelector('#range-status').textContent.includes('≈24')}));assert.equal(muted.measured,false);
  await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>window.__frames),muted.frames);
  await page.evaluate(()=>{window.__muted=false;window.__streams.at(-1).getVideoTracks()[0].dispatchEvent(new Event('unmute'));});
  await page.waitForFunction(()=>document.querySelector('#range-status').textContent.includes('≈24'));checks.push('mute-unmute-invalidates-and-resumes');
  await page.evaluate(()=>{window.__denyPlay=true;window.__hidden=true;document.dispatchEvent(new Event('visibilitychange'));window.__hidden=false;document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForFunction(()=>document.querySelector('#job-action').textContent.includes('Tiếp tục'));await page.evaluate(()=>window.__denyPlay=false);await page.click('#job-action');
  await page.waitForFunction(()=>document.querySelector('#range-status').textContent.includes('≈24'));checks.push('autoplay-denied-explicit-user-retry');
  await page.locator('video').evaluate(v=>v.pause());await page.waitForFunction(()=>document.querySelector('#job-action').textContent.includes('Tiếp tục'));
  await page.click('#job-action');await page.waitForFunction(()=>document.querySelector('#range-status').textContent.includes('≈24'));checks.push('unexpected-camera-pause-has-explicit-retry');
  await page.evaluate(()=>window.__enumerationFailure=true);await page.click('#camera');
  await page.waitForFunction(()=>document.querySelector('#range-status').textContent.includes('≈24'));checks.push('enumeration-error-does-not-stop-camera');
  await page.click('#stop');await page.evaluate(()=>{window.__enumerationFailure=false;window.__cameraDelay=500;});await page.click('#camera');await page.click('#stop');await page.waitForTimeout(800);
  assert.equal(await page.getAttribute('#stage','data-source'),'none');assert.equal(await page.evaluate(()=>window.__streams.at(-1).getTracks().every(t=>t.readyState==='ended')),true);checks.push('late-permission-stream-stopped-after-cancel');
  await page.evaluate(()=>{window.__cameraDelay=0;window.__permissionFailure=true;});await page.click('#camera');await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('quyền camera'));
  assert.equal(await page.getAttribute('#stage','data-source'),'none');checks.push('permission-denied-actionable-no-stuck-source');
  await page.evaluate(()=>{window.__permissionFailure=false;window.__cameraDelay=500;});await page.click('#camera');await page.click('#camera');await page.waitForTimeout(900);
  assert.equal(await page.evaluate(()=>window.__streams.slice(0,-1).every(stream=>stream.getTracks().every(track=>track.readyState==='ended'))),true);
  await page.waitForFunction(()=>document.querySelector('#range-status').textContent.includes('≈24'));checks.push('camera-replacement-stops-late-stream');
  await page.evaluate(()=>{window.__cameraDelay=0;window.__enumerationDelay=600;});await page.click('#camera');await page.waitForTimeout(100);await page.click('#stop');await page.waitForTimeout(800);
  assert.equal(await page.getAttribute('#stage','data-source'),'none');assert.equal(await page.textContent('#source-label'),'Chưa chọn nguồn');checks.push('late-enumeration-cannot-relabel-or-play-stopped-source');
  await page.evaluate(()=>{window.__permissionFailure=false;window.__wakeDelay=600;});await page.click('#camera');await page.waitForFunction(()=>document.querySelector('#stage').dataset.source==='camera');await page.waitForTimeout(150);await page.click('#stop');await page.waitForTimeout(900);
  assert.equal(await page.evaluate(()=>window.__locks.every(l=>l.released)),true);checks.push('late-wake-lock-released-after-stop');
  await page.evaluate(()=>{window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});
  await page.evaluate(()=>{window.__wakeDelay=0;window.__wakeDenied=true;});await page.click('#camera');
  await page.waitForFunction(()=>document.querySelector('#stage').dataset.source==='camera'&&document.querySelector('#range-status').textContent.includes('≈24'));checks.push('bfcache-render-restarts-no-camera-resurrection');checks.push('wake-denied-nonfatal');
  const downloading=page.waitForEvent('download');await page.evaluate(()=>document.querySelector('#report').click());const download=await downloading;await download.saveAs(`${out}/report.json`);const report=JSON.parse(await readFile(`${out}/report.json`));
  assert.equal(report.diagnostics.manifest.execution,'mock-workers');assert.equal(report.diagnostics.ledger.metric.balanced,true);assert.ok(report.diagnostics.sourceLifecycle);checks.push('lifecycle-in-pixel-free-journal-compatible-report');
  assert.equal(report.diagnostics.manifest.models.metricSha256,report.rangeModel.sha256,'manifest uses decoded portrait shape, not a pre-play landscape guess');checks.push('initial-portrait-model-and-manifest-agree');
  const clip=await createSyntheticVideo(page,{frames:35});await page.setInputFiles('#fixture-file',{name:'lifecycle-only.webm',mimeType:'video/webm',buffer:clip});
  await page.waitForFunction(()=>document.querySelector('#stage').dataset.source==='fixture'&&!document.querySelector('video').paused);
  await page.click('#play');await page.waitForFunction(()=>document.querySelector('video').paused);
  await page.evaluate(()=>{window.__hidden=true;document.dispatchEvent(new Event('visibilitychange'));window.__hidden=false;document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForTimeout(400);assert.equal(await page.locator('video').evaluate(v=>v.paused),true);checks.push('manual-fixture-pause-survives-background-return');
  await page.click('#stop');assert.deepEqual(errors,[]);await writeFile(`${out}/after.json`,JSON.stringify({pass:true,checks,errors,scope:'Real app, canvas stream/mock workers; simulated visibility/track/wake-lock faults, not physical phone verification.'},null,2));console.log(`PASS ${checks.length} source lifecycle cases`);
 }
}finally{await browser.close();await stopPreview(server);}
