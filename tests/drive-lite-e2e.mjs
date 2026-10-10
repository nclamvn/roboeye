import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {browserLaunchOptions,resolveBrowserExecutable} from './helpers/browser.mjs';
import {startDev,waitForPreview,stopPreview} from './helpers/preview-server.mjs';
import {installMockWorkers} from './helpers/mock-workers.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';
const out=process.env.ROBOEYE_LITE_QA_OUTPUT??join(tmpdir(),'lite-qa');await mkdir(out,{recursive:true});
const server=startDev(new URL('..',import.meta.url).pathname,4228);await waitForPreview(server);
const browser=await chromium.launch(browserLaunchOptions(await resolveBrowserExecutable())),results=[],errors=[],external=[];
try{
 for(const backend of ['wasm','webgpu']){const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{const u=new URL(route.request().url());if(['http:','https:'].includes(u.protocol)&&u.hostname!=='127.0.0.1'){external.push(u.href);return route.abort();}return route.continue();});
  await page.goto(`http://127.0.0.1:4228/tests/drive-lite-smoke.html?backend=${backend}`);
  await page.waitForFunction(()=>window.liteSmoke,null,{timeout:120000});const r=await page.evaluate(()=>window.liteSmoke);assert.equal(r.pass,true,r.error);assert.equal(r.backend,backend);results.push(r);await page.close();console.log(`PASS actual Nano ${backend}`);
 }
 const page=await browser.newPage({viewport:{width:430,height:932},userAgent:'Mozilla/5.0 Android Mobile Chrome',acceptDownloads:true});page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(installMockWorkers);await page.addInitScript(()=>{window.__DRIVESENSE_TEST_WORKERS__=true;window.__mockDetectionBoxes=[{label:'car',score:.99,x0:.43,x1:.57,y0:.4,y1:.65}];navigator.mediaDevices.getUserMedia=async()=>{const c=document.createElement('canvas');c.width=1280;c.height=720;setInterval(()=>{const ctx=c.getContext('2d');ctx.fillStyle='#627a85';ctx.fillRect(0,0,c.width,c.height);},33);return c.captureStream(30);};});
 await page.goto('http://127.0.0.1:4228/drive.html');await page.evaluate(()=>{window.__allowMockDetection=true;document.querySelector('#analysis-panel').open=true;});
 await page.selectOption('#range-path','anchors');await page.check('#wasm');await page.click('#camera');await page.waitForFunction(()=>document.querySelector('#video').readyState>=2);
 await page.click('#anchor-freeze');assert.equal(await page.locator('#anchor-view').isVisible(),true);
 const points=[...[[.25,.55],[.75,.55],[.25,.65],[.75,.65],[.25,.8],[.75,.8]].map(([x,y])=>({x,y,split:'fit'})),...[[.4,.6],[.6,.7]].map(([x,y])=>({x,y,split:'check'}))];
 for(const p of points){await page.locator('#anchor-view').scrollIntoViewIfNeeded();const r=await page.locator('#anchor-view').boundingBox();await page.mouse.click(r.x+p.x*r.width,r.y+p.y*r.height);await page.fill('#anchor-metres',String(1/(.1*p.y-.03)));await page.selectOption('#anchor-split',p.split);await page.click('#anchor-add');}
 await page.check('#anchor-confirm');await page.click('#anchor-fit');assert.match(await page.textContent('#anchor-status'),/Theo mốc/);
 await page.waitForFunction(()=>document.querySelector('#range-path-chip').textContent==='Mét · mốc đã kiểm');
 await page.waitForFunction(()=>document.querySelector('#track-list').textContent.includes('m dọc phía trước'));
 const reportEvent=page.waitForEvent('download');await page.click('#report');const reportDownload=await reportEvent;await reportDownload.saveAs(join(out,'mock-camera-report.json'));
 const exportEvent=page.waitForEvent('download');await page.click('#anchor-export');const exported=await exportEvent;assert.equal(exported.suggestedFilename(),'drivesense-ground-anchors.json');
 assert.equal(await page.evaluate(()=>window.__mockWorkerKinds.includes('drive-range')),false,'anchors must not load depth');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'mobile horizontal overflow');
 await page.screenshot({path:join(out,'mobile-anchors.png')});
 await page.fill('#video-zoom','2');await page.locator('#video-zoom').dispatchEvent('input');assert.equal(await page.locator('#anchor-view').isHidden(),true);assert.match(await page.textContent('#anchor-status'),/Chụp khung/);
 await page.close();assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 await writeFile(join(out,'result.json'),JSON.stringify({pass:true,actualModels:results,ui:'mock camera/workers + real point calibration UI + zoom invalidation + export + zero depth dispatch',errors,external,physicalDevice:'NOT TESTED'},null,2));
 console.log(`PASS Nano model and mobile calibration UI: ${out}`);
}finally{await browser.close();await stopPreview(server);}
