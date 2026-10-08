import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {browserLaunchOptions,resolveBrowserExecutable} from './helpers/browser.mjs';
const files=(process.env.DRIVE_VIDEOS??'').split('|').filter(Boolean);
if(!files.length)throw Error('DRIVE_VIDEOS must list existing locally selected clips, separated by |');
const base=process.env.DRIVE_BASE??'http://127.0.0.1:4192',out=process.env.DRIVE_OUTPUT_DIR??'/private/tmp/roboeye-tip62-real-live';await mkdir(out,{recursive:true});
const browser=await chromium.launch(browserLaunchOptions(await resolveBrowserExecutable()));const results=[];
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true}),errors=[],external=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>{const url=new URL(route.request().url());if(['http:','https:'].includes(url.protocol)&&url.origin!==new URL(base).origin){external.push(url.href);return route.abort();}return route.continue();});
 await page.goto(`${base}/drive.html?v=tip62-real-live`,{waitUntil:'domcontentloaded'});
 for(const [index,path] of files.entries()){
  await page.setInputFiles('#fixture-file',path);
  await page.waitForFunction(()=>document.querySelector('#stage').dataset.source==='fixture'&&!document.querySelector('video').paused,null,{timeout:15000});
  await page.waitForFunction(()=>document.querySelector('#backend').textContent.includes('webgpu')&&document.querySelector('#metric-backend').textContent.includes('webgpu'),null,{timeout:90000});
  const initial=await page.locator('video').evaluate(v=>v.currentTime);await page.waitForTimeout(12000);
  assert.notEqual(await page.locator('video').evaluate(v=>v.currentTime),initial,'media must advance independently of inference');
  assert.ok(Number(await page.textContent('#count'))>0,'real recorded traffic produces visible tracked vehicles');
  const downloading=page.waitForEvent('download');await page.evaluate(()=>document.querySelector('#report').click());const download=await downloading;
  await download.saveAs(`${out}/clip-${index+1}-report.json`);const report=JSON.parse(await readFile(`${out}/clip-${index+1}-report.json`,'utf8'));
  assert.equal(report.mode,'fixture-live-replay');assert.equal(report.diagnostics.manifest.execution,'actual-workers');
  assert.equal(report.diagnostics.ledger.detector.balanced,true);assert.equal(report.diagnostics.ledger.metric.balanced,true);
  assert.ok(report.diagnostics.ledger.metric.completed>0&&report.liveMetric.attempts>0,'actual depth requests, not model-ready only');
  assert.equal(report.liveMetric.maxCaptureAgeMs,1200);assert.equal(report.diagnostics.sourceLifecycle.state,'running');
  await page.screenshot({path:`${out}/clip-${index+1}-private.png`}); // Local owner input, never publish screenshots.
  results.push({clipSha256:report.diagnostics.manifest.fixture.sha256,bytes:report.diagnostics.manifest.fixture.bytes,
   build:report.diagnostics.manifest.build,mode:report.mode,backends:report.diagnostics.backends,liveMetric:report.liveMetric,
   liveTiming:report.liveTiming,mobileSoak:report.mobileSoak,ledger:report.diagnostics.ledger,sourceLifecycle:report.diagnostics.sourceLifecycle,
   scope:'Real app and pinned real models on recorded road video at wall-clock playback. NOT physical camera/phone/road metre accuracy'});
  await page.click('#stop');
 }
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 await writeFile(`${out}/result.json`,JSON.stringify({pass:true,results,errors,external},null,2));console.log(`PASS ${results.length} real-model realtime recorded road sessions`);
}finally{await browser.close();}
