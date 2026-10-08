import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {browserLaunchOptions,resolveBrowserExecutable} from './helpers/browser.mjs';
const base=new URL(process.argv[2]??'https://roboeye-drivesense.vercel.app');assert.equal(base.protocol,'https:');
const release=JSON.parse(await readFile('.vercel/output/static/release.json','utf8'));
const out=process.env.ROBOEYE_HTTPS_EVIDENCE_DIR??'docs/evidence/tip62';await mkdir(out,{recursive:true});
const browser=await chromium.launch(browserLaunchOptions(await resolveBrowserExecutable())),checks=[],errors=[],external=[];
try{
 const page=await browser.newPage({viewport:{width:430,height:932},acceptDownloads:true});page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>{const u=new URL(route.request().url());if(['https:','http:'].includes(u.protocol)&&u.origin!==base.origin){external.push(u.href);return route.abort();}return route.continue();});
 await page.addInitScript(()=>{
  window.__hidden=false;window.__muted=false;window.__denyPlay=false;window.__opens=0;window.__frames=0;
  Object.defineProperty(document,'hidden',{get:()=>window.__hidden});
  const nativePlay=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){return window.__denyPlay?Promise.reject(new DOMException('Test autoplay denied','NotAllowedError')):nativePlay.call(this);};
  navigator.mediaDevices.getUserMedia=async()=>{
   window.__opens++;const c=document.createElement('canvas');c.width=720;c.height=1280;const ctx=c.getContext('2d');
   setInterval(()=>{ctx.fillStyle='#708190';ctx.fillRect(0,0,c.width,c.height);},30);
   const stream=c.captureStream(30),track=stream.getVideoTracks()[0];Object.defineProperty(track,'muted',{get:()=>window.__muted});window.__track=track;return stream;
  };
  // Workers are NOT replaced: compiled production code and real model bytes.
 });
 await page.goto(new URL(`/drive.html?v=${release.buildFingerprint}`,base).href,{waitUntil:'domcontentloaded'});await page.click('#camera');
 await page.waitForFunction(()=>!document.querySelector('video').paused&&document.querySelector('#metric-backend').textContent.includes('224×392')&&document.querySelector('#backend').textContent.includes('webgpu'),null,{timeout:120000});
 checks.push('actual-production-workers-ready-for-portrait-source');
 await page.evaluate(()=>{const v=document.querySelector('video');const frame=()=>{window.__frames++;v.requestVideoFrameCallback(frame);};v.requestVideoFrameCallback(frame);});
 await page.waitForFunction(()=>window.__frames>4);
 await page.evaluate(()=>{window.__hidden=true;document.dispatchEvent(new Event('visibilitychange'));});await page.waitForTimeout(250);
 assert.equal(await page.locator('video').evaluate(v=>v.paused),true);const before=await page.evaluate(()=>window.__frames);
 await page.evaluate(()=>{window.__hidden=false;document.dispatchEvent(new Event('visibilitychange'));});await page.waitForFunction(before=>window.__frames>before+3&&!document.querySelector('video').paused,before);checks.push('compiled-hidden-return-resumes-new-frame-flow');
 await page.evaluate(()=>{window.__muted=true;window.__track.dispatchEvent(new Event('mute'));});await page.waitForTimeout(250);assert.equal(await page.locator('video').evaluate(v=>v.paused),true);
 const afterMute=await page.evaluate(()=>window.__frames);
 await page.evaluate(()=>{window.__muted=false;window.__track.dispatchEvent(new Event('unmute'));});await page.waitForFunction(before=>!document.querySelector('video').paused&&window.__frames>before+3,afterMute);checks.push('compiled-track-interruption-recovers');
 await page.evaluate(()=>{window.__denyPlay=true;window.__hidden=true;document.dispatchEvent(new Event('visibilitychange'));window.__hidden=false;document.dispatchEvent(new Event('visibilitychange'));});
 await page.waitForFunction(()=>document.querySelector('#job-action').textContent.includes('Tiếp tục'));const afterDenied=await page.evaluate(()=>window.__frames);
 await page.evaluate(()=>window.__denyPlay=false);await page.click('#job-action');
 // paused=false is synchronous play intent, NOT proof that play() resolved.
 // Require newly decoded frames before snapshotting the running lifecycle.
 await page.waitForFunction(before=>!document.querySelector('video').paused&&window.__frames>before+3,afterDenied);checks.push('compiled-explicit-playback-retry');
 const downloading=page.waitForEvent('download');await page.evaluate(()=>document.querySelector('#report').click());const download=await downloading;
 const report=JSON.parse(await readFile(await download.path(),'utf8'));assert.equal(report.diagnostics.manifest.build.sourceFingerprint,release.sourceFingerprint);
 assert.equal(report.diagnostics.sourceLifecycle.state,'running');assert.equal(report.liveMetric.maxCaptureAgeMs,1200);
 checks.push('exact-source-and-lifecycle-export');
 await page.evaluate(()=>{window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});
 await page.waitForFunction(()=>document.querySelector('#stage').dataset.source==='none');assert.equal(await page.evaluate(()=>window.__opens),1);assert.equal(await page.evaluate(()=>window.__track.readyState),'ended');checks.push('compiled-bfcache-restarts-ui-without-reopening-camera');
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 const result={pass:true,verifiedUtc:new Date().toISOString(),release,checks,errors,external,
  scope:'Desktop Chromium, compiled HTTPS app + actual pinned model workers. Canvas source and visibility/mute/play faults are simulated. NOT physical iPhone/Xiaomi or metre accuracy.'};
 await writeFile(`${out}/https-source-lifecycle.json`,JSON.stringify(result,null,2));console.log(`PASS ${checks.length} compiled HTTPS source cases`);
}finally{await browser.close();}
