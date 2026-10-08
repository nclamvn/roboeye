import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {SourceLifecycle} from '../../src/drive/source-lifecycle';
import {ScreenAwake} from '../../src/drive/screen-awake';
describe('source lifecycle ownership',()=>{
  it('resumes only the active previously playing source',()=>{
    const s=new SourceLifecycle();s.begin(1,'camera');assert.equal(s.requestResume(1),true);s.playing(1);s.resumed(1);
    s.suspend('hidden',true);assert.equal(s.canCapture(1),false);assert.equal(s.requestResume(1),false);
    s.available('hidden');assert.equal(s.requestResume(1),true);assert.equal(s.requestResume(1),false);s.playing(1);s.resumed(1);assert.equal(s.canCapture(1),true);
    s.stop();s.begin(2,'camera');s.playFailed(1);assert.equal(s.owns(1),false);assert.equal(s.needsGesture(),false);
  });
  it('preserves a manually paused fixture across hide and return',()=>{
    const s=new SourceLifecycle();s.begin(1,'fixture');s.playing(1);s.paused(1);s.suspend('hidden',false);s.available('hidden');assert.equal(s.requestResume(1),false);
    assert.equal(s.requestResume(1,true),true);
  });
  it('requires both visibility and track availability; denied autoplay needs a gesture',()=>{
    const s=new SourceLifecycle();s.begin(1,'camera');s.playing(1);s.suspend('muted',true);s.suspend('hidden',false);s.available('muted');assert.equal(s.requestResume(1),false);
    s.available('hidden');assert.equal(s.requestResume(1),true);s.playFailed(1);assert.equal(s.requestResume(1),false);assert.equal(s.notice()?.action,'Tiếp tục camera');assert.equal(s.requestResume(1,true),true);
  });
  it('bounds evidence without retaining device IDs or pixels',()=>{
    const s=new SourceLifecycle();for(let i=0;i<100;i++){s.begin(i,'camera');s.stop();}assert.equal(s.report().events.length,32);assert.equal(s.report().counts.begin,100);
  });
  it('ignores obsolete pause events during opening/resuming; unexpected camera pause has retry',()=>{
    const s=new SourceLifecycle();s.begin(1,'camera');s.paused(1);assert.equal(s.requestResume(1),true);s.paused(1);s.playing(1);s.resumed(1);
    s.paused(1);assert.equal(s.canCapture(1),false);assert.equal(s.needsGesture(),true);assert.equal(s.requestResume(1),false);assert.equal(s.requestResume(1,true),true);
  });
});
describe('screen wake ownership',()=>{
  it('releases a late acquisition and does not duplicate pending requests',async()=>{
    let resolve!:(lock:{released:boolean;release:()=>Promise<void>;addEventListener:()=>void})=>void,calls=0,releases=0;
    const awake=new ScreenAwake(()=>{calls++;return new Promise(r=>{resolve=r;});});awake.setActive(true);awake.setActive(true);assert.equal(calls,1);awake.setActive(false);
    resolve({released:false,release:async()=>{releases++;},addEventListener:()=>{}});await new Promise(r=>setTimeout(r,0));assert.equal(releases,1);assert.equal(awake.report().held,false);
  });
  it('treats unsupported/denied wake locks as nonfatal',async()=>{
    const unsupported=new ScreenAwake(null);unsupported.setActive(true);assert.equal(unsupported.report().state,'unsupported');
    const denied=new ScreenAwake(async()=>{throw new Error('denied');});denied.setActive(true);await new Promise(r=>setTimeout(r,0));assert.equal(denied.report().state,'denied');assert.equal(denied.report().failures,1);
  });
  it('acquires once for a replacement source after cancelling a pending lock',async()=>{
    let resolve!:(lock:{released:boolean;release:()=>Promise<void>;addEventListener:()=>void})=>void,calls=0;
    const lock=()=>({released:false,release:async()=>{},addEventListener:()=>{}});
    const awake=new ScreenAwake(()=>{calls++;return calls===1?new Promise(r=>{resolve=r;}):Promise.resolve(lock());});
    awake.setActive(true);awake.setActive(false);awake.setActive(true);resolve(lock());await new Promise(r=>setTimeout(r,0));
    assert.equal(calls,2);assert.equal(awake.report().held,true);awake.setActive(false);
  });
});
