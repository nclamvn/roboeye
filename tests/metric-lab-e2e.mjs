import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {resolveBrowserExecutable} from './helpers/browser.mjs';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({headless:true,executablePath:await resolveBrowserExecutable(),args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const cases=[];
try {
  const page=await browser.newPage({viewport:{width:1100,height:850}}),errors=[],uploads=[];
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('request',r=>{if(r.method()==='POST'||r.method()==='PUT')uploads.push(r.url());});
  await page.goto('http://127.0.0.1:4192/tests/metric-depth-lab.html');
  await page.click('#fixture');await page.waitForFunction(()=>document.querySelector('#image').naturalWidth>0);
  await page.selectOption('#backend','webgpu');await page.click('#init');await page.waitForFunction(()=>!document.querySelector('#step').disabled,null,{timeout:120000});
  await page.click('#step');await page.waitForFunction(()=>window.metricLab.report().completed===1,null,{timeout:40000});
  assert.match(await page.textContent('#measurement'),/ước lượng chưa kiểm chứng/);cases.push('real public image -> metric point probe');
  const probePosition=await page.locator('#image').evaluate(img=>{
    const r=img.getBoundingClientRect(),scale=Math.min(r.width/img.naturalWidth,r.height/img.naturalHeight);
    return {x:(r.width-img.naturalWidth*scale)/2+.25*img.naturalWidth*scale,y:(r.height-img.naturalHeight*scale)/2+.4*img.naturalHeight*scale};
  });
  await page.click('#image',{position:probePosition});
  const probe=await page.evaluate(()=>window.metricLab.report().probe);
  assert.ok(Math.abs(probe[0]-.25)<.01&&Math.abs(probe[1]-.4)<.01);cases.push('pointer coordinate maps through contained image');
  await page.screenshot({path:'tests/.metric-cache/lab-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));cases.push('390px layout has no horizontal overflow (not mobile inference)');
  await page.screenshot({path:'tests/.metric-cache/lab-mobile-layout.png',fullPage:true});
  await page.click('#stop');assert.ok(await page.isDisabled('#step'));assert.equal(await page.evaluate(()=>window.metricLab.getMap()),null);cases.push('stop terminates worker and invalidates depth');
  // Corrupted local model must not load or silently pick another backend/model.
  await page.route('**/moge-small.onnx',r=>r.fulfill({status:200,body:'corrupt'}));
  await page.click('#init');await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Sai kích thước model'));
  assert.ok(await page.isDisabled('#step'));cases.push('corrupt model rejected, no fallback');await page.unroute('**/moge-small.onnx');
  await page.click('#camera');await page.waitForFunction(()=>document.querySelector('#video').readyState>=2);
  await page.click('#init');await page.waitForFunction(()=>!document.querySelector('#step').disabled,null,{timeout:120000});
  await page.click('#step');assert.ok(await page.evaluate(()=>document.querySelector('#video').paused));
  await page.click('#source-stop');
  assert.equal(await page.evaluate(()=>document.querySelector('#video').srcObject),null);
  assert.equal(await page.evaluate(()=>window.metricLab.getMap()),null);cases.push('static camera step pauses display; source reset discards pending result/releases stream');
  assert.equal(uploads.length,0);assert.deepEqual(errors,[]);cases.push('no POST/PUT or page exception');
  const result={pass:true,cases,scope:'UI/lifecycle on desktop Chromium with fake camera; no phone or road accuracy acceptance'};
  await writeFile('tests/.metric-cache/ui-e2e.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
} finally {await browser.close();}
