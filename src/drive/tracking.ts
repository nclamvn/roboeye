import type { DetBox } from '../detection-types';
import { detectionIoU } from '../detection-postprocess';
import { vehicleCandidates, VEHICLE_STRONG_SCORE, VEHICLE_IMMEDIATE_SCORE, VEHICLE_WEAK_GRACE_MS } from './vehicle-candidates';
import { estimateGroundRange, unknownRange, type CameraProfile, type RangeEstimate } from './geometry';

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
  private x=0;private velocity=0;private a=1;private b=0;private c=100;private at:number|null=null;
  updates=0;
  clear(){this.at=null;this.updates=0;this.velocity=0;this.b=0;this.c=100;}
  update(z:number,sigma:number,t:number):{z:number;velocity:number|null}|null {
    if(![z,sigma,t].every(Number.isFinite)||z<=0||sigma<=0)return null;
    if(this.at===null||t-this.at>800){this.x=z;this.a=sigma*sigma;this.b=0;this.c=100;this.velocity=0;this.at=t;this.updates=1;return {z,velocity:null};}
    const dt=(t-this.at)/1000;if(dt<=0)return null;
    const a=this.a+2*dt*this.b+dt*dt*this.c+16*dt**4/4,b=this.b+dt*this.c+16*dt**3/2,c=this.c+16*dt*dt;
    const predicted=this.x+dt*this.velocity,residual=z-predicted,r=sigma*sigma,s=a+r;
    if(residual*residual>16*s)return null;
    const k0=a/s,k1=b/s;
    this.x=predicted+k0*residual;this.velocity+=k1*residual;
    this.a=(1-k0)**2*a+k0*k0*r;this.b=(1-k0)*(b-k1*a)+k0*k1*r;this.c=c-2*k1*b+k1*k1*(a+r);
    this.at=t;this.updates++;
    return {z:this.x,velocity:this.updates>=5&&this.c<16?this.velocity:null};
  }
}

interface Track {
  id:number;box:DetBox;vx:number;vy:number;at:number;wall:number;hits:number;strongAt:number;strongHits:number;confirmed:boolean;
  range:RangeEstimate;rangeAt:number;filter:RangeFilter;velocity:number|null;
  logScale:number;logScaleRate:number;scaleUpdates:number;
}
export interface DriveTrack {
  id:number;box:DetBox;ageMs:number;range:RangeEstimate;closingSpeed:number|null;
  opticalTtcS:number|null;rangeTtcS:number|null;motionConfidence:number;
  status:'unknown'|'tracked'|'caution'|'near';
}

function boxLogScale(box:DetBox):number {
  return .5*Math.log(Math.max(1e-8,(box.x1-box.x0)*(box.y1-box.y0)));
}

export class VehicleTracker {
  private tracks:Track[]=[];private nextId=1;private lastTime=-Infinity;
  reset(){this.tracks=[];this.lastTime=-Infinity;}
  observe(boxes:DetBox[],t:number,wall:number,profile:CameraProfile|null,width:number,height:number,learned:ReadonlyMap<DetBox,RangeEstimate>|null=null,preserveLearned=false) {
    if(!Number.isFinite(t+wall)||t<=this.lastTime)return;
    this.lastTime=t;
    this.tracks=this.tracks.filter(a=>t-a.at<=800);
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
        const strong=b.score>=VEHICLE_STRONG_SCORE;
        if(t-a.strongAt>VEHICLE_WEAK_GRACE_MS)a.confirmed=false;
        if(strong){a.strongHits=t-a.strongAt<=VEHICLE_WEAK_GRACE_MS?a.strongHits+1:1;a.strongAt=t;}
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
        a.box={...b,label:stableLabel};a.at=t;a.wall=wall;a.hits++;this.measure(a,profile,width,height,learned?.get(b),t,preserveLearned);
        used.add(j);matched.add(i);
      }
    }
    // An unmatched observation invalidates range immediately; prediction is overlay-only.
    this.tracks.forEach((a,i)=>{if(!matched.has(i)){a.strongHits=0;a.range=unknownRange('Mất quan sát xe');a.rangeAt=t;a.velocity=null;a.logScaleRate=0;a.scaleUpdates=0;a.filter.clear();}});
    candidates.forEach((b,j)=>{
      if(used.has(j)||b.score<VEHICLE_STRONG_SCORE||this.tracks.length>=32)return;
      const a:Track={id:this.nextId++,box:{...b},vx:0,vy:0,at:t,wall,hits:1,strongAt:t,strongHits:1,confirmed:b.score>=VEHICLE_IMMEDIATE_SCORE,range:unknownRange('Track mới'),rangeAt:t,filter:new RangeFilter(),velocity:null,logScale:boxLogScale(b),logScaleRate:0,scaleUpdates:0};
      this.measure(a,profile,width,height,learned?.get(b),t,preserveLearned);this.tracks.push(a);
    });
  }
  /** Attach a same-frame learned range after the detector result was already
   * rendered. This keeps boxes responsive while the slower depth worker runs.
   * It never advances track time or applies a range to a newer observation. */
  enrichLearnedRanges(boxes:DetBox[],ranges:ReadonlyArray<RangeEstimate|null>,t:number,width:number,height:number):number {
    if(t>this.lastTime||this.lastTime-t>600||boxes.length!==ranges.length||![t,width,height].every(Number.isFinite)||width<1||height<1)return 0;
    const measured=vehicleCandidates(boxes).flatMap(box=>{
      const range=ranges[boxes.indexOf(box)];
      return range?.kind==='learned_optical_axis_z_m'&&range.provenance==='learned-unverified'&&range.distanceM!==null?[{box,range}]:[];
    });
    const indexes=this.tracks.map((_,i)=>i).filter(i=>this.tracks[i].at>=t&&this.tracks[i].at-t<=600);
    const costs=indexes.map(i=>measured.map(({box})=>{
      const overlap=detectionIoU(this.tracks[i].box,box);return overlap>=.5?1-overlap:1e6;
    }));
    let applied=0;
    for(const [ii,jj] of assign(costs,.5000001)){
      const track=this.tracks[indexes[ii]];if(t<track.rangeAt)continue;
      this.measure(track,null,width,height,measured[jj].range,t);applied++;
    }
    return applied;
  }
  private measure(a:Track,p:CameraProfile|null,w:number,h:number,learned?:RangeEstimate,measurementAt=a.at,preserveLearned=false) {
    if(!a.confirmed||a.box.score<VEHICLE_STRONG_SCORE){a.range=unknownRange('Bằng chứng xe yếu; chưa đo');a.rangeAt=measurementAt;a.velocity=null;a.filter.clear();return;}
    if(preserveLearned&&!p&&!learned&&a.range.provenance==='learned-unverified'&&measurementAt-a.rangeAt<=600)return;
    const geometric=estimateGroundRange(a.box,p,w,h);
    const previousKind=a.range.kind,previousSource=a.range.provenance;
    // A supplied camera profile is authoritative, including its abstentions.
    // Falling back to an uncalibrated neural value hides bad crop/occlusion and
    // mixing ground-forward Z with optical-camera Z poisons the temporal filter.
    a.range=p?geometric:learned?structuredClone(learned):geometric;a.velocity=null;
    if(previousKind!==a.range.kind||previousSource!==a.range.provenance)a.filter.clear();
    if(a.range.distanceM===null||a.range.sigmaM===null){a.rangeAt=measurementAt;a.filter.clear();return;}
    const filtered=a.filter.update(a.range.distanceM,a.range.sigmaM,measurementAt);
    if(!filtered){a.range=unknownRange('Bước nhảy phép đo; chờ đo lại');a.rangeAt=measurementAt;a.filter.clear();return;}
    a.range={...a.range,distanceM:filtered.z,interval:[Math.max(0,filtered.z-2*a.range.sigmaM),filtered.z+2*a.range.sigmaM]};a.rangeAt=measurementAt;a.velocity=filtered.velocity;
  }
  private predict(a:Track,t:number):DetBox {
    const dt=Math.max(0,Math.min(180,t-a.at)),dx=Math.max(-.05,Math.min(.05,a.vx*dt)),dy=Math.max(-.05,Math.min(.05,a.vy*dt));
    return {...a.box,x0:a.box.x0+dx,x1:a.box.x1+dx,y0:a.box.y0+dy,y1:a.box.y1+dy};
  }
  snapshot(t:number,wall:number,paused=false):DriveTrack[] {
    return this.tracks.flatMap(a=>{
      const age=Math.max(0,t-a.at,paused?0:wall-a.wall);
      // Association can preserve identity through occlusion, not a positive label
      // indefinitely. Old strong evidence cannot be refreshed by weak detections.
      if(age>1000||!a.confirmed||t-a.strongAt>VEHICLE_WEAK_GRACE_MS)return [];
      const rangeAge=Math.max(age,t-a.rangeAt),range=rangeAge>400?unknownRange('Dữ liệu khoảng cách cũ',a.range.kind):a.range;
      const d=range.distanceM;
      // Experimental proximity ONLY. No lane, TTC or safe-distance claim.
      const status=d===null?'unknown':d<10?'near':d<20?'caution':'tracked';
      const closingSpeed=d!==null&&a.velocity!==null?-a.velocity:null;
      const opticalTtcS=a.scaleUpdates>=3&&a.logScaleRate>.025?Math.max(.25,Math.min(30,1/a.logScaleRate)):null;
      const rangeTtcS=d!==null&&closingSpeed!==null&&closingSpeed>.25?Math.max(.25,Math.min(30,d/closingSpeed)):null;
      const motionConfidence=Math.min(1,a.scaleUpdates/8)*(1-Math.min(1,age/500))*Math.max(0,Math.min(1,a.box.score));
      return [{id:a.id,box:this.predict(a,t),ageMs:age,range,closingSpeed,opticalTtcS,rangeTtcS,motionConfidence,status}];
    });
  }
}
