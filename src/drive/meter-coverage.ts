import type {DriveTrack} from './tracking';
interface Row {id:number;boxVisibleMs:number;metresVisibleMs:number;blackoutMs:number;maxBlackoutMs:number;freshObservations:number;lastCapture:number|null}
export class MeterCoverage {
  private rows=new Map<number,Row>();private previous=new Map<number,boolean>();private at:number|null=null;private omittedRowVisits=0;
  reset(){this.rows.clear();this.omittedRowVisits=0;this.pause();}
  pause(){this.previous.clear();this.at=null;for(const r of this.rows.values())r.blackoutMs=0;}
  private row(id:number){let row=this.rows.get(id);if(!row&&this.rows.size<256){row={id,boxVisibleMs:0,metresVisibleMs:0,blackoutMs:0,maxBlackoutMs:0,freshObservations:0,lastCapture:null};this.rows.set(id,row);}if(!row)this.omittedRowVisits++;return row;}
  presentation(now:number,tracks:readonly DriveTrack[]){
    if(!Number.isFinite(now))return;const dt=this.at===null?0:Math.max(0,now-this.at);
    for(const [id,visible] of this.previous){const r=this.rows.get(id)!;r.boxVisibleMs+=dt;
      if(visible){r.metresVisibleMs+=dt;r.blackoutMs=0;}else{r.blackoutMs+=dt;r.maxBlackoutMs=Math.max(r.maxBlackoutMs,r.blackoutMs);}}
    this.previous.clear();for(const t of tracks){if(this.row(t.id))this.previous.set(t.id,t.range.distanceM!==null);}
    this.at=now;
  }
  measurement(now:number,tracks:readonly DriveTrack[]){for(const t of tracks){const r=this.row(t.id);if(!r||t.range.distanceM===null)continue;const captured=Math.round((now-(t.rangeAgeMs??0))*1000)/1000;if(captured!==r.lastCapture){r.lastCapture=captured;r.freshObservations++;}}}
  report(){return {schema:'drivesense-target-metres-v1',targets:[...this.rows.values()].map(({blackoutMs,lastCapture,...r})=>({...r,boxVisibleCoverage:r.boxVisibleMs>0?r.metresVisibleMs/r.boxVisibleMs:null})),
    eligibleTargetCoverage:null,independentMetricAccuracy:null,targetCapacity:256,omittedRowVisits:this.omittedRowVisits,coverageTruncated:this.omittedRowVisits>0,
    productVerdict:'not-validated',scope:'Current timeline generation only; resets on source/seek/calibration changes. Time while each detected box is visible, not independently labelled road-user eligibility. Runtime/attempt success alone is not ranging acceptance.'};}
}
