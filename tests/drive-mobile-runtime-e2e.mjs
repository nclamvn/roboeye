import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {browserLaunchOptions,resolveBrowserExecutable} from './helpers/browser.mjs';
import {startDev,waitForPreview,stopPreview} from './helpers/preview-server.mjs';
import {writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const out=join(tmpdir(),'roboeye-tip60c-runtime-qa');await mkdir(out,{recursive:true});
const port=Number(process.env.ROBOEYE_TEST_PORT??4214),server=startDev(new URL('..',import.meta.url).pathname,port);
await waitForPreview(server,60000).catch(async error=>{await stopPreview(server);throw error;});
const browser=await chromium.launch(browserLaunchOptions(await resolveBrowserExecutable()));
const results=[],external=[],errors=[];
try{
  for(const backend of ['wasm','webgpu']){
    const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(['error','warning'].includes(message.type()))console.log(`[${backend}] ${message.text().slice(0,600)}`);});
    page.on('requestfailed',request=>console.log(`[${backend}] request failed ${request.url()} ${request.failure()?.errorText}`));
    await page.route('**/*',route=>{const url=new URL(route.request().url());if(['http:','https:'].includes(url.protocol)&&url.hostname!=='127.0.0.1'&&url.hostname!=='localhost'){external.push(url.href);return route.abort();}return route.continue();});
    await page.goto(`http://127.0.0.1:${port}/tests/drive-model-smoke.html`);
    await page.waitForFunction(()=>window.driveModelSmokeReady===true);
    await page.selectOption('#backend',backend==='wasm'?'wasm':'static');
    // This is a model fixture, not a pointer hit-test. Invoke the fixture's
    // handler directly and assert that inference actually started; a dev-page
    // reload while waiting must not become a silent 130-second no-op.
    await page.evaluate(()=>document.querySelector('#run').click());
    assert.notEqual(await page.textContent('#result'),'Chưa chạy','fixture was reloaded or click handler did not start');
    const progress=setInterval(()=>{void page.textContent('#result').then(value=>console.log(`[${backend}] ${value.slice(0,250)}`)).catch(()=>{});},10000);
    try{await page.waitForFunction(()=>/^\{|^FAIL/.test(document.querySelector('#result').textContent),null,{timeout:130000});}finally{clearInterval(progress);}
    assert.ok((await page.textContent('#result')).startsWith('{'),await page.textContent('#result'));
    const detector=JSON.parse(await page.textContent('#result'));assert.equal(detector.pass,true,detector.error);assert.equal(detector.backend,backend);
    await page.goto(`http://127.0.0.1:${port}/tests/drive-range-smoke.html?backend=${backend}`);
    await page.waitForFunction(()=>window.driveRangeSmoke?.status!=='running',null,{timeout:130000});
    const depth=await page.evaluate(()=>window.driveRangeSmoke);assert.equal(depth.status,'pass',depth.error);assert.equal(depth.backend,backend);assert.ok(depth.distanceM>0);assert.equal(depth.provenance,'learned-unverified');
    results.push({backend,detector,depth});await page.close();
  }
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  const report={pass:true,results,external,errors,scope:'Real pinned detector/depth models on desktop Chrome, separate workers and public bus image. No iPhone/Android hardware, simultaneous-camera throughput, or physical metre accuracy acceptance.'};
  await writeFile(`${out}/result.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();await stopPreview(server);}
