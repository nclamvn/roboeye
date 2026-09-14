import type {DetBox} from '../detection-types';
import {detectionIoU} from '../detection-postprocess';

export const DRIVE_CANDIDATE_POLICY='vehicle-exclusive-confirmed-v2';
export const VEHICLE_STRONG_SCORE=.65;
export const VEHICLE_IMMEDIATE_SCORE=.85;
export const VEHICLE_WEAK_GRACE_MS=400;
/** Car/bus/truck are competing classes for near-identical rectangles, not three
 * independently present objects. High IoU only: containment can hide a real
 * smaller, partially occluded vehicle behind a larger vehicle.
 */
export function vehicleCandidates(boxes:DetBox[]):DetBox[]{
  const sorted=boxes.filter(b=>['car','bus','truck'].includes(b.label)&&b.score>=.15&&b.score<=1&&
    [b.x0,b.y0,b.x1,b.y1,b.score].every(Number.isFinite)&&b.x0>=0&&b.y0>=0&&b.x1<=1&&b.y1<=1&&b.x1>b.x0&&b.y1>b.y0)
    .sort((a,b)=>b.score-a.score);
  const kept:DetBox[]=[];
  for(const b of sorted){if(!kept.some(a=>detectionIoU(a,b)>=.85))kept.push(b);if(kept.length===40)break;}
  return kept;
}
