import { roadSampleVisible, type RoadSample } from './road-runtime';
import type { RoadLine } from './road-benchmark';

export type LaneState = 'unknown' | 'tracking' | 'left' | 'right';
export const LANE_HUD_POLICY = { probeY:.9, centreX:.5, enter:.22, release:.32, dwellMs:700, minSamples:3, maxGapMs:600 } as const;
export function lanePosition(sample: RoadSample): number | null {
  const { lines, diagnostics } = sample.vector;
  for (const side of ['left','right'] as const) {
    const p=diagnostics.paths[side];
    if (!p?.accepted || ![p.confidence,p.span,p.supportRows,p.rmsPx].every(v=>v!==null&&Number.isFinite(v)) || p.confidence<.45 || p.confidence>1 || p.span<.28 || p.supportRows<10 || p.rmsPx===null || p.rmsPx<0 || p.rmsPx>8) return null;
  }
  function at(line:RoadLine|undefined):number|null {
    if (!line || line.points.length<2 || line.points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.x>1||p.y<0||p.y>1)) return null;
    const points=[...line.points].sort((a,b)=>a.y-b.y);
    for(let i=1;i<points.length;i++) {
      const a=points[i-1],b=points[i];
      if(a.y<=.9&&b.y>=.9&&b.y>a.y) return a.x+(b.x-a.x)*(.9-a.y)/(b.y-a.y);
    }
    return null;
  }
  const leftLines=lines.filter(l=>l.class==='lane-marking'&&l.role==='ego-left');
  const rightLines=lines.filter(l=>l.class==='lane-marking'&&l.role==='ego-right');
  if(leftLines.length!==1||rightLines.length!==1)return null;
  const l=at(leftLines[0]),r=at(rightLines[0]);
  if(l===null||r===null||r-l<.18||r-l>.9||l>=.5||r<=.5)return null;
  return (.5-l)/(r-l);
}

/** Image-space temporal indication, NOT a physical lane-departure estimator. */
export class LaneHud {
  private state:LaneState='unknown';
  private lastTime=-Infinity;
  private generation=-1;
  private candidate:LaneState='unknown';
  private since=0;
  private count=0;
  reset(){this.state='unknown';this.lastTime=-Infinity;this.candidate='unknown';this.count=0;this.generation=-1;}
  observe(sample:RoadSample, nowMs:number, generation:number) {
    if(!roadSampleVisible(sample,nowMs,generation)){this.reset();return;}
    if(this.generation!==generation||sample.timeMs<this.lastTime||sample.timeMs-this.lastTime>LANE_HUD_POLICY.maxGapMs)this.reset();
    if(sample.timeMs===this.lastTime)return;
    this.generation=generation;this.lastTime=sample.timeMs;
    const p=lanePosition(sample);
    if(p===null){this.reset();return;}
    let target:LaneState='tracking';
    if(this.state==='left'&&p<LANE_HUD_POLICY.release)target='left';
    else if(this.state==='right'&&p>1-LANE_HUD_POLICY.release)target='right';
    else if(p<LANE_HUD_POLICY.enter)target='left';
    else if(p>1-LANE_HUD_POLICY.enter)target='right';
    // A static off-centre mounting/crop must not start as a departure alert.
    if(this.state==='unknown'&&target!=='tracking'){this.candidate='unknown';this.count=0;return;}
    // Never switch warning sides without first recovering centered tracking.
    if((this.state==='left'&&target==='right')||(this.state==='right'&&target==='left')){this.reset();return;}
    if(target!==this.candidate){this.candidate=target;this.since=sample.timeMs;this.count=1;}else this.count++;
    if(this.count>=LANE_HUD_POLICY.minSamples&&sample.timeMs-this.since>=LANE_HUD_POLICY.dwellMs)this.state=target;
  }
  view(sample:RoadSample|null,nowMs:number,generation:number):LaneState {
    if(!roadSampleVisible(sample,nowMs,generation)){this.reset();return 'unknown';}
    return this.state;
  }
}
