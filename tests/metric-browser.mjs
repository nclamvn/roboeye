import {chromium} from 'playwright-core';
import {readFile,writeFile} from 'node:fs/promises';
import {resolveBrowserExecutable} from './helpers/browser.mjs';
const backend=process.argv[2]||'wasm',base=process.env.METRIC_BASE||'http://127.0.0.1:4192';
const model=process.argv[3]||'moge';
const args=process.env.METRIC_UNSAFE_GPU==='1'?['--enable-unsafe-webgpu']:[];
const runs=Number(process.env.METRIC_RUNS||4);
if(!Number.isInteger(runs)||runs<2||runs>200)throw Error('METRIC_RUNS must be 2–200');
const browser=await chromium.launch({headless:true,executablePath:await resolveBrowserExecutable(),args});
const errors=[];
try {
  const page=await browser.newPage();page.on('pageerror',e=>{errors.push(String(e));console.log('PAGE ERROR',String(e));});
  page.on('console',m=>{if(m.type()==='error')console.log('CONSOLE ERROR',m.text());});
  page.on('requestfailed',r=>console.log('REQUEST FAILED',r.url(),r.failure()?.errorText));
  await page.goto(`${base}/tests/metric-depth-lab.html`);
  await page.click('#reference');await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Fixture tham chiếu cùng'));
  await page.selectOption('#model',model);await page.selectOption('#backend',backend);await page.click('#init');
  try{await page.waitForFunction(()=>!document.querySelector('#step').disabled||/LỖI|Timeout|Worker lỗi/.test(document.querySelector('#status').textContent),null,{timeout:130000});}
  catch(e){console.log('STATUS',await page.textContent('#status'));throw e;}
  if(await page.isDisabled('#step'))throw Error(await page.textContent('#status'));
  for(let run=1;run<=runs;run++){
    await page.click('#step');
    await page.waitForFunction(n=>window.metricLab.report().completed>=n||window.metricLab.report().lastError,run,{timeout:60000});
    const error=await page.evaluate(()=>window.metricLab.report().lastError);if(error)throw Error(error);
  }
  const bytes=await readFile(new URL(`./.metric-cache/${model==='moge'?'depth':'da2-depth'}.bin`,import.meta.url));
  const expected=Array.from(new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4));
  const parity=await page.evaluate(expected=>{
    const map=window.metricLab.getMap();let maxAbs=0,sum=0,n=0,maskDisagreements=0;
    if(map.depth.length!==expected.length)throw Error('Shape mismatch');
    for(let i=0;i<expected.length;i++){
      // JSON transport converts non-finite references to null.
      const a=map.depth[i],b=expected[i],valid=Number.isFinite(a),ref=b!==null&&Number.isFinite(b);
      if(valid!==ref){maskDisagreements++;continue;}if(!valid)continue;
      const d=Math.abs(a-b);maxAbs=Math.max(maxAbs,d);sum+=d;n++;
    }
    return {maxAbsM:maxAbs,meanAbsM:n?sum/n:null,valid:n,maskDisagreements,focal:map.focal,shift:map.shift};
  },expected);
  const adapter=await page.evaluate(async()=>{
    const adapter=await navigator.gpu?.requestAdapter();if(!adapter)return null;
    return {info:adapter.info?{vendor:adapter.info.vendor,architecture:adapter.info.architecture,device:adapter.info.device,description:adapter.info.description}:null,features:[...adapter.features]};
  });
  const report=await page.evaluate(()=>window.metricLab.report());
  const result={backend,browserVersion:browser.version(),headless:true,flags:args,adapter,parity,report,errors,
    pass:parity.valid>100&&parity.maxAbsM<.01&&parity.maskDisagreements===0&&errors.length===0,
    scope:'Graph + recovery parity on identical public-image tensor; NOT true-distance accuracy, mobile acceptance, or normal-browser feature support.'};
  await writeFile(new URL(`./.metric-cache/browser-${model}-${backend}-${args.length?'forced':'normal'}-${runs}.json`,import.meta.url),JSON.stringify(result,null,2));
  console.log(JSON.stringify({...result,report:{...report,samples:report.samples.map(s=>({computeMs:s.computeMs,postMs:s.postMs,ageMs:s.ageMs}))}},null,2));
  if(!result.pass)process.exitCode=1;
} finally {await browser.close();}
