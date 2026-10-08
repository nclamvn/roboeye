import type { DetBox } from '../detection-types';
import { detectionIoU } from '../detection-postprocess';
import { vehicleCandidates, VEHICLE_STRONG_SCORE, VEHICLE_IMMEDIATE_SCORE, VEHICLE_WEAK_GRACE_MS } from './vehicle-candidates';
import { estimateGroundRange, unknownRange, type CameraProfile, type RangeEstimate } from './geometry';
import {LIVE_METRIC_MAX_AGE_MS} from './live-metric-join';
import type {MetricReasonCode} from './metric-diagnostics';

/** Rectangular minimum-cost assignment. Each row gets a private-cost dummy column. */
export function assign(cost:number[][],unmatched=1): Array<[number,number]> {
  const n=cost.length,m=cost[0]?.length??0;if(!n||!m)return [];
  const cols=m+n,u=new Array(n+1).fill(0),v=new Array(cols+1).fill(0),p=new Array(cols+1).fill(0),way=new Array(cols+1).fill(0);
  for(let i=1;i<=n;i++) {
    p[0]=i;let j0=0;
    const min=new Array(cols+1).fill(Infinity),used=new Array(cols+1).fill(false);
    do {
      used[j0]=true;const i0=p[j0];let delta=Infinity,j1=0;
      for(let j=1;j<=cols;j++) if(!used[j]) {
        const c=j<=m?cost[i0-1][j-1]:unmatched;
        const cur=(Number.isFinite(c)?c:1e6)-u[i0]-v[j];
        if(cur<min[j]){min[j]=cur;way[j]=j0;}
        if(min[j]<delta){delta=min[j];j1=j;}
      }
      for(let j=0;j<=cols;j++) if(used[j]){u[p[j]]+=delta;v[j]-=delta;}else min[j]-=delta;
      j0=j1;
    }while(p[j0]!==0);
    do {const j1=way[j0];p[j0]=p[j1];j0=j1;}while(j0);
  }
  const out:Array<[number,number]>=[];
  for(let j=1;j<=m;j++) if(p[j]&&cost[p[j]-1][j-1]<unmatched)out.push([p[j]-1,j-1]);
  return out;
}

/** Constant-velocity Kalman, variable dt, innovation gate and Joseph covariance. */
export class RangeFilter {
  private x=0;private velocity=0;private a=1;private b=0;private c=16;private at:number|null=null;
  private reacquire:{z:number;sigma:number;t:number}|null=null;
  lastReason:MetricReasonCode='accepted';
  updates=0;
  clear(){this.at=null;this.updates=0;this.velocity=0;this.b=0;this.c=16;this.reacquire=null;this.lastReason='accepted';}
  update(z:number,sigma:number,t:number):{z:number;velocity:number|null}|null {
    this.lastReason='accepted';
    if(![z,sigma,t].every(Number.isFinite)||z<=0||sigma<=0){this.lastReason='out-of-domain';return null;}
    if(this.at===null){this.x=z;this.a=sigma*sigma;this.b=0;this.c=16;this.velocity=0;this.at=t;this.updates=1;return {z,velocity:null};}
    const dt=(t-this.at)/1000;if(dt<=0){this.lastReason='out-of-order';return null;}
    // A long gap requires two consistent NEW observations. The first stays
    // unknown and never refreshes the expired old HUD measurement.
    if(dt>2.5){
      const candidate=this.reacquire;
      if(candidate&&t>candidate.t&&t-candidate.t<=2500&&Math.abs(z-candidate.z)<=3*Math.hypot(sigma,candidate.sigma)){
        this.clear();return this.update(z,sigma,t);
      }
      this.reacquire={z,sigma,t};this.lastReason='temporal-reacquiring';return null;
    }
    const a=this.a+2*dt*this.b+dt*dt*this.c+16*dt**4/4,b=this.b+dt*this.c+16*dt**3/2,c=this.c+16*dt*dt;
    const predicted=this.x+dt*this.velocity,residual=z-predicted,r=sigma*sigma,s=a+r;
    if(residual*residual>9*s){this.lastReason='temporal-outlier';return null;}
    const k0=a/s,k1=b/s;
    this.x=predicted+k0*residual;this.velocity+=k1*residual;
    this.a=(1-k0)**2*a+k0*k0*r;this.b=(1-k0)*(b-k1*a)+k0*k1*r;this.c=c-2*k1*b+k1*k1*(a+r);
    this.at=t;this.updates++;
    return {z:this.x,velocity:this.updates>=5&&this.c<16?this.velocity:null};
  }
}

interface Track {
  id:number;box:DetBox;vx:number;vy:number;at:number;wall:number;hits:number;misses:number;
  strongAt:number;strongWall:number;strongHits:number;confirmed:boolean;
  range:RangeEstimate;rangeAt:number;rangeWall:number;lastLearnedAt:number;invalidatedAt:number;evidenceWall:number;filter:RangeFilter;velocity:number|null;
  filterIdentity?:string;
  logScale:number;logScaleRate:number;scaleUpdates:number;
}
export interface DriveTrack {
  id:number;box:DetBox;ageMs:number;range:RangeEstimate;closingSpeed:number|null;
  opticalTtcS:number|null;rangeTtcS:number|null;motionConfidence:number;
  status:'unknown'|'tracked'|'caution'|'near';
  evidenceAgeMs?:number;rangeAgeMs?:number;
}

function boxLogScale(box:DetBox):number {
  return .5*Math.log(Math.max(1e-8,(box.x1-box.x0)*(box.y1-box.y0)));
}

export class VehicleTracker {
  private tracks:Track[]=[];private nextId=1;private lastTime=-Infinity;private lastWall=-Infinity;private cadenceMs=250;
  reset(){this.tracks=[];this.lastTime=-Infinity;this.lastWall=-Infinity;this.cadenceMs=250;}
  private noteTiming(wall:number,latencyMs:number) {
    const interval=wall-this.lastWall;
    if(Number.isFinite(interval)&&interval>=16&&interval<=3000)this.cadenceMs=.7*this.cadenceMs+.3*interval;
    if(Number.isFinite(latencyMs)&&latencyMs>=16&&latencyMs<=3000)this.cadenceMs=Math.max(this.cadenceMs,.85*latencyMs);
    this.lastWall=wall;
  }
  /** The overlay must bridge the next expected detector result, not expire on
   * a desktop-only fixed frame interval. It remains bounded so a stopped
   * worker or vanished vehicle cannot leave an indefinite ghost. */
  private visualHoldMs(){return Math.max(550,Math.min(1800,2.2*this.cadenceMs));}
  private associationHoldMs(){return Math.max(900,Math.min(2600,3.1*this.cadenceMs));}
  private rangeHoldMs(){return Math.max(900,Math.min(1600,1.65*this.cadenceMs+500));}
  observe(boxes:DetBox[],t:number,wall:number,profile:CameraProfile|null,width:number,height:number,learned:ReadonlyMap<DetBox,RangeEstimate>|null=null,preserveLearned=false,latencyMs=0) {
    if(!Number.isFinite(t+wall)||t<=this.lastTime)return;
    this.lastTime=t;this.noteTiming(wall,latencyMs);
    const associationHold=this.associationHoldMs();
    this.tracks=this.tracks.filter(a=>t-a.at<=associationHold&&wall-a.wall<=associationHold);
    const candidates=vehicleCandidates(boxes);
    const used=new Set<number>(),matched=new Set<number>();
    // ByteTrack-inspired high-then-low association. Low scores never birth a track.
    for(const high of [true,false]) {
      const indexes=this.tracks.map((_,i)=>i).filter(i=>!matched.has(i));
      const detections=candidates.map((_,i)=>i).filter(i=>!used.has(i)&&(candidates[i].score>=.45)===high);
      const costs=indexes.map(i=>detections.map(j=>{
        const track=this.tracks[i],b=candidates[j],a=this.predict(track,t),iou=detectionIoU(a,b);
        const dc=Math.hypot((a.x0+a.x1-b.x0-b.x1)/2,(a.y0+a.y1-b.y0-b.y1)/2);
        const areaA=(a.x1-a.x0)*(a.y1-a.y0),areaB=(b.x1-b.x0)*(b.y1-b.y0),sizeCost=Math.abs(Math.log(areaB/areaA));
        // At a 200 ms offline sampling interval, a close vehicle may move more
        // than one box width. Keep a strict centre/scale gate, then score motion
        // continuously; vehicle subclass flicker is a penalty, not a new ID.
        if((iou<.02&&dc>.22)||sizeCost>1.25)return 1e6;
        return .55*(1-iou)+1.6*dc+.12*sizeCost+(a.label===b.label?0:.08);
      }));
      for(const [ii,jj] of assign(costs,.98)) {
        const i=indexes[ii],j=detections[jj],a=this.tracks[i],b=candidates[j],dt=Math.max(16,t-a.at);
        a.vx=.5*a.vx+.5*(b.x0+b.x1-a.box.x0-a.box.x1)/2/dt;
        a.vy=.5*a.vy+.5*(b.y0+b.y1-a.box.y0-a.box.y1)/2/dt;
        const confirmationGap=latencyMs>0?Math.max(VEHICLE_WEAK_GRACE_MS,this.associationHoldMs()):VEHICLE_WEAK_GRACE_MS;
        const strong=b.score>=VEHICLE_STRONG_SCORE,consecutive=a.misses===0&&t-a.strongAt<=confirmationGap;
        if(strong){a.strongHits=consecutive?a.strongHits+1:1;a.strongAt=t;a.strongWall=wall;}
        else a.strongHits=0;
        a.confirmed=a.confirmed||b.score>=VEHICLE_IMMEDIATE_SCORE||a.strongHits>=2;
        if(strong){
          const nextScale=boxLogScale(b),seconds=dt/1000,raw=(nextScale-a.logScale)/seconds;
          if(Number.isFinite(raw)&&Math.abs(raw)<=2){
            const alpha=Math.max(.2,Math.min(.55,seconds/(.35+seconds)));
            a.logScaleRate=a.scaleUpdates?alpha*raw+(1-alpha)*a.logScaleRate:raw;
            a.scaleUpdates=Math.min(20,a.scaleUpdates+1);
          }else{a.logScaleRate=0;a.scaleUpdates=0;}
          a.logScale=nextScale;
        }else{a.logScale=boxLogScale(b);a.logScaleRate=0;a.scaleUpdates=0;}
        const stableLabel=a.box.label===b.label||b.score>a.box.score+.15?b.label:a.box.label;
        a.box={...b,label:stableLabel};a.at=t;a.wall=wall;a.evidenceWall=wall-Math.max(0,latencyMs);a.hits++;a.misses=0;this.measure(a,profile,width,height,learned?.get(b),t,preserveLearned,a.evidenceWall);
        used.add(j);matched.add(i);
      }
    }
    // An unmatched observation invalidates range immediately; prediction is overlay-only.
    this.tracks.forEach((a,i)=>{if(!matched.has(i)){a.misses++;a.strongHits=0;a.invalidatedAt=t;a.range=unknownRange('Mất quan sát xe');a.rangeAt=t;a.rangeWall=wall;a.velocity=null;a.logScaleRate=0;a.scaleUpdates=0;a.filter.clear();a.filterIdentity=undefined;}});
    candidates.forEach((b,j)=>{
      if(used.has(j)||b.score<VEHICLE_STRONG_SCORE||this.tracks.length>=32)return;
      const a:Track={id:this.nextId++,box:{...b},vx:0,vy:0,at:t,wall,hits:1,misses:0,strongAt:t,strongWall:wall,strongHits:1,confirmed:b.score>=VEHICLE_IMMEDIATE_SCORE,range:unknownRange('Track mới'),rangeAt:t,rangeWall:wall,lastLearnedAt:-Infinity,invalidatedAt:-Infinity,evidenceWall:wall-Math.max(0,latencyMs),filter:new RangeFilter(),velocity:null,logScale:boxLogScale(b),logScaleRate:0,scaleUpdates:0};
      this.measure(a,profile,width,height,learned?.get(b),t,preserveLearned,a.evidenceWall);this.tracks.push(a);
    });
  }
  /** Capture identity immediately after observe, before another detector frame
   * can replace a box. A later range must keep this binding. */
  bindLearnedFrame(boxes:DetBox[],t:number):Array<number|null> {
    return boxes.map(box=>this.tracks.find(track=>track.at===t&&track.confirmed&&track.misses===0&&detectionIoU(track.box,box)>.95)?.id??null);
  }
  enrichLearnedRanges(boxes:DetBox[],ranges:ReadonlyArray<RangeEstimate|null>,t:number,width:number,height:number,wall=t,binding?:{trackIds:ReadonlyArray<number|null>;capturedWall:number},diagnose?:(index:number,code:MetricReasonCode,filteredM:number|null)=>void):number {
    const maxGap=binding?LIVE_METRIC_MAX_AGE_MS:0;
    if(t>this.lastTime||this.lastTime-t>maxGap||boxes.length!==ranges.length||![t,width,height,wall].every(Number.isFinite)||width<1||height<1)return 0;
    if(binding&&(binding.trackIds.length!==boxes.length||!Number.isFinite(binding.capturedWall)||wall<binding.capturedWall||wall-binding.capturedWall>LIVE_METRIC_MAX_AGE_MS))return 0;
    const measured=vehicleCandidates(boxes).flatMap(box=>{
      const range=ranges[boxes.indexOf(box)];
      return range?.kind==='learned_optical_axis_z_m'&&range.provenance==='learned-unverified'&&range.distanceM!==null?[{box,range,index:boxes.indexOf(box)}]:[];
    });
    const terminal=new Set<number>();
    const indexes=this.tracks.map((_,i)=>i).filter(i=>this.tracks[i].at>=t&&this.tracks[i].at-t<=maxGap&&this.tracks[i].misses===0&&this.tracks[i].invalidatedAt<=t);
    const costs=indexes.map(i=>measured.map(({box,index})=>{
      const track=this.tracks[i];if(binding&&track.id!==binding.trackIds[index])return 1e6;
      const overlap=detectionIoU(track.box,box);return overlap>=(binding ? .7 : .5)?1-overlap:1e6;
    }));
    let applied=0;
    for(const [ii,jj] of assign(costs,.5000001)){
      const track=this.tracks[indexes[ii]],index=measured[jj].index;terminal.add(index);
      if(t<=track.lastLearnedAt){diagnose?.(index,'out-of-order',null);continue;}
      this.measure(track,null,width,height,measured[jj].range,t,false,binding?.capturedWall??wall);
      diagnose?.(index,track.range.distanceM===null?track.range.reasonCode??'binding-mismatch':'accepted',track.range.distanceM);
      if(track.range.distanceM!==null){track.lastLearnedAt=t;applied++;}
    }
    for(const {index} of measured)if(!terminal.has(index)){
      const id=binding?.trackIds[index],track=this.tracks.find(item=>item.id===id);
      diagnose?.(index,id===null?'unconfirmed-track':track?.misses||!track?'track-lost':'binding-mismatch',null);
    }
    return applied;
  }
  private measure(a:Track,p:CameraProfile|null,w:number,h:number,learned?:RangeEstimate,measurementAt=a.at,preserveLearned=false,measurementWall=a.wall) {
    if(!a.confirmed||a.box.score<VEHICLE_STRONG_SCORE){a.invalidatedAt=a.at;a.range={...unknownRange('Bằng chứng xe yếu; chưa đo'),reasonCode:'unconfirmed-track'};a.rangeAt=measurementAt;a.rangeWall=measurementWall;a.velocity=null;a.filter.clear();a.filterIdentity=undefined;return;}
    if(preserveLearned&&!p&&!learned&&a.range.provenance==='learned-unverified'&&measurementAt-a.rangeAt<=LIVE_METRIC_MAX_AGE_MS)return;
    const geometric=estimateGroundRange(a.box,p,w,h);
    // A supplied camera profile is authoritative, including its abstentions.
    // Falling back to an uncalibrated neural value hides bad crop/occlusion and
    // mixing ground-forward Z with optical-camera Z poisons the temporal filter.
    a.range=p?geometric:learned?structuredClone(learned):geometric;a.velocity=null;
    if(a.range.distanceM===null||a.range.sigmaM===null){a.rangeAt=measurementAt;a.rangeWall=measurementWall;return;}
    const identity=`${a.range.kind}:${a.range.provenance}`;
    if(a.filterIdentity!==identity){a.filter.clear();a.filterIdentity=identity;}
    const filtered=a.filter.update(a.range.distanceM,a.range.sigmaM,measurementAt);
    if(!filtered){a.range={...unknownRange('Bước nhảy phép đo hoặc cần tái xác nhận; chờ đo lại',a.range.kind),reasonCode:a.filter.lastReason};a.rangeAt=measurementAt;a.rangeWall=measurementWall;return;}
    a.range={...a.range,distanceM:filtered.z,interval:[Math.max(0,filtered.z-2*a.range.sigmaM),filtered.z+2*a.range.sigmaM]};a.rangeAt=measurementAt;a.rangeWall=measurementWall;a.velocity=filtered.velocity;
  }
  private predict(a:Track,t:number):DetBox {
    const dt=Math.max(0,Math.min(180,t-a.at)),dx=Math.max(-.05,Math.min(.05,a.vx*dt)),dy=Math.max(-.05,Math.min(.05,a.vy*dt));
    return {...a.box,x0:a.box.x0+dx,x1:a.box.x1+dx,y0:a.box.y0+dy,y1:a.box.y1+dy};
  }
  snapshot(t:number,wall:number,paused=false):DriveTrack[] {
    return this.tracks.flatMap(a=>{
      const age=paused?Math.max(0,t-a.at):Math.max(0,wall-a.wall),visualHold=this.visualHoldMs();
      // Association can preserve identity through occlusion, not a positive label
      // indefinitely. Old strong evidence cannot be refreshed by weak detections.
      if(age>visualHold||!a.confirmed||a.misses>2||(!paused&&wall-a.strongWall>visualHold))return [];
      const rangeAge=paused?Math.max(0,t-a.rangeAt):Math.max(age,wall-a.rangeWall),rangeHold=paused?400:a.range.provenance==='learned-unverified'?LIVE_METRIC_MAX_AGE_MS:this.rangeHoldMs();
      const range=rangeAge>rangeHold?unknownRange('Dữ liệu khoảng cách cũ',a.range.kind):a.range;
      const d=range.distanceM;
      // Experimental proximity ONLY. No lane, TTC or safe-distance claim.
      const status=d===null?'unknown':d<10?'near':d<20?'caution':'tracked';
      const closingSpeed=d!==null&&a.velocity!==null?-a.velocity:null;
      const opticalTtcS=a.scaleUpdates>=3&&a.logScaleRate>.025?Math.max(.25,Math.min(30,1/a.logScaleRate)):null;
      const rangeTtcS=d!==null&&closingSpeed!==null&&closingSpeed>.25?Math.max(.25,Math.min(30,d/closingSpeed)):null;
      const motionConfidence=Math.min(1,a.scaleUpdates/8)*(1-Math.min(1,age/visualHold))*Math.max(0,Math.min(1,a.box.score));
      return [{id:a.id,box:this.predict(a,t),ageMs:age,evidenceAgeMs:paused?age:Math.max(0,wall-a.evidenceWall),rangeAgeMs:rangeAge,range,closingSpeed,opticalTtcS,rangeTtcS,motionConfidence,status}];
    });
  }
}
