import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {browserLaunchOptions,resolveBrowserExecutable} from './helpers/browser.mjs';
import {startDev,waitForPreview,stopPreview} from './helpers/preview-server.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const out=join(tmpdir(),'roboeye-tip60c-live-qa');await mkdir(out,{recursive:true});
const port=Number(process.env.ROBOEYE_TEST_PORT??4211),server=startDev(new URL('..',import.meta.url).pathname,port);
await waitForPreview(server,60000).catch(async error=>{await stopPreview(server);throw error;});
const browser=await chromium.launch(browserLaunchOptions(await resolveBrowserExecutable()));
const checks=[];
// Deterministic worker timings exercise the real app, fake browser camera,
// tracker and HUD. These are orchestration tests, NOT phone/model benchmarks.
function mock(config){
  window.__liveMessages=[];
  const NativeWorker=window.Worker;
  window.Worker=class{
    constructor(url,options){
      this.url=String(url);this.stopped=false;
      if(!/drive-range-worker|drive-detect-worker|detect-worker/.test(this.url))return new NativeWorker(url,options);
      this.metric=this.url.includes('drive-range-worker');
      this.gpuDetector=this.url.includes('drive-detect-worker');
    }
    terminate(){this.stopped=true;}
    emit(message,delay=0){setTimeout(()=>{if(!this.stopped)this.onmessage?.({data:message});},delay);}
    postMessage(m){
      window.__liveMessages.push({worker:this.metric?'metric':this.gpuDetector?'gpu-detector':'wasm-detector',type:m.type,wall:performance.now(),id:m.id??m.capturedAt,forceWasm:m.forceWasm,localModels:m.localModels,backend:m.backend});
      if(m.type==='init'){
        if(config.crash&&(this.gpuDetector||(this.metric&&m.backend==='webgpu'))){setTimeout(()=>this.onerror?.({message:'mock module crash'}),10);return;}
        if(config.failure&&!this.metric){this.emit({type:'error',stage:'load',message:'model unavailable in fixture'});return;}
        this.emit(this.metric?{channel:'drive-range-v1',type:'ready',backend:'wasm',warmupMs:5}:{type:'ready',engine:'rtdetr',device:'wasm'});return;
      }
      if(m.type!=='frame')return;
      if(this.metric){
        const map={width:392,height:224,depth:new Float32Array(392*224).fill(24),unit:'metres',distanceKind:'optical-axis-z',provenance:'learned-unverified',focal:null,shift:null,reprojectionRmse:null};
        this.emit({channel:'drive-range-v1',type:'result',id:m.id,map,latencyMs:config.depth},config.depth);
      }else this.emit({type:'det',capturedAt:m.capturedAt,detMs:config.detector,boxes:[{label:'car',score:.99,x0:.3,y0:.3,x1:.7,y1:.8}]},config.detector);
    }
    addEventListener(){}removeEventListener(){}
  };
}
try{
  for(const fixture of [
    {name:'depth-after-newer-detector',detector:220,depth:800},
    {name:'depth-before-detector',detector:700,depth:120},
    {name:'module-crash-clean-wasm',detector:220,depth:800,crash:true},
    {name:'stale-depth-abstains',detector:220,depth:1800,stale:true},
    {name:'slow-box-no-fresh-warning',detector:1350,depth:100,stale:true},
    {name:'load-error-visible-retry',detector:220,depth:100,failure:true},
  ]){
    const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));await page.addInitScript(mock,fixture);
    await page.goto(`http://127.0.0.1:${port}/drive.html?v=tip60c-${fixture.name}`);
    await page.click('#camera');
    if(fixture.failure){
      await page.waitForFunction(()=>!document.querySelector('#job-notice').hidden&&document.querySelector('#job-notice').dataset.phase==='error');
      assert.equal(await page.locator('#job-action').isVisible(),true);
      assert.match(await page.textContent('#job-detail'),/unavailable/);
    }else{
      await page.waitForFunction(()=>Number(document.querySelector('#count').textContent)>0,null,{timeout:15000});
      if(fixture.stale){
        await page.waitForFunction(()=>document.querySelector('#range-status').textContent.includes('quá chậm'),null,{timeout:15000});
        assert.doesNotMatch(await page.textContent('#range-status'),/≈24/);
        assert.equal(await page.locator('#hud-warning').isVisible(),false);
      }else{
        await page.waitForFunction(()=>document.querySelector('#range-status').textContent.includes('≈24'),null,{timeout:15000});
        const reportPromise=page.waitForEvent('download');await page.evaluate(()=>document.getElementById('report').click());
        const download=await reportPromise;await download.saveAs(`${out}/${fixture.name}.json`);
      }
      const messages=await page.evaluate(()=>window.__liveMessages);
      const depth=messages.find(m=>m.worker==='metric'&&m.type==='frame');assert.ok(depth);
      const detector=messages.find(m=>m.worker!=='metric'&&m.type==='frame'&&Math.abs(m.wall-depth.wall)<30);
      assert.ok(detector,'depth and detector are dispatched at capture, not serially after detection');
      if(fixture.crash){
        assert.ok(messages.some(m=>m.worker==='wasm-detector'&&m.type==='init'&&m.localModels===true&&m.forceWasm===true));
        assert.ok(messages.some(m=>m.worker==='metric'&&m.type==='init'&&m.backend==='wasm'));
      }
    }
    assert.deepEqual(errors,[]);await page.screenshot({path:`${out}/${fixture.name}.png`});checks.push(fixture.name);await page.close();
  }
  await writeFile(`${out}/result.json`,JSON.stringify({pass:true,checks,scope:'Browser orchestration with fake camera and deterministic workers. No real phone or metric accuracy acceptance.'},null,2));
  console.log(`PASS ${checks.length} mobile live cases: ${out}`);
}finally{await browser.close();await stopPreview(server);}
