import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {resolveBrowserExecutable,browserLaunchOptions} from './helpers/browser.mjs';
const out=process.env.ROBOEYE_HARDWARE_OUTPUT??'/private/tmp/roboeye-tip62-hardware';await mkdir(out,{recursive:true});
const options=browserLaunchOptions(await resolveBrowserExecutable());
options.args=options.args.filter(arg=>!arg.startsWith('--use-fake-')); // Never mark synthetic cameras as hardware PASS.
const browser=await chromium.launch(options);
try{
 const context=await browser.newContext({permissions:['camera'],acceptDownloads:true});const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`${process.env.DRIVE_BASE??'http://127.0.0.1:4192'}/drive.html?v=physical-probe`,{waitUntil:'domcontentloaded'});
 const result=await page.evaluate(async()=>{
  if(!navigator.mediaDevices)return {status:'NOT TESTED',reason:'mediaDevices unavailable'};
  let cancelled=false;
  const timeout=new Promise(resolve=>setTimeout(()=>{cancelled=true;resolve({status:'NOT TESTED',reason:'OS camera permission/device did not resolve in 10s'});},10000));
  const attempt=(async()=>{try{
   const stream=await navigator.mediaDevices.getUserMedia({video:true,audio:false});
   if(cancelled){stream.getTracks().forEach(track=>track.stop());return {status:'NOT TESTED',reason:'Late acquisition cancelled'};}
   const track=stream.getVideoTracks()[0],settings=track?.getSettings();stream.getTracks().forEach(track=>track.stop());
   return {status:'DEVICE OPEN ONLY',settings:{width:settings?.width,height:settings?.height,frameRate:settings?.frameRate},reason:'Actual stream acquired without fake device; no distance/soak acceptance inferred'};
  }catch(error){return {status:'NOT TESTED',reason:error instanceof Error?`${error.name}: ${error.message}`:String(error)};}})();
  return await Promise.race([attempt,timeout]);
 });
 let app=null;
 if(result.status==='DEVICE OPEN ONLY'){
  await page.click('#camera');
  try{
   await page.waitForFunction(()=>document.querySelector('#stage').dataset.source==='camera'&&!document.querySelector('video').paused,null,{timeout:15000});
   const frames=await page.evaluate(async()=>{
    const video=document.querySelector('video'),start=video.currentTime;
    await new Promise(resolve=>setTimeout(resolve,5000));return {start,end:video.currentTime,width:video.videoWidth,height:video.videoHeight,paused:video.paused};
   });
   await page.waitForTimeout(5000);const downloading=page.waitForEvent('download');await page.evaluate(()=>document.querySelector('#report').click());
   const download=await downloading;await download.saveAs(`${out}/camera-session.json`);const report=JSON.parse(await readFile(`${out}/camera-session.json`,'utf8'));
   app={status:frames.end>frames.start&&!frames.paused?'STREAM ADVANCES':'NOT TESTED',frames,execution:report.diagnostics?.manifest.execution,
    backends:report.diagnostics?.backends,ledger:report.diagnostics?.ledger,sourceLifecycle:report.diagnostics?.sourceLifecycle,errors,
    scope:'Browser-selected OS stream, actual workers. Not verified as built-in laptop camera; no traffic/distance ground truth or sustained soak'};
  }catch(error){app={status:'NOT TESTED',reason:error.message,errors};}
  await page.evaluate(()=>document.querySelector('#stop').click());
 }
 const evidence={measuredUtc:new Date().toISOString(),fakeDeviceFlags:false,result,app,phone:'NOT TESTED: no tool-connected physical phone',scope:'No camera pixels captured to files or uploaded; acquisition/frame-flow proof only'};
 await writeFile(`${out}/camera-probe.json`,JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
}finally{await browser.close();}
