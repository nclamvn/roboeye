import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright-core';
import {browserLaunchOptions,resolveBrowserExecutable} from './helpers/browser.mjs';

const base=new URL(process.argv[2]??'https://roboeye-drivesense.vercel.app'),out=resolve(process.env.ROBOEYE_HTTPS_EVIDENCE_DIR??'docs/evidence/tip61e');
assert.equal(base.protocol,'https:');await mkdir(out,{recursive:true});
const release=JSON.parse(await readFile('.vercel/output/static/release.json','utf8'));
const html=await readFile('.vercel/output/static/drive.html','utf8'),entry=html.match(/src="(\/assets\/drive-[^"/]+\.js)"/)?.[1];assert.ok(entry);
const js=await readFile(`.vercel/output/static${entry}`,'utf8'),worker=js.match(/"(\/assets\/drive-range-worker-[^"/]+\.js)"/)?.[1];assert.ok(worker);
const browser=await chromium.launch(browserLaunchOptions(await resolveBrowserExecutable())),results=[],errors=[],external=[];
try{
 const page=await browser.newPage({viewport:{width:430,height:932}});page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{const u=new URL(route.request().url());if(['http:','https:'].includes(u.protocol)&&u.origin!==base.origin){external.push(u.href);return route.abort();}return route.continue();});
 await page.goto(new URL(`/drive.html?v=${release.buildFingerprint}`,base).href,{waitUntil:'networkidle',timeout:45000});
 for(const backend of ['wasm','webgpu'])for(const orientation of ['landscape','portrait']){
  const width=orientation==='portrait'?224:392,height=orientation==='portrait'?392:224;
  const bytes=await readFile(`tests/.metric-cache/da2-drive-${width}x${height}-reference.f32`);
  const reference=Array.from(new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4));
  const result=await page.evaluate(({worker,orientation,backend,width,height,reference})=>new Promise(resolve=>{
   const w=new Worker(worker,{type:'module'}),samples=[],started=performance.now(),rgba=new Uint8ClampedArray(width*height*4);let model=null,recovering=false,wrongShapeRejected=false;
   for(let y=0;y<height;y++)for(let x=0;x<width;x++){const k=4*(y*width+x);rgba[k]=Math.floor(255*x/(width-1)+.5);rgba[k+1]=Math.floor(255*y/(height-1)+.5);rgba[k+2]=Math.floor(255*(.35+.3*x/(width-1))+.5);rgba[k+3]=255;}
   const finish=error=>{clearTimeout(timer);w.terminate();resolve({pass:!error,error,backend,orientation,model,samples,wrongShapeRejected,recoveredAfterShapeError:recovering&&samples.length===4});};
   const timer=setTimeout(()=>finish('production worker timeout'),120000);
   const send=(id=samples.length+1,wrong=false)=>{const data=rgba.slice();w.postMessage({type:'frame',id,width:wrong?height:width,height:wrong?width:height,rgba:data.buffer},[data.buffer]);};
   w.onerror=e=>finish(e.message);
   w.onmessage=({data:m})=>{
    if(m.type==='ready'){if(m.backend!==backend){finish(`backend mismatch ${m.backend}`);return;}model={...m.model,readyMs:performance.now()-started};send();}
    else if(m.type==='result'){
     if(m.map.width!==width||m.map.height!==height||m.map.unit!=='metres'||m.map.depth.length!==reference.length){finish('output contract mismatch');return;}
     let maxAbsM=0;for(let i=0;i<reference.length;i++){const z=m.map.depth[i];if(!Number.isFinite(z)||z<=0||z>80.001){finish('invalid metric domain');return;}maxAbsM=Math.max(maxAbsM,Math.abs(z-reference[i]));}
     if(maxAbsM>=.01){finish(`native mismatch ${maxAbsM}`);return;}samples.push({maxAbsM,latencyMs:m.latencyMs});
     if(recovering)finish(null);else if(samples.length<3)send();else send(999,true);
    }else if(m.type==='error'){
     if(m.id===999&&m.stage==='infer'&&m.message.includes('shape')){wrongShapeRejected=true;recovering=true;send();}else finish(m.message);
    }
   };
   w.postMessage({type:'init',backend,orientation});
  }),{worker,orientation,backend,width,height,reference});
  results.push(result);console.log(`${result.pass?'PASS':'FAIL'} production ${backend} ${orientation}: ${result.error??Math.max(...result.samples.map(s=>s.maxAbsM))}`);
 }
 const report={verifiedAt:new Date().toISOString(),base:base.origin,release,pass:results.every(r=>r.pass&&r.wrongShapeRejected&&r.recoveredAfterShapeError)&&!errors.length&&!external.length,results,errors,external,
  scope:'Actual compiled production metric workers/models on canonical HTTPS in desktop Chromium at 430x932, synthetic native-reference fixture. No camera, detection/identity/publication pipeline, iPhone hardware or physical distance acceptance.'};
 await writeFile(resolve(out,'https-real-model-smoke.json'),JSON.stringify(report,null,2)+'\n');assert.equal(report.pass,true);
}finally{await browser.close();}
