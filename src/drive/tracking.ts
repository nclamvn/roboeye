import type { DetBox } from '../detection-types';
import { detectionIoU } from '../detection-postprocess';
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

interface Track {id:number;box:DetBox;vx:number;vy:number;at:number;wall:number;hits:number;range:RangeEstimate;filter:RangeFilter;velocity:number|null}
export interface DriveTrack {id:number;box:DetBox;ageMs:number;range:RangeEstimate;closingSpeed:number|null;status:'unknown'|'tracked'|'caution'|'near'}

export class VehicleTracker {
  private tracks:Track[]=[];private nextId=1;private lastTime=-Infinity;
  reset(){this.tracks=[];this.lastTime=-Infinity;}
  observe(boxes:DetBox[],t:number,wall:number,profile:CameraProfile|null,width:number,height:number) {
    if(!Number.isFinite(t+wall)||t<=this.lastTime)return;
    this.lastTime=t;
    this.tracks=this.tracks.filter(a=>t-a.at<=800);
    const candidates=boxes.filter(b=>['car','bus','truck'].includes(b.label)&&b.score>=.15&&b.score<=1&&[b.x0,b.y0,b.x1,b.y1,b.score].every(Number.isFinite)&&b.x0>=0&&b.y0>=0&&b.x1<=1&&b.y1<=1&&b.x1>b.x0&&b.y1>b.y0).slice(0,40);
    const used=new Set<number>(),matched=new Set<number>();
    // ByteTrack-inspired high-then-low association. Low scores never birth a track.
    for(const high of [true,false]) {
      const indexes=this.tracks.map((_,i)=>i).filter(i=>!matched.has(i));
      const detections=candidates.map((_,i)=>i).filter(i=>!used.has(i)&&(candidates[i].score>=.45)===high);
      const costs=indexes.map(i=>detections.map(j=>{
        const track=this.tracks[i],b=candidates[j],a=this.predict(track,t),iou=detectionIoU(a,b);
        const dc=Math.hypot((a.x0+a.x1-b.x0-b.x1)/2,(a.y0+a.y1-b.y0-b.y1)/2);
        if(a.label!==b.label||(iou<.1&&dc>.08))return 1e6;
        return 1-iou+.8*dc;
      }));
      for(const [ii,jj] of assign(costs,.98)) {
        const i=indexes[ii],j=detections[jj],a=this.tracks[i],b=candidates[j],dt=Math.max(16,t-a.at);
        a.vx=.5*a.vx+.5*(b.x0+b.x1-a.box.x0-a.box.x1)/2/dt;
        a.vy=.5*a.vy+.5*(b.y0+b.y1-a.box.y0-a.box.y1)/2/dt;
        a.box={...b};a.at=t;a.wall=wall;a.hits++;this.measure(a,profile,width,height);
        used.add(j);matched.add(i);
      }
    }
    // An unmatched observation invalidates range immediately; prediction is overlay-only.
    this.tracks.forEach((a,i)=>{if(!matched.has(i)){a.range=unknownRange('Mất quan sát xe');a.velocity=null;a.filter.clear();}});
    candidates.forEach((b,j)=>{
      if(used.has(j)||b.score<.45||this.tracks.length>=32)return;
      const a:Track={id:this.nextId++,box:{...b},vx:0,vy:0,at:t,wall,hits:1,range:unknownRange('Track mới'),filter:new RangeFilter(),velocity:null};
      this.measure(a,profile,width,height);this.tracks.push(a);
    });
  }
  private measure(a:Track,p:CameraProfile|null,w:number,h:number) {
    a.range=estimateGroundRange(a.box,p,w,h);a.velocity=null;
    if(a.range.distanceM===null||a.range.sigmaM===null){a.filter.clear();return;}
    const filtered=a.filter.update(a.range.distanceM,a.range.sigmaM,a.at);
    if(!filtered){a.range=unknownRange('Bước nhảy phép đo; chờ đo lại');a.filter.clear();return;}
    a.range={...a.range,distanceM:filtered.z,interval:[Math.max(0,filtered.z-2*a.range.sigmaM),filtered.z+2*a.range.sigmaM]};a.velocity=filtered.velocity;
  }
  private predict(a:Track,t:number):DetBox {
    const dt=Math.max(0,Math.min(180,t-a.at)),dx=Math.max(-.05,Math.min(.05,a.vx*dt)),dy=Math.max(-.05,Math.min(.05,a.vy*dt));
    return {...a.box,x0:a.box.x0+dx,x1:a.box.x1+dx,y0:a.box.y0+dy,y1:a.box.y1+dy};
  }
  snapshot(t:number,wall:number,paused=false):DriveTrack[] {
    return this.tracks.flatMap(a=>{
      const age=Math.max(0,t-a.at,paused?0:wall-a.wall);
      if(age>1000)return [];
      const range=age>400?unknownRange('Dữ liệu cũ'):a.range;
      const d=range.distanceM;
      // Experimental proximity ONLY. No lane, TTC or safe-distance claim.
      const status=d===null?'unknown':d<10?'near':d<20?'caution':'tracked';
      return [{id:a.id,box:this.predict(a,t),ageMs:age,range,closingSpeed:d!==null&&a.velocity!==null?-a.velocity:null,status}];
    });
  }
}
