import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {resolveBrowserExecutable,browserLaunchOptions} from './helpers/browser.mjs';
import {buildReplay,replayAt} from '../src/drive/replay.ts';
import {GROUND_CONTACT_RESOLUTION_PX} from '../src/drive/learned-range.ts';

const base=process.env.DRIVE_BASE??'http://127.0.0.1:4192';
const videoPath=process.env.DRIVE_VIDEO??'/Users/os/Downloads/Test1.mp4';
const reportPath=process.env.DRIVE_REPORT??'/tmp/roboeye-drive-runtime-report.json';
const screenshotPath=process.env.DRIVE_SCREENSHOT??'/tmp/roboeye-drive-runtime.png';
const browser=await chromium.launch(browserLaunchOptions(await resolveBrowserExecutable()));

function finiteRange(track){
  return track.range?.kind==='learned_optical_axis_z_m'&&Number.isFinite(track.range.distanceM);
}

function pairEvidence(a,b,timeMs,interpolated,sourceHeight){
  const lower=a.box.y1>b.box.y1?a:b;
  const upper=lower===a?b:a;
  if(!finiteRange(lower)||!finiteRange(upper)||lower.range.distanceM<=upper.range.distanceM)return null;
  const lowerHeight=lower.box.y1-lower.box.y0,upperHeight=upper.box.y1-upper.box.y0;
  const bottomGap=lower.box.y1-upper.box.y1;
  return {
    timeMs,interpolated,
    lower:{id:lower.id,label:lower.box.label,score:lower.box.score,y0:lower.box.y0,y1:lower.box.y1,height:lowerHeight,distanceM:lower.range.distanceM,reason:lower.range.reason},
    upper:{id:upper.id,label:upper.box.label,score:upper.box.score,y0:upper.box.y0,y1:upper.box.y1,height:upperHeight,distanceM:upper.range.distanceM,reason:upper.range.reason},
    bottomGap,
    contactGapPx:bottomGap*sourceHeight,
    contactResolutionPx:GROUND_CONTACT_RESOLUTION_PX,
    heightRatio:lowerHeight/upperHeight,
    distanceGap:lower.range.distanceM-upper.range.distanceM,
    distanceRatio:lower.range.distanceM/upper.range.distanceM
  };
}

try{
  const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
  const consoleErrors=[];
  page.on('pageerror',error=>consoleErrors.push(`pageerror: ${error}`));
  page.on('console',message=>{if(message.type()==='error')consoleErrors.push(`console: ${message.text()}`);});
  await page.goto(`${base}/drive.html?diagnose=range-order`,{waitUntil:'domcontentloaded'});
  await page.evaluate(()=>{
    const preset=document.querySelector('#analysis-preset');
    preset.value='balanced';
    preset.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await page.setInputFiles('#file',videoPath);
  await page.waitForFunction(()=>{
    const title=document.querySelector('#job-title')?.textContent??'';
    return title==='Đã phân tích xong'||title==='Không xử lý được video';
  },null,{timeout:15*60_000});
  const state=await page.evaluate(()=>({
    title:document.querySelector('#job-title')?.textContent,
    detail:document.querySelector('#job-detail')?.textContent,
    analysis:document.querySelector('#analysis-status')?.textContent,
    status:document.querySelector('#status')?.textContent,
    backend:document.querySelector('#backend')?.textContent,
    metricBackend:document.querySelector('#metric-backend')?.textContent,
    duration:document.querySelector('video')?.duration,
    source:document.querySelector('#source-label')?.textContent
  }));
  assert.equal(state.title,'Đã phân tích xong',JSON.stringify(state,null,2));
  await page.screenshot({path:screenshotPath,fullPage:true});
  await page.evaluate(()=>{document.querySelector('#analysis-panel').open=true;});
  const downloadPromise=page.waitForEvent('download');
  await page.evaluate(()=>document.querySelector('#report').click());
  const download=await downloadPromise;
  await download.saveAs(reportPath);
  const report=JSON.parse(await readFile(reportPath,'utf8'));
  const frames=buildReplay(report.samples,report.profile??null,report.videoZoom??1);
  const exact=[];
  for(const frame of frames){
    for(let i=0;i<frame.tracks.length;i++)for(let j=i+1;j<frame.tracks.length;j++){
      const item=pairEvidence(frame.tracks[i],frame.tracks[j],frame.timeMs,false,frame.sourceHeight??720);
      if(item)exact.push(item);
    }
  }
  const displayed=[];
  const last=frames.at(-1)?.timeMs??0;
  for(let timeMs=0;timeMs<=last;timeMs+=20){
    const view=replayAt(frames,timeMs,(report.offlineAnalysis?.stepMs??400)+5);
    for(let i=0;i<view.tracks.length;i++)for(let j=i+1;j<view.tracks.length;j++){
      const item=pairEvidence(view.tracks[i],view.tracks[j],timeMs,view.interpolated,frames[0]?.sourceHeight??720);
      if(item)displayed.push(item);
    }
  }
  const compact=(items)=>items
    .sort((a,b)=>b.distanceGap-a.distanceGap)
    .filter((item,index,array)=>index===0||item.lower.id!==array[index-1].lower.id||item.upper.id!==array[index-1].upper.id||Math.abs(item.timeMs-array[index-1].timeMs)>300)
    .slice(0,30);
  console.log(JSON.stringify({
    state,
    rangePolicy:report.rangePolicy,
    reportVersion:report.version,
    sourceDimensions:report.runtime?.sourceDimensions,
    offlineAnalysis:report.offlineAnalysis,
    sampleCount:report.samples.length,
    frameCount:frames.length,
    exactInversionCount:exact.length,
    displayedInversionCount:displayed.length,
    worstExact:compact(exact),
    worstDisplayed:compact(displayed),
    consoleErrors,
    reportPath,screenshotPath
  },null,2));
}finally{
  await browser.close();
}
