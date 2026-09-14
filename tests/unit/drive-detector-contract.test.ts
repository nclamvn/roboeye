import test from 'node:test';
import assert from 'node:assert/strict';
import {DRIVE_GPU_DETECTOR,DRIVE_CLASS_LABELS,detectorRgbPlanes} from '../../src/drive/detector-contract';
test('drive GPU preprocessing preserves RGB channel order/rescale and the 640-square contract',()=>{
  const rgba=new Uint8ClampedArray(640*640*4);rgba.set([255,128,64,255]);
  const rgb=detectorRgbPlanes(rgba);assert.equal(rgb.length,3*640*640);
  assert.equal(rgb[0],1);assert.ok(Math.abs(rgb[640*640]-128/255)<1e-7);assert.ok(Math.abs(rgb[2*640*640]-64/255)<1e-7);
  assert.equal(rgb[1],0);assert.throws(()=>detectorRgbPlanes(new Uint8ClampedArray(4)));
  assert.deepEqual(DRIVE_CLASS_LABELS,{2:'car',5:'bus',7:'truck'});assert.equal(DRIVE_GPU_DETECTOR.width,640);
});
