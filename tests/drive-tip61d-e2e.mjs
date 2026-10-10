import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {browserLaunchOptions,resolveBrowserExecutable} from './helpers/browser.mjs';
import {startDev,waitForPreview,stopPreview} from './helpers/preview-server.mjs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
const root=new URL('..',import.meta.url).pathname,port=4226,out=join(tmpdir(),'roboeye-tip61d-ui');await mkdir(out,{recursive:true});
const server=startDev(root,port);await waitForPreview(server,60000);
const browser=await chromium.launch(browserLaunchOptions(await resolveBrowserExecutable()));
try{
  const page=await browser.newPage({viewport:{width:390,height:844},acceptDownloads:true}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    window.__DRIVESENSE_TEST_WORKERS__=true;window.__metricCalls=[];
    const native=window.Worker;
    window.Worker=class {
      constructor(url,options){this.url=String(url);this.stopped=false;if(!/drive-range-worker|drive-detect-worker|detect-worker/.test(this.url))return new native(url,options);this.metric=this.url.includes('drive-range-worker');}
      terminate(){this.stopped=true;}
      emit(data,delay=0){setTimeout(()=>{if(!this.stopped)this.onmessage?.({data});},delay);}
      postMessage(m){
        window.__metricCalls.push({metric:this.metric,type:m.type,orientation:m.orientation,width:m.width,height:m.height});
        if(m.type==='init'){this.emit(this.metric?{channel:'drive-range-v1',type:'ready',backend:'webgpu',warmupMs:1}:{type:'ready',device:'webgpu'});return;}
        if(m.type!=='frame')return;
        if(this.metric){this.emit({channel:'drive-range-v1',type:'result',id:m.id,latencyMs:90,map:{width:m.width,height:m.height,depth:new Float32Array(m.width*m.height).fill(24),unit:'metres',distanceKind:'optical-axis-z',provenance:'learned-unverified',focal:null,shift:null,reprojectionRmse:null}},90);}
        else this.emit({type:'det',capturedAt:m.capturedAt,boxes:[
          {label:'car',score:.99,x0:.4,x1:.45,y0:.3,y1:.55},
          {label:'car',score:.99,x0:0,x1:.1,y0:.3,y1:.55},
          {label:'car',score:.99,x0:.7,x1:.71,y0:.3,y1:.55}]},70);
      }
    };
    navigator.mediaDevices.getUserMedia=async()=>{
      const c=document.createElement('canvas');c.width=720;c.height=1280;const x=c.getContext('2d');
      const timer=setInterval(()=>{x.fillStyle='#667780';x.fillRect(0,0,c.width,c.height);x.fillStyle='#ffffff';x.fillRect(c.width*.4,c.height*.3,c.width*.05,c.height*.25);},30);
      window.__fixtureCanvas=c;const stream=c.captureStream(30);stream.getTracks()[0].addEventListener('ended',()=>clearInterval(timer));return stream;
    };
  });
  await page.goto(`http://127.0.0.1:${port}/drive.html?v=tip61d`);await page.click('#camera');
  await page.waitForFunction(()=>document.querySelector('#range-status').textContent.includes('≈24'),null,{timeout:15000});
  async function report(name){const downloading=page.waitForEvent('download');await page.evaluate(()=>document.querySelector('#report').click());const download=await downloading,path=`${out}/${name}.json`;await download.saveAs(path);return JSON.parse(await readFile(path,'utf8'));}
  const portrait=await report('portrait'),ledger=portrait.diagnostics.ledger;
  assert.equal(ledger.schema,'drivesense-attempt-ledger-v2');assert.equal(portrait.runtime.sourceDimensions.height,1280);
  const attempt=ledger.details.find(r=>r.kind==='metric'&&r.outcome==='accepted-observed');assert.ok(attempt);
  assert.deepEqual([attempt.context.targetWidth,attempt.context.targetHeight],[224,392]);assert.ok(attempt.context.contentFraction>.98);
  assert.deepEqual(attempt.objects.map(o=>o.code),['accepted','clipped-box','tiny-roi']);assert.equal(attempt.objects[0].trackId>0,true);
  assert.equal(attempt.objects[0].publishedM,24);assert.equal(attempt.objects[1].publishedM,null);assert.equal(portrait.diagnostics.manifest.execution,'mock-workers');
  await page.evaluate(()=>{window.__fixtureCanvas.width=1280;window.__fixtureCanvas.height=720;});
  await page.waitForFunction(()=>window.__metricCalls.some(m=>m.metric&&m.type==='frame'&&m.width===392&&m.height===224),null,{timeout:15000});
  await page.waitForTimeout(500);const rotated=await report('landscape');assert.ok(rotated.diagnostics.epoch>portrait.diagnostics.epoch);
  assert.equal(rotated.diagnostics.ledger.metric.balanced,true);assert.ok(rotated.diagnostics.ledger.details.some(r=>r.context?.targetWidth===392));
  assert.deepEqual(errors,[]);await page.screenshot({path:`${out}/ui.png`});
  await writeFile(`${out}/result.json`,JSON.stringify({pass:true,checks:['portrait shape','per-object terminal reasons','published capture identity','orientation reset','balanced accounting','no JS errors'],scope:'Canvas stream and mock workers in real app. Not phone perception/metre accuracy.'},null,2));
  console.log(`PASS TIP-61D UI: ${out}`);
}finally{await browser.close();await stopPreview(server);}
