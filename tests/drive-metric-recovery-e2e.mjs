import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {browserLaunchOptions,resolveBrowserExecutable} from './helpers/browser.mjs';
import {startDev,waitForPreview,stopPreview} from './helpers/preview-server.mjs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const out=join(tmpdir(),'roboeye-tip61-recovery-qa');await mkdir(out,{recursive:true});
const port=Number(process.env.ROBOEYE_TEST_PORT??4219),server=startDev(new URL('..',import.meta.url).pathname,port);
await waitForPreview(server,60000).catch(async e=>{await stopPreview(server);throw e;});
const browser=await chromium.launch(browserLaunchOptions(await resolveBrowserExecutable())).catch(async e=>{await stopPreview(server);throw e;});
function mock(config){
  window.__DRIVESENSE_TEST_WORKERS__=true;window.__depth={starts:0,frames:0,live:0,maxLive:0,faults:0};
  const NativeWorker=window.Worker;
  window.Worker=class{
    constructor(url,options){this.url=String(url);this.stopped=false;if(!/drive-range-worker|drive-detect-worker|detect-worker/.test(this.url))return new NativeWorker(url,options);
      this.metric=this.url.includes('drive-range-worker');if(this.metric){window.__depth.live++;window.__depth.maxLive=Math.max(window.__depth.maxLive,window.__depth.live);}}
    terminate(){if(!this.stopped&&this.metric)window.__depth.live--;this.stopped=true;}
    emit(m,delay=0){setTimeout(()=>{if(!this.stopped)this.onmessage?.({data:m});},delay);}
    postMessage(m){
      if(m.type==='init'){if(this.metric)window.__depth.starts++;this.emit(this.metric?{channel:'drive-range-v1',type:'ready',backend:'wasm',warmupMs:5}:{type:'ready',device:'wasm'});return;}
      if(m.type!=='frame')return;
      if(!this.metric){this.emit({type:'det',capturedAt:m.capturedAt,boxes:[{label:'car',score:.99,x0:.3,y0:.3,x1:.7,y1:.8}]},80);return;}
      const n=++window.__depth.frames;
      if(n>3&&(config.permanent||n===4)){window.__depth.faults++;this.emit({channel:'drive-range-v1',type:'error',stage:'infer',id:m.id,message:'injected depth failure'},100);
        // A queued message from this dead worker must never restore state/data.
        setTimeout(()=>this.onmessage?.({data:{channel:'drive-range-v1',type:'ready',backend:'webgpu',warmupMs:0}}),250);return;}
      this.emit({channel:'drive-range-v1',type:'result',id:m.id,latencyMs:100,map:{width:392,height:224,depth:new Float32Array(392*224).fill(24),unit:'metres',distanceKind:'optical-axis-z',provenance:'learned-unverified',focal:null,shift:null,reprojectionRmse:null}},100);
    }
    addEventListener(){}removeEventListener(){}
  };
}
const checks=[];
try{
  for(const config of [{name:'one-fault-recovers'},{name:'persistent-fault-bounded',permanent:true},{name:'stop-during-backoff',permanent:true,stop:true}]){
    const context=await browser.newContext(),page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(mock,config);
    await page.goto(`http://127.0.0.1:${port}/drive.html?v=tip61c-${config.name}`);await page.click('#camera');
    await page.waitForFunction(()=>window.__depth.faults>=1,null,{timeout:15000});
    if(config.stop){
      await page.waitForFunction(()=>document.querySelector('#metric-backend').textContent.includes('Đang phục hồi'));
      await page.click('#stop');await page.waitForTimeout(4200);
      assert.equal((await page.evaluate(()=>window.__depth)).starts,1);assert.equal((await page.evaluate(()=>window.__depth)).live,0);
    }else if(config.permanent){
      await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('giới hạn phục hồi'),null,{timeout:15000});
      await page.waitForTimeout(4000);const state=await page.evaluate(()=>window.__depth);
      assert.equal(state.starts,3);assert.equal(state.faults,3);assert.equal(state.live,0);
      assert.ok(Number(await page.textContent('#count'))>0);assert.doesNotMatch(await page.textContent('#range-status'),/≈24/);
    }else{
      await page.waitForFunction(()=>window.__depth.starts===2&&window.__depth.frames>=5&&document.querySelector('#range-status').textContent.includes('≈24'),null,{timeout:15000});
      assert.match(await page.textContent('#metric-backend'),/wasm/,'old worker ready message was ignored');
    }
    assert.equal((await page.evaluate(()=>window.__depth)).maxLive,1,'at most one depth worker');
    await page.waitForTimeout(2200);await page.evaluate(()=>{document.getElementById('analysis-panel').open=true;});
    await page.waitForFunction(()=>!!document.querySelector('#saved-session').value);
    const downloaded=page.waitForEvent('download');await page.click('#saved-export');const download=await downloaded,path=join(out,`${config.name}.json`);await download.saveAs(path);
    const report=JSON.parse(await readFile(path,'utf8'));assert.ok(report.payload.metricLifecycle.failures>=1);
    assert.equal(report.payload.ledger.metric.balanced,true);assert.equal(report.payload.manifest.execution,'mock-workers');
    assert.deepEqual(errors,[]);checks.push(config.name);await context.close();console.log(`PASS ${config.name}`);
  }
  await writeFile(join(out,'result.json'),JSON.stringify({pass:true,checks,scope:'Real app/fake camera/mocked workers; validates lifecycle only, not phone or metric accuracy.'},null,2));
}finally{await browser.close();await stopPreview(server);}
