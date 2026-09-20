import test from 'node:test';
import assert from 'node:assert/strict';
import {cameraChoices,cameraConstraints} from '../../src/drive/camera-source';
import {offlinePlan} from '../../src/drive/offline-plan';
import {VehicleTracker} from '../../src/drive/tracking';
import type {DetBox} from '../../src/detection-types';
import type {RangeEstimate} from '../../src/drive/geometry';

test('camera inventory keeps concrete laptop/phone devices and safe fallback labels',()=>{
  const devices=[
    {kind:'audioinput',deviceId:'mic',label:'Mic'},
    {kind:'videoinput',deviceId:'mac',label:'FaceTime HD Camera'},
    {kind:'videoinput',deviceId:'phone',label:'iPhone Camera'},
    {kind:'videoinput',deviceId:'phone',label:'duplicate'},
    {kind:'videoinput',deviceId:'usb',label:''}
  ] as const;
  assert.deepEqual(cameraChoices(devices),[
    {deviceId:'mac',label:'FaceTime HD Camera'},
    {deviceId:'phone',label:'iPhone Camera'},
    {deviceId:'usb',label:'Camera 3'}
  ]);
  assert.deepEqual(cameraConstraints('phone').video,{width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30,max:60},deviceId:{exact:'phone'}});
  assert.deepEqual((cameraConstraints('').video as MediaTrackConstraints).facingMode,{ideal:'environment'});
});

test('offline presets disclose deterministic quality/speed tradeoff for a three-minute clip',()=>{
  const quality=offlinePlan(180000,'quality'),balanced=offlinePlan(180000,'balanced'),fast=offlinePlan(180000,'fast');
  assert.equal(quality.times.length,901);assert.equal(balanced.times.length,451);assert.equal(fast.times.length,181);
  assert.equal(balanced.samplesPerSecond,2.5);assert.match(fast.disclosure,/bỏ lỡ/);
  assert.throws(()=>offlinePlan(1000,'other' as never),/không hợp lệ/);
});

test('same-frame learned range enriches the current track without advancing identity or time',()=>{
  const tracker=new VehicleTracker(),box:DetBox={label:'car',score:.9,x0:.3,y0:.3,x1:.7,y1:.8};
  tracker.observe([box],100,10,null,1280,720);
  const before=tracker.snapshot(100,10,true);assert.equal(before.length,1);assert.equal(before[0].range.distanceM,null);
  const range:RangeEstimate={kind:'learned_optical_axis_z_m',provenance:'learned-unverified',distanceM:24,lateralM:null,sigmaM:4,interval:[16,32],intervalCalibrated:false,reason:'same-frame local depth'};
  assert.equal(tracker.enrichLearnedRanges([box],[range],100,1280,720),1);
  const after=tracker.snapshot(100,20,true);assert.equal(after[0].id,before[0].id);assert.equal(after[0].range.distanceM,24);
  tracker.observe([box],300,30,null,1280,720,null,true);
  assert.equal(tracker.snapshot(300,30,true)[0].range.distanceM,24,'a fresh detector frame preserves recent same-frame depth');
  tracker.observe([box],550,40,null,1280,720,null,true);
  assert.equal(tracker.snapshot(550,40,true)[0].range.distanceM,null,'live depth expires rather than being presented as current');
  assert.equal(tracker.enrichLearnedRanges([box],[range],99,1280,720),0,'stale depth cannot alter a newer track');
});
