import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {browserLaunchOptions,resolveBrowserExecutable} from './helpers/browser.mjs';
import {startDev,waitForPreview,stopPreview} from './helpers/preview-server.mjs';
import {createSyntheticVideo} from './helpers/video-fixture.mjs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const out=join(tmpdir(),'roboeye-tip61-journal-qa');await mkdir(out,{recursive:true});
const port=Number(process.env.ROBOEYE_TEST_PORT??4214),root=new URL('..',import.meta.url).pathname;
const server=startDev(root,port);await waitForPreview(server,60000).catch(async e=>{await stopPreview(server);throw e;});
const browser=await chromium.launch(browserLaunchOptions(await resolveBrowserExecutable())).catch(async error=>{await stopPreview(server);throw error;});
const checks=[];
function mocks(config){
  window.__DRIVESENSE_TEST_WORKERS__=true;window.__messages=[];
  const NativeWorker=window.Worker;
  window.Worker=class{
    constructor(url,options){this.url=String(url);this.stopped=false;this.attempt=0;
      if(!/drive-range-worker|drive-detect-worker|detect-worker/.test(this.url))return new NativeWorker(url,options);
      this.metric=this.url.includes('drive-range-worker');}
    terminate(){this.stopped=true;}
    emit(message,delay=0){setTimeout(()=>{if(!this.stopped)this.onmessage?.({data:message});},delay);}
    postMessage(m){window.__messages.push({kind:this.metric?'metric':'detector',type:m.type,at:performance.now()});
      if(m.type==='init'){this.emit(this.metric?{channel:'drive-range-v1',type:'ready',backend:'wasm',warmupMs:3}:{type:'ready',device:'wasm'});return;}
      if(m.type!=='frame')return;this.attempt++;
      if(this.metric){
        if(config.errorAfter&&this.attempt>config.errorAfter){this.emit({channel:'drive-range-v1',type:'error',stage:'infer',id:m.id,message:'injected failure after three measurements'},100);return;}
        const map={width:392,height:224,depth:new Float32Array(392*224).fill(24),unit:'metres',distanceKind:'optical-axis-z',provenance:'learned-unverified',focal:null,shift:null,reprojectionRmse:null};
        this.emit({channel:'drive-range-v1',type:'result',id:m.id,map,latencyMs:config.depth},config.depth);
      }else this.emit({type:'det',capturedAt:m.capturedAt,boxes:[{label:'car',score:.99,x0:.3,y0:.3,x1:.7,y1:.8}]},config.detector);
    }
    addEventListener(){}removeEventListener(){}
  };
  if(config.storageDenied)Object.defineProperty(window,'indexedDB',{get(){throw new DOMException('Injected storage deny','SecurityError');}});
}
async function exportSaved(page,name){
  await page.evaluate(()=>{document.getElementById('analysis-panel').open=true;});
  const event=page.waitForEvent('download');await page.click('#saved-export');
  const download=await event,path=join(out,`${name}.json`);await download.saveAs(path);
  return JSON.parse(await readFile(path,'utf8'));
}
try{
  const seed=await browser.newPage();await seed.goto(`http://127.0.0.1:${port}/drive.html`);
  const clip=await createSyntheticVideo(seed,{frames:180});await seed.close();
  const sha256=createHash('sha256').update(clip).digest('hex');
  for(const config of [
    {name:'reopen-after-minute',detector:80,depth:100,duration:65000},
    {name:'detector-1691ms-stale-join',detector:1691,depth:100,duration:10500},
    {name:'three-successes-then-depth-stops',detector:80,depth:100,errorAfter:3,duration:8500},
    {name:'storage-denied-ai-continues',detector:80,depth:100,storageDenied:true,duration:4500}
  ]){
    console.log(`START ${config.name} · real-clock ${config.duration} ms`);
    const context=await browser.newContext(),page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(mocks,config);
    await page.goto(`http://127.0.0.1:${port}/drive.html?depth-recovery=0&v=tip61-${config.name}`);
    await page.setInputFiles('#fixture-file',{name:'synthetic-visual-only.webm',mimeType:'video/webm',buffer:clip});
    await page.waitForFunction(()=>document.querySelector('#stage').dataset.source==='fixture'&&!document.querySelector('#video').paused);
    const before=await page.locator('#video').evaluate(v=>v.currentTime);
    await page.waitForTimeout(config.duration);
    const after=await page.locator('#video').evaluate(v=>v.currentTime);
    assert.ok(after>0&&after!==before,'media advances independently of worker completions');
    assert.match(await page.textContent('#hud-mode'),/TEST REALTIME/);
    assert.ok(Number(await page.textContent('#count'))>0,'detector still has boxes');
    if(config.storageDenied){
      assert.match(await page.textContent('#journal-status'),/không khả dụng|Không lưu/);
      assert.match(await page.textContent('#range-status'),/≈24/);
    }else{
      await page.waitForFunction(()=>!!document.querySelector('#saved-session').value);
      const record=await exportSaved(page,config.name),p=record.payload;
      assert.equal(p.manifest.source,'fixture-live-replay');assert.equal(p.manifest.execution,'mock-workers');
      assert.equal(p.mobileSoak.provenance,'fixture-live-replay');assert.equal(p.manifest.fixture.sha256,sha256);
      assert.match(p.manifest.build.sourceFingerprint,/^[a-f0-9]{64}$/);assert.equal(p.manifest.metricMaxAgeMs,1200);
      assert.equal(p.ledger.metric.balanced,true);assert.equal(p.ledger.detector.balanced,true);
      if(config.detector===1691){assert.ok(p.ledger.metric.outcomes.stale>0);assert.equal(p.ledger.metric.outcomes['accepted-observed']??0,0);}
      if(config.errorAfter){assert.equal(p.ledger.metric.outcomes['accepted-observed'],3);assert.equal(p.ledger.metric.outcomes['worker-error'],1);
        assert.equal(p.ledger.metric.started,4,'baseline reproduces silent depth stop, not a fake recovery');}
      if(config.duration>60000){
        assert.ok(p.elapsedMs>=60000);assert.ok(p.ledger.generations>=4,'clip loop resets generation');
        const savedId=record.sessionId;await page.reload();
        await page.waitForFunction(()=>!!document.querySelector('#saved-session').value);
        await page.evaluate(()=>{document.getElementById('analysis-panel').open=true;});
        await page.selectOption('#saved-session',savedId);const reopened=await exportSaved(page,`${config.name}-reopened`);
        assert.equal(reopened.sessionId,savedId);assert.ok(reopened.sequence>=record.sequence);
        assert.ok(reopened.payload.ledger.metric.started>=p.ledger.metric.started);
        assert.equal(await page.locator('#stage').getAttribute('data-source'),'none');
      }
    }
    assert.deepEqual(errors,[]);checks.push(config.name);await page.screenshot({path:join(out,`${config.name}.png`)});await context.close();console.log(`PASS ${config.name}`);
  }
  await writeFile(join(out,'result.json'),JSON.stringify({pass:true,checks,fixture:{sha256,bytes:clip.length,license:'Original code-generated visual test; no perception/metric ground truth'},
    scope:'Real Chromium IndexedDB and real wall-clock video; mocked AI workers. NOT phone performance or distance accuracy validation.'},null,2));
  console.log(`PASS ${checks.length} journal/realtime fixture cases: ${out}`);
}finally{await browser.close();await stopPreview(server);}
