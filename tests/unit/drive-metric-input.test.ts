import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MetricInputBuffer} from '../../src/drive/metric-input';
import {decodeDa2DriveMetric,DA2_DRIVE_PORTRAIT} from '../../src/drive/metric-contract';

test('metric input uses planar RGB [0,1], not alpha/BGR',()=>{
  const input=new MetricInputBuffer(2,1);
  assert.deepEqual(Array.from(input.update(new Uint8ClampedArray([255,0,127,0,0,255,255,12]),2,1)),[1,0,0,1,Math.fround(127/255),1]);
});
test('metric storage remains bounded and every channel is replaced',()=>{
  const input=new MetricInputBuffer(224,392),original=input.rgb;
  for(let n=0;n<100;n++){const rgba=new Uint8ClampedArray(224*392*4).fill(n);assert.equal(input.update(rgba,224,392),original);assert.ok(original.every(x=>x===Math.fround(n/255)));}
});
test('wrong shape/length does not corrupt the last input, and recovery works',()=>{
  const input=new MetricInputBuffer(2,1);input.update(new Uint8ClampedArray(8).fill(255),2,1);
  assert.throws(()=>input.update(new Uint8ClampedArray(8),1,2),/shape/);
  assert.throws(()=>input.update(new Uint8ClampedArray(4),2,1),/RGBA/);
  assert.ok(input.rgb.every(x=>x===1));input.update(new Uint8ClampedArray(8),2,1);assert.ok(input.rgb.every(x=>x===0));
});
test('invalid input dimensions fail before allocation',()=>{
  for(const [w,h] of [[0,1],[1,NaN],[1.5,2],[4097,1]])assert.throws(()=>new MetricInputBuffer(w,h));
});
test('transferring an output cannot detach input or alter the next output',()=>{
  const input=new MetricInputBuffer(224,392),depth=new Float32Array(224*392).fill(24);
  const map=decodeDa2DriveMetric(depth,224,392,DA2_DRIVE_PORTRAIT);
  structuredClone(map,{transfer:[map.depth.buffer]});assert.equal(map.depth.length,0);
  assert.equal(input.rgb.length,3*224*392);assert.equal(depth.length,224*392);
  depth.fill(30);assert.equal(decodeDa2DriveMetric(depth,224,392,DA2_DRIVE_PORTRAIT).depth[0],30);
});
