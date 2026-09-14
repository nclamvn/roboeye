import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {resolveBrowserExecutable} from './helpers/browser.mjs';
import {writeFile} from 'node:fs/promises';

const base=process.env.DRIVE_BASE||'http://127.0.0.1:4192',args=process.env.DRIVE_UNSAFE_GPU==='1'?['--enable-unsafe-webgpu']:[];
const browser=await chromium.launch({headless:true,executablePath:await resolveBrowserExecutable(),args}),errors=[],uploads=[];
try{
  const page=await browser.newPage({viewport:{width:1280,height:900}});page.on('pageerror',error=>errors.push(String(error)));
  page.on('request',request=>{if(['POST','PUT'].includes(request.method()))uploads.push(request.url());});
  await page.goto(`${base}/tests/drive-range-smoke.html`);await page.waitForFunction(()=>window.driveRangeSmoke?.status!=='running',null,{timeout:130000});
  const report=await page.evaluate(()=>window.driveRangeSmoke);assert.equal(report.status,'pass',report.error);assert.equal(report.provenance,'learned-unverified');
  assert.ok(report.distanceM>0&&report.distanceM<=80);assert.equal(report.samples,21);assert.ok(report.p95Ms<150,`P95 ${report.p95Ms} ms`);
  const degraded=await browser.newPage();await degraded.route('**/da2-outdoor-392x224.onnx',route=>route.fulfill({status:404,body:'missing'}));
  await degraded.goto(`${base}/drive.html`);await degraded.click('#model');
  await degraded.waitForFunction(()=>document.querySelector('#metric-backend')?.textContent?.includes('không khả dụng'),null,{timeout:30000});
  assert.doesNotMatch(await degraded.textContent('#range-status'),/≈\d/);assert.equal(await degraded.textContent('#model'),'Dừng nhận diện');
  await degraded.close();
  assert.deepEqual(errors,[]);assert.deepEqual(uploads,[]);
  const result={pass:true,report,degradation:'missing metric model keeps detector active and emits no fake metre value',errors,uploads,scope:'DA2 landscape graph + robust vehicle ROI + replay tracker on a public image. No physical-distance ground truth.'};
  await writeFile('tests/.metric-cache/drive-range-e2e.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}
