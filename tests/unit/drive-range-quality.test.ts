import test from 'node:test';
import assert from 'node:assert/strict';
import type {DetBox} from '../../src/detection-types';
import {DA2_DRIVE,type MetricMap} from '../../src/drive/metric-contract';
import {estimateLearnedVehicleRange,letterboxTransform,validateLearnedRanges} from '../../src/drive/learned-range';
import {estimateGroundRange,type RangeEstimate} from '../../src/drive/geometry';
import {cropCameraProfile,focalFromHorizontalFov} from '../../src/drive/camera-intrinsics';
import {DEMO_PROFILE,demoFrame} from '../../src/drive/demo';
import {buildReplay} from '../../src/drive/replay';

const box=(h=.2):DetBox=>({label:'car',score:.95,x0:.4,x1:.6,y0:.5-h,y1:.5});
const learned=(distanceM:number):RangeEstimate=>({kind:'learned_optical_axis_z_m',provenance:'learned-unverified',distanceM,lateralM:null,
  sigmaM:distanceM*.1,interval:[distanceM*.8,distanceM*1.2],intervalCalibrated:false,reason:'analytic fixture, not physical ground truth'});
const map:MetricMap={width:DA2_DRIVE.width,height:DA2_DRIVE.height,depth:new Float32Array(DA2_DRIVE.width*DA2_DRIVE.height).fill(12),
  unit:'metres',distanceKind:'optical-axis-z',provenance:'learned-unverified',focal:null,shift:null,reprojectionRmse:null};
test('overtaker truncation and tiny distant ROI do not produce convincing but unsupported metres',()=>{
  const transform=letterboxTransform(1280,720,DA2_DRIVE.width,DA2_DRIVE.height);
  for(const b of [{...box(),x0:0},{...box(),x1:1},{...box(),y1:1},{...box(),x0:.5,x1:.52,y0:.47,y1:.5}]){
    const range=estimateLearnedVehicleRange(map,b,transform);assert.equal(range.distanceM,null);assert.ok(range.reason.length>10);
  }
});
test('known zoom fails closed without dividing neural metres; centred crop updates K mathematically',()=>{
  const z=validateLearnedRanges([box()],[learned(12)],2)[0]!;assert.equal(z.distanceM,null);assert.match(z.reason,/tiêu cự/);
  const p=cropCameraProfile(DEMO_PROFILE,{x:320,y:180,width:640,height:360,outputWidth:1280,outputHeight:720});
  assert.equal(p.fx,1800);assert.equal(p.fy,1800);assert.equal(p.cx,640);assert.equal(p.cy,360);
  assert.ok(Math.abs(focalFromHorizontalFov(1280,90,2)-1280)<1e-8);
  assert.throws(()=>focalFromHorizontalFov(1280,0,2));assert.throws(()=>validateLearnedRanges([box()],[learned(12)],NaN));
  // Independent ground point projection, near and far, unchanged by 2x crop.
  for(const zM of [3,40,80]){
    const heightM=DEMO_PROFILE.heightM,u=DEMO_PROFILE.cx,v=DEMO_PROFILE.cy+DEMO_PROFILE.fy*heightM/zM;
    const b={...box(),x0:(u-10)/1280,x1:(u+10)/1280,y0:(v-60)/720,y1:v/720};
    const zoomed={...b,x0:(b.x0-.25)*2,x1:(b.x1-.25)*2,y0:(b.y0-.25)*2,y1:(b.y1-.25)*2};
    const broad={...DEMO_PROFILE,minM:2,maxM:100,pixelSigma:1,pitchSigmaDeg:.05};
    // 3m is outside this centred crop: correctly reject it instead of claiming coverage.
    if(zoomed.y1>=.99){assert.equal(estimateGroundRange(zoomed,{...p,minM:2,maxM:100},1280,720).distanceM,null);continue;}
    const result=estimateGroundRange(zoomed,{...p,minM:2,maxM:100,pixelSigma:1,pitchSigmaDeg:.05},1280,720);
    assert.ok(Math.abs(result.distanceM!-zM)<1e-8,JSON.stringify(result));
    assert.ok(Math.abs(estimateGroundRange(b,broad,1280,720).distanceM!-zM)<1e-8);
  }
});
test('compressed A-B / A-C depth is flagged, never force-corrected by adding imagined B-C metres',()=>{
  const b={...box(.2),y0:.42,y1:.62},c={...box(.065),y0:.46,y1:.525};
  const raw=[learned(40),learned(50)],copy=structuredClone(raw);
  const ranges=validateLearnedRanges([b,c],raw);assert.equal(ranges[0]!.distanceM,40);assert.equal(ranges[1]!.distanceM,null);
  assert.match(ranges[1]!.reason,/nén/);assert.deepEqual(raw,copy);
  assert.equal(validateLearnedRanges([b,c],[learned(40),learned(75)])[1]!.distanceM,75);
  assert.equal(validateLearnedRanges([b,{...c,x0:.75,x1:.9}],raw)[1]!.distanceM,50,'no claim about side lane ordering');
});
test('cross-lane screenshot inversion abstains instead of swapping or publishing wrong metres',()=>{
  // Normalized from Screenshot 2026-09-17 at 10.02.10 (728×496).
  const left:DetBox={label:'car',score:.9,x0:135/728,x1:236/728,y0:318/496,y1:405/496};
  const right:DetBox={label:'car',score:.9,x0:472/728,x1:573/728,y0:313/496,y1:393/496};
  const inverted=validateLearnedRanges([left,right],[learned(70),learned(56)]);
  assert.equal(inverted[0]!.distanceM,null);assert.equal(inverted[1]!.distanceM,null);
  assert.match(inverted[0]!.reason,/đảo thứ tự/);
  const ordered=validateLearnedRanges([left,right],[learned(56),learned(70)]);
  assert.equal(ordered[0]!.distanceM,56);assert.equal(ordered[1]!.distanceM,70);
});
test('cross-lane ground-contact ordering catches the 57 m / 52 m regression when apparent heights are neutral',()=>{
  // Normalized from Screenshot 2026-09-17 at 10.16.05 (742×608). The two
  // same-class boxes have almost equal height, but the left tyre/contact proxy
  // is materially lower in the image and therefore nearer on a level road.
  const left:DetBox={label:'car',score:.9,x0:139/742,x1:244/742,y0:381/608,y1:473/608};
  const right:DetBox={label:'car',score:.9,x0:471/742,x1:580/742,y0:370/608,y1:463/608};
  const inverted=validateLearnedRanges([left,right],[learned(57),learned(52)]);
  assert.equal(inverted[0]!.distanceM,null);assert.equal(inverted[1]!.distanceM,null);
  assert.match(inverted[0]!.reason,/đảo thứ tự/);
});
test('vehicle subclass flicker cannot bypass the 51 m / 45 m ground-contact regression',()=>{
  // Normalized from Screenshot 2026-09-17 at 10.21.41 (700×530). RT-DETR
  // car/truck/bus are competing labels and the tracker already tolerates their
  // flicker, so raw subclass must not disable vehicle ground ordering.
  const left:DetBox={label:'car',score:.9,x0:70/700,x1:186/700,y0:306/530,y1:406/530};
  const right:DetBox={label:'truck',score:.9,x0:430/700,x1:543/700,y0:306/530,y1:395/530};
  const inverted=validateLearnedRanges([left,right],[learned(51),learned(45)]);
  assert.equal(inverted[0]!.distanceM,null);assert.equal(inverted[1]!.distanceM,null);
  assert.match(inverted[0]!.reason,/đảo thứ tự/);
});
test('ordinal publication invariant uses source-pixel contact resolution and reviewed vehicle labels',()=>{
  const a:DetBox={label:'car',score:.9,x0:.1,x1:.23,y0:.61,y1:.79};
  const ambiguous={...a,x0:.7,x1:.83,y0:.605,y1:.79+1/720};
  assert.deepEqual(validateLearnedRanges([a,ambiguous],[learned(70),learned(56)]).map(r=>r!.distanceM),[70,56]);
  const truck:DetBox={...ambiguous,label:'truck',y0:.58,y1:.76};
  assert.deepEqual(validateLearnedRanges([a,truck],[learned(70),learned(56)]).map(r=>r!.distanceM),[null,null]);
  const person:DetBox={...truck,label:'person'};
  assert.deepEqual(validateLearnedRanges([a,person],[learned(70),learned(56)]).map(r=>r!.distanceM),[70,56]);
  const clipped={...a,x0:0,y0:.58,y1:.8};
  assert.deepEqual(validateLearnedRanges([clipped,ambiguous],[learned(70),learned(56)]).map(r=>r!.distanceM),[70,56]);
  const sizeContradiction={...a,x0:.7,x1:.9,y0:.55,y1:.785};
  assert.deepEqual(validateLearnedRanges([a,sizeContradiction],[learned(70),learned(56)]).map(r=>r!.distanceM),[null,null],
    'physical vehicle height cannot overrule a resolved tyre/contact row');
  assert.throws(()=>validateLearnedRanges([a],[learned(70)],1,0),/Chiều cao nguồn/);
});
test('Test1.mp4 runtime trace rejects the exact 51.23 m / 44.68 m side-vehicle inversion',()=>{
  // Captured from the browser-generated report on 2026-09-17, frame 0 at
  // 1280×720. This is the source trace behind the user screenshot, not a box
  // reconstructed from the resized screenshot.
  const left:DetBox={label:'car',score:.9055399192257336,x0:.40487808361649513,y0:.6621259897947311,x1:.4542520008981228,y1:.7373024970293045};
  const right:DetBox={label:'car',score:.89399216726949,x0:.5663659851998091,y0:.6609205342829227,x1:.6147811133414507,y1:.7290317676961422};
  assert.ok((left.y1-right.y1)*720>5.9);
  const out=validateLearnedRanges([left,right],[learned(51.22602081298828),learned(44.677467346191406)],1,720);
  assert.deepEqual(out.map(range=>range!.distanceM),[null,null]);
  assert.match(out[0]!.reason,/đảo thứ tự/);
});
test('applied geometry takes priority, even if learned depth claims a plausible wrong distance',()=>{
  const boxes=demoFrame(0).boxes;
  const raw=[0,200].map(timeMs=>({timeMs,width:1280,height:720,boxes,latencyMs:10,learnedRanges:boxes.map(()=>learned(12))}));
  const frames=buildReplay(raw,DEMO_PROFILE);
  assert.equal(frames[0].tracks[0].range.provenance,'user-profile-geometry');
  assert.ok(Math.abs(frames[0].tracks[0].range.distanceM!-34)<1e-8);
  const mismatch=buildReplay(raw,{...DEMO_PROFILE,width:1920});assert.equal(mismatch[0].tracks[0].range.distanceM,null);
  assert.match(mismatch[0].tracks[0].range.reason,/calibration/);
});
