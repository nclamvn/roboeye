import test from 'node:test';
import assert from 'node:assert/strict';
import {VehicleTracker,type DriveTrack} from '../../src/drive/tracking';
import {assessRisk,corridorHalfWidth,pathEvidence,statutoryDistanceM} from '../../src/drive/risk';
import {unknownRange} from '../../src/drive/geometry';

const box=(center:number,size:number,score=.96)=>({label:'car',score,x0:center-size/2,x1:center+size/2,y0:.72-size,y1:.72});

function track(patch:Partial<DriveTrack>={}):DriveTrack {
  return {id:1,box:box(.5,.18),ageMs:0,range:unknownRange('fixture'),closingSpeed:null,
    opticalTtcS:null,rangeTtcS:null,motionConfidence:.9,status:'tracked',...patch};
}

test('optical expansion produces a scale-free TTC without metric range',()=>{
  const tracker=new VehicleTracker();
  for(const timeMs of [0,200,400,600,800]){
    const size=.12*Math.exp(timeMs/4000);
    tracker.observe([box(.5,size)],timeMs,timeMs,null,1280,720);
  }
  const result=tracker.snapshot(800,800)[0];
  assert.equal(result.range.distanceM,null);
  assert.ok(result.opticalTtcS!==null);
  assert.ok(Math.abs(result.opticalTtcS!-4)<.35,String(result.opticalTtcS));
  assert.ok(result.motionConfidence>.3);
});

test('corridor grows toward camera and rejects a side-lane target',()=>{
  assert.ok(corridorHalfWidth(.95)>corridorHalfWidth(.45));
  assert.equal(pathEvidence(track()).inPath,true);
  assert.equal(pathEvidence(track({box:box(.08,.08)})).inPath,false);
});

test('TT38 reference table abstains where no fixed value exists',()=>{
  assert.equal(statutoryDistanceM(59),null);
  assert.equal(statutoryDistanceM(60),35);
  assert.equal(statutoryDistanceM(80),55);
  assert.equal(statutoryDistanceM(100),70);
  assert.equal(statutoryDistanceM(120),100);
  assert.equal(statutoryDistanceM(121),null);
});

test('risk policy selects the in-path threat and never turns conflicting TTC red',()=>{
  const side=track({id:2,box:box(.05,.08),opticalTtcS:.8});
  const primary=track({id:1,opticalTtcS:1.2});
  const result=assessRisk([side,primary],{speedKph:80,adverse:false});
  assert.equal(result.primary?.track.id,1);
  assert.equal(result.primary?.level,'critical');
  assert.equal(result.referenceDistanceM,55);

  const conflict=assessRisk([track({opticalTtcS:1,rangeTtcS:4})],{speedKph:80,adverse:true}).primary!;
  assert.equal(conflict.ttcAgreement,'conflict');
  assert.equal(conflict.level,'caution');
  assert.ok(conflict.confidence<=.39);
  assert.equal(conflict.referenceDistanceM,68.75);
});

test('distance and ego speed expose headway without pretending unknown speed is known',()=>{
  const range={...unknownRange('fixture'),distanceM:28,sigmaM:2,interval:[24,32] as [number,number],provenance:'learned-unverified' as const,kind:'learned_optical_axis_z_m' as const};
  const moving=assessRisk([track({range})],{speedKph:72,adverse:false}).primary!;
  assert.equal(moving.headwayS,1.4);
  assert.equal(moving.level,'caution');
  assert.equal(assessRisk([track({range})],{speedKph:0,adverse:false}).primary!.headwayS,null);
});

test('analysed replay cannot flicker red at the 5 Hz sample cadence; live freshness remains intact',()=>{
  const range={...unknownRange('fixture'),distanceM:12,sigmaM:1,provenance:'learned-unverified' as const};
  const config={speedKph:80,adverse:false};
  for(const ageMs of [0,16,80,120,199,205]){
    const recorded=assessRisk([track({range,ageMs})],config,'analysed-replay');
    assert.equal(recorded.primary?.level,'critical',`sample offset ${ageMs}`);
    assert.equal(recorded.evidenceMode,'analysed-replay');
  }
  assert.equal(assessRisk([track({range,ageMs:0})],config).primary?.level,'critical');
  const live=assessRisk([track({range,ageMs:120})],config);
  assert.equal(live.evidenceMode,'live');
  assert.notEqual(live.primary?.level,'critical');
});

test('recorded risk still fails closed for out-of-window, conflicting, weak and absent evidence',()=>{
  const range={...unknownRange('fixture'),distanceM:12,sigmaM:1,provenance:'learned-unverified' as const};
  const config={speedKph:80,adverse:false};
  for(const ageMs of [-1,206,500,Infinity,Number.NaN]){
    assert.notEqual(assessRisk([track({range,ageMs})],config,'analysed-replay').primary?.level,'critical');
  }
  const weak=track({range,box:box(.5,.18,.4)});
  const conflict=track({range,opticalTtcS:1,rangeTtcS:4});
  for(const candidate of [weak,conflict])assert.notEqual(assessRisk([candidate],config,'analysed-replay').primary?.level,'critical');
  assert.equal(assessRisk([],config,'analysed-replay').primary,null);
});

test('synthetic presentation also preserves sample confidence only within its 100 ms cadence',()=>{
  const range={...unknownRange('fixture'),distanceM:12,sigmaM:1};
  const config={speedKph:80,adverse:false};
  for(const ageMs of [0,60,99,105]){
    const synthetic=assessRisk([track({range,ageMs})],config,'synthetic');
    assert.equal(synthetic.primary?.level,'critical');
    assert.equal(synthetic.evidenceMode,'synthetic');
  }
  assert.notEqual(assessRisk([track({range,ageMs:106})],config,'synthetic').primary?.level,'critical');
});
