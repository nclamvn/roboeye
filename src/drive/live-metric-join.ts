import type {DetBox} from '../detection-types';
import type {LetterboxTransform} from './learned-range';
import type {MetricMap} from './metric-contract';

export const LIVE_METRIC_MAX_AGE_MS=1200;
export const LIVE_BOX_MAX_AGE_MS=2500;

interface Capture {id:number;epoch:number;t:number;wall:number;w:number;h:number;transform:LetterboxTransform}
interface Joined extends Capture {boxes:DetBox[];trackIds:Array<number|null>;map:MetricMap;latencyMs:number}
type Entry=Capture&{detection?:Pick<Joined,'boxes'|'trackIds'>;depth?:Pick<Joined,'map'|'latencyMs'>};

/** One same-capture join, independent of which worker finishes first. No image
 * history, no guessing a vehicle from a newer box, no unbounded result queue. */
export class LiveMetricJoin {
  private entry:Entry|null=null;
  get busy(){return this.entry!==null;}
  begin(capture:Capture):boolean {
    if(this.entry||![capture.id,capture.epoch,capture.t,capture.wall,capture.w,capture.h].every(Number.isFinite)||capture.w<1||capture.h<1)return false;
    this.entry={...capture};return true;
  }
  detection(id:number,boxes:DetBox[],trackIds:Array<number|null>){
    if(this.entry?.id!==id||boxes.length!==trackIds.length)return;
    this.entry.detection={boxes:boxes.map(box=>({...box})),trackIds:[...trackIds]};
  }
  depth(id:number,map:MetricMap,latencyMs:number){
    if(this.entry?.id===id)this.entry.depth={map,latencyMs};
  }
  reset(){this.entry=null;}
  take(now:number,epoch:number,w:number,h:number):{reason:'reset'|'stale';wall:number}|{reason:'ready';value:Joined}|null {
    const entry=this.entry;if(!entry)return null;
    if(entry.epoch!==epoch||entry.w!==w||entry.h!==h){this.reset();return {reason:'reset',wall:entry.wall};}
    if(now<entry.wall||now-entry.wall>LIVE_METRIC_MAX_AGE_MS){this.reset();return {reason:'stale',wall:entry.wall};}
    if(!entry.detection||!entry.depth)return null;
    this.reset();return {reason:'ready',value:{...entry,...entry.detection,...entry.depth}};
  }
}
