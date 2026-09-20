import {chromium} from 'playwright-core';
import {browserLaunchOptions,resolveBrowserExecutable} from './helpers/browser.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const out='/private/tmp/roboeye-road-icon-anchor-qa';await mkdir(out,{recursive:true});
const browser=await chromium.launch(await browserLaunchOptions(await resolveBrowserExecutable()));
const page=await browser.newPage();const errors=[],results=[];page.on('pageerror',e=>errors.push(e.message));
async function check(name){
  await page.waitForFunction(()=>{const v=document.querySelector('#video'),s=document.querySelector('#stage').getBoundingClientRect(),i=document.querySelector('#road-chip').getBoundingClientRect();if(!v.videoWidth)return false;const scale=Math.min(s.width/v.videoWidth,s.height/v.videoHeight),w=v.videoWidth*scale,h=v.videoHeight*scale,x=s.x+(s.width-w)/2,y=s.y+(s.height-h)/2;return i.x>=x&&i.y>=y&&i.right<=x+w+1&&i.bottom<=y+h+1&&Math.abs(i.x-x-12)<1;});
  const result=await page.evaluate(()=>{const v=document.querySelector('#video'),s=document.querySelector('#stage').getBoundingClientRect(),i=document.querySelector('#road-chip').getBoundingClientRect();const scale=Math.min(s.width/v.videoWidth,s.height/v.videoHeight),w=v.videoWidth*scale,h=v.videoHeight*scale;return {video:{x:s.x+(s.width-w)/2,y:s.y+(s.height-h)/2,w,h},icon:{x:i.x,y:i.y,w:i.width,h:i.height},fullscreen:!!document.fullscreenElement};});
  if(result.video.y>150)assert.ok(Math.abs(result.icon.y-result.video.y-12)<1);
  results.push({name,...result});await page.screenshot({path:`${out}/${name}.png`});
}
try{
  await page.goto('http://127.0.0.1:4192/drive.html?lanes=1&v=video-anchor');
  await page.locator('#file').setInputFiles('/Users/os/Downloads/Test1.mp4');
  await page.waitForFunction(()=>document.querySelector('#video').readyState>=2);
  await page.evaluate(async()=>{const v=document.querySelector('#video');v.pause();await new Promise(resolve=>{v.addEventListener('seeked',resolve,{once:true});v.currentTime=1;});});
  await page.waitForFunction(()=>{const v=document.querySelector('#video');return v.readyState>=2&&!v.seeking&&Math.abs(v.currentTime-1)<0.1;});
  for(const [name,width,height] of [['portrait-window',1504,1692],['desktop',1440,900],['phone',390,844],['ultrawide',1800,650]]){
    await page.setViewportSize({width,height});await check(name);
  }
  await page.locator('#fullscreen').click();await page.waitForFunction(()=>!!document.fullscreenElement);await check('fullscreen');
  await page.locator('#fullscreen').click();await page.waitForFunction(()=>!document.fullscreenElement);await check('exit-fullscreen');
  // Actual synthetic portrait camera stream tests source-aspect change without a refresh.
  await page.evaluate(async()=>{const canvas=document.createElement('canvas');canvas.width=360;canvas.height=640;const ctx=canvas.getContext('2d');ctx.fillStyle='#305b70';ctx.fillRect(0,0,360,640);const v=document.querySelector('#video');v.srcObject=canvas.captureStream(1);await v.play();});
  await page.waitForFunction(()=>document.querySelector('#video').videoWidth===360);await check('portrait-source');
  assert.deepEqual(errors,[]);await writeFile(`${out}/result.json`,JSON.stringify({status:'pass',results,errors},null,2));console.log(`PASS ${results.length} video-anchor browser cases: ${out}`);
}finally{await browser.close();}
