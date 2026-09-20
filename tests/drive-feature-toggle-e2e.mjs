import {chromium} from 'playwright-core';
import {browserLaunchOptions,resolveBrowserExecutable} from './helpers/browser.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const out='/private/tmp/roboeye-drive-feature-toggle-qa';
await mkdir(out,{recursive:true});
const browser=await chromium.launch(await browserLaunchOptions(await resolveBrowserExecutable()));
const page=await browser.newPage({viewport:{width:1440,height:900}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
try{
  await page.goto('http://127.0.0.1:4192/drive.html?lanes=1&v=feature-toggles');
  const range=page.locator('#range-toggle'),lane=page.locator('#road-toggle');
  await Promise.all([range.waitFor({state:'visible'}),lane.waitFor({state:'visible'})]);
  assert.equal(await range.getAttribute('aria-pressed'),'false');
  assert.equal(await lane.getAttribute('aria-pressed'),'true');
  await page.locator('#file').setInputFiles('/Users/os/Downloads/Test1.mp4');
  await page.waitForFunction(()=>document.querySelector('#video').readyState>=1);
  await range.click();
  assert.equal(await range.getAttribute('aria-pressed'),'true');
  assert.equal(await lane.getAttribute('aria-pressed'),'false');
  await page.waitForFunction(()=>['loading','ready'].includes(document.querySelector('#range-toggle').dataset.state));
  await page.screenshot({path:`${out}/range-on.png`});
  await range.click();
  assert.equal(await range.getAttribute('aria-pressed'),'false');
  assert.equal(await range.getAttribute('data-state'),'off');
  await lane.click();
  assert.equal(await lane.getAttribute('aria-pressed'),'true');
  await page.setViewportSize({width:390,height:844});
  const visible=await page.evaluate(()=>['range-toggle','road-toggle'].every(id=>{const r=document.getElementById(id).getBoundingClientRect();return r.width>0&&r.height>0&&r.left>=0&&r.right<=innerWidth;}));
  assert.equal(visible,true);
  await page.screenshot({path:`${out}/mobile-lane-on.png`});
  assert.deepEqual(errors,[]);
  await writeFile(`${out}/result.json`,JSON.stringify({pass:true,checks:['two-visible-toggles','lane-only-initial-state','range-starts-pipeline','range-disables-lane-before-unfinished-analysis','range-stops','lane-restores','mobile-visible'],errors},null,2));
  console.log(`PASS feature toggle browser checks: ${out}`);
}finally{await browser.close();}
