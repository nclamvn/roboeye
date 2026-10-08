import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {resolveBrowserExecutable,browserLaunchOptions} from './helpers/browser.mjs';
import {startDev,waitForPreview,stopPreview} from './helpers/preview-server.mjs';
const root=new URL('..',import.meta.url).pathname,out='/private/tmp/roboeye-tip61d-aspect',port=4227;
await mkdir(out,{recursive:true});const server=startDev(root,port);await waitForPreview(server,60000);
const browser=await chromium.launch(browserLaunchOptions(await resolveBrowserExecutable())),results=[],external=[],errors=[];
try{
 for(const backend of ['wasm','webgpu'])for(const orientation of ['landscape','portrait']){
  const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(['http:','https:'].includes(url.protocol)&&url.hostname!=='127.0.0.1'){external.push(url.href);return route.abort();}return route.continue();});
  await page.goto(`http://127.0.0.1:${port}/tests/drive-metric-aspect-parity.html?orientation=${orientation}&backend=${backend}`);
  await page.waitForFunction(()=>window.aspectParity&&window.aspectParity.status!=='running',null,{timeout:130000});
  const result=await page.evaluate(()=>window.aspectParity);assert.equal(result.status,'pass',result.error);assert.equal(result.wrongShapeRejected,true);assert.equal(result.recoveredAfterShapeError,true);results.push(result);
  console.log(`PASS ${backend} ${orientation}: maxAbs ${Math.max(...result.samples.map(s=>s.maxAbsM))} m`);await page.close();
 }
 assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
 await writeFile(`${out}/result.json`,JSON.stringify({pass:true,results,external,errors,scope:'Pinned real graphs versus native float reference on desktop Chrome; synthetic RGB fixture, not physical distance or mobile performance.'},null,2));
}finally{await browser.close();await stopPreview(server);}
