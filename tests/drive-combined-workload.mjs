import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {resolveBrowserExecutable,browserLaunchOptions} from './helpers/browser.mjs';
import {startDev,waitForPreview,stopPreview} from './helpers/preview-server.mjs';

const root=new URL('..',import.meta.url).pathname,out=process.env.ROBOEYE_WORKLOAD_OUTPUT??'/private/tmp/roboeye-tip61e-workload',port=4228;
const gpuOnly=process.argv.includes('--gpu-only');
await mkdir(out,{recursive:true});const server=startDev(root,port);await waitForPreview(server,60000);
const browser=await chromium.launch(browserLaunchOptions(await resolveBrowserExecutable())),results=[],errors=[],external=[],warnings=[];
let passes=true;
try{
 for(const orientation of ['landscape','portrait']){
  let reference=null;
  for(const [backend,precision,order] of [['webgpu','fp32','before'],['webgpu','fp16','candidate'],['webgpu','fp32','after'],...gpuOnly?[]:[['wasm','fp32','cpu-control']]]){
   const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
   page.on('console',m=>{if(['warning','error'].includes(m.type()))warnings.push({backend,precision,orientation,text:m.text().slice(0,1200)});});
   await page.route('**/*',route=>{const u=new URL(route.request().url());if(['http:','https:'].includes(u.protocol)&&u.hostname!=='127.0.0.1'){external.push(u.href);return route.abort();}return route.continue();});
   await page.goto(`http://127.0.0.1:${port}/tests/drive-combined-workload.html`);await page.waitForFunction(()=>window.workloadReady);
   const result=await page.evaluate(config=>window.runWorkload(config),{orientation,backend,precision,references:reference});
   if(result.pass&&order==='before')reference=result.maps;
   delete result.maps;results.push({...result,order});
   console.log(`${result.pass?'PASS':'FAIL'} ${orientation} ${backend} ${precision} ${order}: ${JSON.stringify(result.results.map(x=>({scene:x.scene,...x.summary,parity:x.parity})))} ${result.errors.join(' ').slice(0,1000)}`);
   if(precision==='fp32'&&!result.pass)passes=false;
   await page.close();
  }
 }
 const promotion=results.filter(x=>x.precision==='fp16').map(candidate=>{
  const before=results.find(x=>x.orientation===candidate.orientation&&x.order==='before'),after=results.find(x=>x.orientation===candidate.orientation&&x.order==='after');
  const numerical=candidate.pass&&candidate.results.every(s=>s.parity&&s.parity.maxAbsM<=.25&&s.parity.p99Relative<=.005);
  const controlsStable=before.pass&&after.pass&&before.results.every((s,i)=>Math.abs(after.results[i].summary.joinedP50Ms/s.summary.joinedP50Ms-1)<=.2);
  const benefit=numerical&&controlsStable&&candidate.results.every((s,i)=>s.summary.joinedP50Ms<=.85*Math.min(before.results[i].summary.joinedP50Ms,after.results[i].summary.joinedP50Ms)&&s.summary.joinedP95Ms<=Math.min(before.results[i].summary.joinedP95Ms,after.results[i].summary.joinedP95Ms));
  return {orientation:candidate.orientation,numerical,controlsStable,benefit,eligibleForFurtherDeviceTest:benefit,productionPromotion:false};
 });
 const report={verifiedAt:new Date().toISOString(),pass:passes&&errors.length===0&&external.length===0,results,promotion,errors,external,warnings,scope:'Actual simultaneous pinned detector+depth workers on local desktop Chrome. Static bus pixels plus native gradient; numerical/runtime experiment, not live-camera tracking, phone thermal behaviour or physical metre accuracy.'};
 await writeFile(`${out}/result.json`,JSON.stringify(report,null,2)+'\n');assert.equal(report.pass,true);assert.deepEqual(external,[]);
 console.log(JSON.stringify({pass:report.pass,promotion,out},null,2));
}finally{await browser.close();await stopPreview(server);}
