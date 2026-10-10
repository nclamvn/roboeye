import assert from 'node:assert/strict';import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';import {browserLaunchOptions,resolveBrowserExecutable} from './helpers/browser.mjs';
import {startPreview,waitForPreview,stopPreview} from './helpers/preview-server.mjs';
import {join} from 'node:path';import {tmpdir} from 'node:os';
const remote=process.argv[2],base=new URL(remote??'http://localhost:4229'),build=remote?'.vercel/output/static':'dist';
const out=process.env.ROBOEYE_LITE_QA_OUTPUT??join(tmpdir(),'lite-release');await mkdir(out,{recursive:true});
const release=JSON.parse(await readFile(`${build}/release.json`,'utf8')),html=await readFile(`${build}/drive.html`,'utf8');
const entry=html.match(/src="(\/assets\/drive-[^"/]+\.js)"/)?.[1];assert.ok(entry);
const js=await readFile(`${build}${entry}`,'utf8'),worker=js.match(/"(\/assets\/drive-lite-worker-[^"/]+\.js)"/)?.[1];assert.ok(worker);
const server=remote?null:startPreview(new URL('..',import.meta.url).pathname,4229);if(server)await waitForPreview(server);
const browser=await chromium.launch(browserLaunchOptions(await resolveBrowserExecutable())),results=[],errors=[],external=[];
try{const page=await browser.newPage({viewport:{width:430,height:932}});page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.pathname==='/__fixture/bus.jpg')return route.fulfill({path:'tests/.detection-benchmark-cache/bus.jpg',contentType:'image/jpeg'});if(['http:','https:'].includes(u.protocol)&&u.origin!==base.origin){external.push(u.href);return route.abort();}return route.continue();});
 await page.goto(new URL(`/drive.html?v=${release.buildFingerprint}`,base).href,{waitUntil:'networkidle',timeout:45000});
 for(const backend of ['wasm','webgpu']){const result=await page.evaluate(({worker,backend})=>new Promise(resolve=>{
  const w=new Worker(worker,{type:'module'}),times=[];let pixels,actual;
  const finish=error=>{clearTimeout(timer);w.terminate();resolve({pass:!error,error,backend:actual,times});};const timer=setTimeout(()=>finish('compiled Nano timeout'),120000);
  w.onerror=e=>finish(e.message);w.onmessage=async({data:m})=>{try{
   if(m.type==='error')return finish(m.message);
   if(m.type==='ready'){actual=m.device;if(actual!==backend)return finish('backend mismatch');const img=new Image();img.src='/__fixture/bus.jpg';await img.decode();const c=document.createElement('canvas');c.width=480;c.height=640;const ctx=c.getContext('2d');ctx.drawImage(img,0,0,480,640);pixels=ctx.getImageData(0,0,480,640).data;}
   else if(m.type==='det'){if(!m.boxes.some(b=>b.label==='bus'&&b.score>.4))return finish('bus not detected');times.push(m.detMs);if(times.length===3)return finish(null);}
   if(m.type==='ready'||m.type==='det'){const data=pixels.slice();w.postMessage({type:'frame',width:480,height:640,rgba:data.buffer,capturedAt:times.length},[data.buffer]);}
  }catch(e){finish(String(e));}};w.postMessage({type:'init',forceWasm:backend==='wasm'});
 }),{worker,backend});assert.equal(result.pass,true,result.error);results.push(result);console.log(`PASS compiled Nano ${backend} ${base.origin}`);}
 for(const width of [375,430,1440]){await page.setViewportSize({width,height:932});await page.evaluate(()=>document.querySelector('#analysis-panel').open=true);await page.locator('#anchor-panel').scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await page.screenshot({path:join(out,`compiled-ui-${width}.png`)});}
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 await writeFile(join(out,remote?'https-compiled-nano.json':'local-compiled-nano.json'),JSON.stringify({pass:true,release,base:base.origin,results,errors,external,scope:'Compiled actual detector on bus fixture + responsive UI; desktop Chrome, NOT physical phone or metre accuracy.'},null,2));
}finally{await browser.close();if(server)await stopPreview(server);}
