import { chromium } from 'playwright-core';
import { browserLaunchOptions, resolveBrowserExecutable } from './helpers/browser.mjs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const base = process.env.ROBOEYE_TEST_URL || 'http://127.0.0.1:4192';
const clip = process.env.ROBOEYE_ROAD_VIDEO || '/Users/os/Downloads/Test1.mp4';
const out = process.env.ROBOEYE_ROAD_QA || '/private/tmp/roboeye-road-ui-d5-qa';
await mkdir(out,{recursive:true});
const browser = await chromium.launch(await browserLaunchOptions(await resolveBrowserExecutable()));
const page = await browser.newPage({viewport:{width:1440,height:900}});
const errors=[], requests=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>requests.push(r.url()));
async function waitFrame(min=1){await page.waitForFunction(n=>Number(document.querySelector('#road-chip').dataset.frames)>=n||document.querySelector('#road-chip').dataset.state==='error',min,{timeout:90000});assert.notEqual(await page.locator('#road-chip').getAttribute('data-state'),'error');}
async function report(){const event=page.waitForEvent('download');await page.locator('#analysis-panel').evaluate(el=>el.open=true);await page.locator('#road-report').click();const download=await event;await download.saveAs(`${out}/diagnostics.json`);await page.locator('#close-analysis').click();}
async function inkPixels(){return page.evaluate(()=>{const c=document.querySelector('#overlay'),pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let count=0;for(let p=3;p<pixels.length;p+=4)if(pixels[p])count++;return count;});}
try {
  await page.goto(`${base}/drive.html?lanes=1&v=road-ui-e2e`);
  console.log('UI loaded');
  assert.equal(await page.locator('#road-toggle').getAttribute('aria-pressed'),'true');
  await page.locator('#file').setInputFiles(clip);
  await waitFrame();
  console.log('First real-model frame');
  await page.locator('#seek').fill('1');
  await waitFrame(2);
  await page.waitForFunction(()=>Number(document.querySelector('#road-chip').dataset.lines)>0,null,{timeout:90000});
  assert.equal(await page.locator('#job-notice').isVisible(),false);
  assert.equal(await page.locator('#hud-mode').isVisible(),false,'Lane-only HUD should only expose compact icon.');
  assert.equal(await page.locator('#play').isEnabled(),true);
  await page.screenshot({path:`${out}/paused-real-model.png`});
  assert.equal(await inkPixels(),0,'Default HUD must not paint raw lanes or masks.');
  assert.equal(await page.locator('#road-chip svg').count(),1,'State updates preserve compact icon.');
  await page.locator('#analysis-panel').evaluate(el=>el.open=true);
  await page.locator('#road-debug').check();await page.locator('#road-surface').check();
  await page.locator('#close-analysis').click();await page.waitForTimeout(100);
  assert.ok(await inkPixels()>1000,'Real road pixels/paths must actually paint on the overlay.');
  await page.locator('#analysis-panel').evaluate(el=>el.open=true);
  await page.locator('#road-debug').uncheck();await page.locator('#close-analysis').click();await page.waitForTimeout(100);
  assert.equal(await inkPixels(),0,'Closing debug hides masks even when the surface checkbox is checked.');
  await page.locator('#play').click();
  await page.waitForFunction(()=>document.querySelector('#video').currentTime>3,null,{timeout:15000});
  await page.locator('#play').click();
  await page.waitForFunction(()=>document.querySelector('#road-detail').textContent.includes('biên'),null,{timeout:15000});
  await report();
  assert.equal(requests.some(u=>u.includes('drive-metric')||u.includes('huggingface')||u.includes('drive-detector')),false,'Lane-only path must not load vehicle/depth models.');

  // Seek clears current geometry before a replacement inference finishes.
  const seekState=await page.evaluate(()=>{const video=document.querySelector('#video');video.currentTime=8;return video.seeking;});
  assert.equal(seekState,true);
  await page.waitForFunction(()=>!document.querySelector('#video').seeking);
  await page.waitForTimeout(1500);
  await page.locator('#road-toggle').click();
  assert.equal(await page.locator('#road-chip').isVisible(),false);
  await page.waitForTimeout(100);
  assert.equal(await inkPixels(),0,'Off means no lane geometry remains.');
  await page.locator('#road-toggle').click();
  await page.waitForFunction(()=>document.querySelector('#road-chip').dataset.state==='ready',null,{timeout:90000});
  // Swap file: no previous timeline/geometry/report count leaks.
  await page.locator('#file').setInputFiles(clip);
  await page.waitForFunction(()=>document.querySelector('#video').currentTime===0);
  await waitFrame();
  await page.locator('#analysis-panel').evaluate(el=>el.open=true);
  await page.locator('#road-speed').selectOption('0.25');
  assert.equal(await page.locator('#video').evaluate(el=>el.playbackRate),0.25);
  await page.locator('#close-analysis').click();
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:`${out}/mobile.png`});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const bounds=await page.locator('#road-toggle').boundingBox();
  assert.ok(bounds&&bounds.x>=0&&bounds.x+bounds.width<=390);
  await page.locator('#file').setInputFiles(process.env.ROBOEYE_ROAD_VIDEO_LONG||'/Users/os/Downloads/Test2.mp4');
  await waitFrame();
  const duration=await page.locator('#video').evaluate(el=>el.duration);
  for(const target of [duration/2,duration-1]) {
    const count=Number(await page.locator('#road-chip').getAttribute('data-frames'));
    await page.locator('#seek').fill(Math.max(0,target).toFixed(2));
    await page.waitForFunction(t=>Math.abs(document.querySelector('#video').currentTime-t)<.1&&!document.querySelector('#video').seeking,Math.max(0,target));
    await waitFrame(count+1);
    await page.waitForFunction(()=>document.querySelector('#road-detail').textContent.includes('biên'),null,{timeout:15000});
  }
  await page.locator('#stop').click();
  await page.waitForFunction(()=>document.querySelector('#stage').dataset.source==='none');

  // Missing model must surface recovery, then retry must load real model again.
  await page.route('**/__local-road/model.onnx',route=>route.fulfill({status:404,body:'missing'}));
  await page.locator('#road-toggle').click(); // off
  await page.locator('#road-toggle').click(); // on, fresh worker
  await page.waitForFunction(()=>document.querySelector('#road-chip').dataset.state==='error',null,{timeout:15000});
  await page.locator('#analysis-panel').evaluate(el=>el.open=true);
  assert.match(await page.locator('#road-detail').innerText(),/Thiếu model/);
  assert.equal(await page.locator('#road-retry').isVisible(),true);
  await page.unroute('**/__local-road/model.onnx');
  await page.locator('#road-retry').click();
  await page.waitForFunction(()=>document.querySelector('#road-chip').dataset.state==='ready',null,{timeout:90000});
  await page.locator('#close-analysis').click();
  await page.locator('#camera').click();
  await page.waitForFunction(()=>document.querySelector('#stage').dataset.source==='camera');
  await waitFrame();
  assert.equal(await page.locator('#hud-warning').isVisible(),false,'Lane-only camera must not trigger vehicle risk.');
  await page.locator('#stop').click();
  // A same-sized corrupted artifact is rejected, not silently executed.
  const corrupt=await readFile(new URL('./.road-cache/road-segmentation-adas-0001.onnx',import.meta.url));corrupt[corrupt.length-1]^=1;
  await page.route('**/__local-road/model.onnx',route=>route.fulfill({status:200,body:corrupt,contentType:'application/octet-stream'}));
  await page.locator('#road-toggle').click();await page.locator('#road-toggle').click();
  await page.waitForFunction(()=>document.querySelector('#road-chip').dataset.state==='error',null,{timeout:15000});
  assert.match(await page.locator('#road-detail').textContent(),/SHA-256/);
  await page.unroute('**/__local-road/model.onnx');
  await page.locator('#demo').click();
  await page.waitForFunction(()=>document.querySelector('#road-detail').textContent.includes('video thật'));
  // Synthetic state/render fixtures, not measurements of model accuracy.
  const rendered=await page.evaluate(async()=>{
    const {RoadUI}=await import('/src/drive/road-ui.ts');
    const v=document.createElement('video'),chip=document.querySelector('#road-chip').cloneNode(true),detail=document.createElement('p'),retry=document.createElement('button');
    let time=0;Object.defineProperty(v,'currentTime',{get:()=>time/1000});
    const ui=new RoadUI(v,chip,detail,retry);ui.enabled=true;ui.state='ready';ui.generation=1;
    const canvas=document.createElement('canvas');canvas.width=400;canvas.height=200;const ctx=canvas.getContext('2d');
    const start=performance.now();
    function step(t,p=.5){time=t;const l=.5-p*.4,d={accepted:true,reason:'accepted',supportRows:25,span:.45,rmsPx:2,confidence:.85};const s={timeMs:t,generation:1,latencyMs:100,vector:{lines:[{id:'l',class:'lane-marking',role:'ego-left',points:[{x:l,y:.6},{x:l,y:.99}]},{id:'r',class:'lane-marking',role:'ego-right',points:[{x:l+.4,y:.6},{x:l+.4,y:.99}]}],areas:[],diagnostics:{paths:{left:d,right:d}}}};ui.sample=s;ui.lastMediaTime=time/1000;ui.hud.observe(s,t,1);ui.tick(start+t,'file',false);ctx.clearRect(0,0,400,200);ui.draw(ctx,0,0,400,200,false);const pixels=ctx.getImageData(0,0,400,200).data;let left=0,right=0;for(let y=0;y<200;y++)for(let x=0;x<400;x++)if(pixels[(y*400+x)*4+3]){if(x<200)left++;else right++;}return {state:chip.dataset.lane,left,right};}
    step(0);step(350);const tracking=step(700);
    step(1000,.15);step(1350,.15);const left=step(1700,.15);
    ui.hud.reset();step(2000);step(2350);step(2700);step(3000,.85);step(3350,.85);const right=step(3700,.85);
    time=4200;ui.lastMediaTime=time/1000;ui.tick(start+4200,'file',false);ctx.clearRect(0,0,400,200);ui.draw(ctx,0,0,400,200,false);
    const stale={state:chip.dataset.lane,ink:ctx.getImageData(0,0,400,200).data.some((v,i)=>i%4===3&&v>0)};
    return {tracking,left,right,stale};
  });
  assert.deepEqual(rendered.tracking,{state:'tracking',left:0,right:0});
  assert.equal(rendered.left.state,'left');assert.ok(rendered.left.left>0);assert.equal(rendered.left.right,0);
  assert.equal(rendered.right.state,'right');assert.ok(rendered.right.right>0);assert.equal(rendered.right.left,0);
  assert.deepEqual(rendered.stale,{state:'unknown',ink:false});
  assert.equal(errors.length,0,JSON.stringify(errors));
  await writeFile(`${out}/result.json`,JSON.stringify({status:'pass',clip,longVideoDurationS:duration,syntheticRenderChecks:rendered,checks:['quiet-default','icon-preserved','debug-opt-in-real-model-pixels','debug-off-clears-mask','paused-frame','playback','seek','toggle-clears-pixels','source-reset','slow-playback','long-video-random-access','mobile','missing-model','hash-mismatch','retry','camera','synthetic-excluded','no-depth-loading','tracking-no-lines','left-side-only','right-side-only','stale-gray-no-lines'],errors},null,2));
  console.log(`PASS road UI real-model browser checks; evidence: ${out}`);
} catch(error) {
  console.error(await page.evaluate(()=>({chip:document.querySelector('#road-chip')?.outerHTML,detail:document.querySelector('#road-detail')?.textContent,video:{ready:document.querySelector('#video')?.readyState,time:document.querySelector('#video')?.currentTime}})),errors);
  await page.screenshot({path:`${out}/failure.png`});
  throw error;
} finally {await browser.close();}
