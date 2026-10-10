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
    // Vite can discover a worker-only dependency after the first click and
    // reload this fixture. Retry that explicit no-run state at most twice;
    // keep the same total deadline and still require actual inference PASS.
    const deadline=Date.now()+130000;let fixtureReloads=0,lastProgress=0;
    while(Date.now()<deadline){
      const value=await page.textContent('#result');if(/^\{|^FAIL/.test(value))break;
      if(value==='Chưa chạy'){
        assert.ok(++fixtureReloads<=2,'repeated Vite fixture reloads');
        await page.waitForFunction(()=>window.driveModelSmokeReady===true);
        await page.evaluate(()=>document.querySelector('#run').click());
        console.log(`[${backend}] recovered fixture reload ${fixtureReloads}`);
      }
      if(Date.now()-lastProgress>10000){console.log(`[${backend}] ${value.slice(0,250)}`);lastProgress=Date.now();}
      await page.waitForTimeout(500);
    }
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
