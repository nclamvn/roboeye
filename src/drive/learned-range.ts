import type {DetBox} from '../detection-types';
import {assertMetricMap,type MetricMap} from './metric-contract';
import {unknownRange,type RangeEstimate} from './geometry';
import type {DriveTrack} from './tracking';

export interface LetterboxTransform {
  sourceWidth:number;sourceHeight:number;targetWidth:number;targetHeight:number;
  scale:number;offsetX:number;offsetY:number;contentWidth:number;contentHeight:number;
}

export function letterboxTransform(sourceWidth:number,sourceHeight:number,targetWidth:number,targetHeight:number):LetterboxTransform {
  if(![sourceWidth,sourceHeight,targetWidth,targetHeight].every(Number.isFinite)||
    ![sourceWidth,sourceHeight,targetWidth,targetHeight].every(v=>Number.isInteger(v)&&v>0))throw Error('Kích thước letterbox không hợp lệ.');
  const scale=Math.min(targetWidth/sourceWidth,targetHeight/sourceHeight);
  const contentWidth=sourceWidth*scale,contentHeight=sourceHeight*scale;
  return {sourceWidth,sourceHeight,targetWidth,targetHeight,scale,
    offsetX:(targetWidth-contentWidth)/2,offsetY:(targetHeight-contentHeight)/2,contentWidth,contentHeight};
}

export function mapBoxToMetric(box:DetBox,t:LetterboxTransform):DetBox {
  const x=(u:number)=>(t.offsetX+u*t.sourceWidth*t.scale)/t.targetWidth;
  const y=(v:number)=>(t.offsetY+v*t.sourceHeight*t.scale)/t.targetHeight;
  return {...box,x0:x(box.x0),x1:x(box.x1),y0:y(box.y0),y1:y(box.y1)};
}

const percentile=(sorted:number[],q:number)=>sorted[Math.min(sorted.length-1,Math.max(0,Math.floor(q*(sorted.length-1))))];

/** Robust interior-vehicle probe. It intentionally excludes the box bottom where
 * road pixels and shadows dominate. Its interval is a sensitivity band, not a
 * statistically calibrated confidence interval.
 */
export function estimateLearnedVehicleRange(map:MetricMap,box:DetBox,transform:LetterboxTransform):RangeEstimate {
  const kind='learned_optical_axis_z_m' as const,fail=(reason:string)=>unknownRange(reason,kind);
  assertMetricMap(map);
  if(map.width!==transform.targetWidth||map.height!==transform.targetHeight)return fail('Depth và letterbox lệch shape');
  if(![box.x0,box.y0,box.x1,box.y1,box.score].every(Number.isFinite)||box.x0<0||box.y0<0||box.x1>1||box.y1>1||box.x1<=box.x0||box.y1<=box.y0)return fail('Box không hợp lệ');
  // An overtaking vehicle frequently enters as a truncated side panel. An
  // interior-depth median there is neither its rear surface nor bumper clearance.
  if(box.x0<=.01||box.x1>=.99||box.y0<=.01||box.y1>=.99)return fail('Xe bị cắt ở biên; không suy ra khoảng hở xe bên cạnh');
  const b=mapBoxToMetric(box,transform),bw=(b.x1-b.x0)*map.width,bh=(b.y1-b.y0)*map.height;
  if(bw<10||bh<10)return fail('Xe quá nhỏ cho depth ROI; depth thấp phân giải dễ lẫn nền');
  const x0=Math.max(0,Math.ceil((b.x0+.22*(b.x1-b.x0))*map.width));
  const x1=Math.min(map.width-1,Math.floor((b.x1-.22*(b.x1-b.x0))*map.width));
  const y0=Math.max(0,Math.ceil((b.y0+.42*(b.y1-b.y0))*map.height));
  const y1=Math.min(map.height-1,Math.floor((b.y0+.82*(b.y1-b.y0))*map.height));
  if(x1<x0||y1<y0)return fail('ROI xe không đủ pixel');
  const values:number[]=[];let total=0;
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){total++;const z=map.depth[y*map.width+x];if(Number.isFinite(z)&&z>=.5&&z<=80)values.push(z);}
  if(values.length<12||values.length/Math.max(1,total)<.7)return fail('Depth ROI thưa hoặc ngoài miền');
  values.sort((a,b)=>a-b);
  const q20=percentile(values,.2),median=percentile(values,.5),q80=percentile(values,.8),spread=(q80-q20)/median;
  if(!Number.isFinite(median)||median<.7||median>75)return fail('Depth ngoài phạm vi PoC');
  if(spread>.55)return fail('Depth ROI không đồng nhất');
  const sigma=Math.max(.75,.1*median,.65*(q80-q20));
  return {kind,provenance:'learned-unverified',distanceM:median,lateralM:null,sigmaM:sigma,
    interval:[Math.max(.5,median-2*sigma),Math.min(80,median+2*sigma)],intervalCalibrated:false,
    reason:`AI metric chưa hiệu chuẩn thực địa · ROI ${values.length} px · độ phân tán ${Math.round(100*spread)}%`};
}

export const LEARNED_RANGE_POLICY='ground-contact-publication-invariant-v7';
const invalidLearned=(reason:string)=>unknownRange(reason,'learned_optical_axis_z_m');
const ORDINAL_VEHICLE_LABELS=new Set(['car','bus','truck']);
// The detector edge itself is not sub-pixel ground truth. Two source pixels is
// the explicit resolution floor; it is intentionally expressed in source
// pixels instead of a screenshot-tuned normalized percentage.
export const GROUND_CONTACT_RESOLUTION_PX=2;

function visuallyNearer(a:DetBox,b:DetBox,sourceHeight:number):boolean {
  // For vehicles resting on the same locally planar road, the lower tyre/road
  // contact row is nearer. Apparent box height must not veto this invariant:
  // cars, buses, trucks and partial occlusion have different physical heights.
  return (a.y1-b.y1)*sourceHeight>=GROUND_CONTACT_RESOLUTION_PX;
}

function usableOrdinalBox(box:DetBox):boolean {
  return [box.x0,box.y0,box.x1,box.y1].every(Number.isFinite)&&
    box.x0>.01&&box.y0>.01&&box.x1<.99&&box.y1<.99&&box.x1>box.x0&&box.y1>box.y0;
}

/** These are abstention heuristics, NOT a metric correction or lane detector.
 * Never manufacture A-C metres by adding an apparent B-C gap. Known zoom does
 * not license dividing an unconditioned neural depth output by that zoom.
 */
export function validateLearnedRanges(boxes:readonly DetBox[],ranges:readonly (RangeEstimate|null)[],zoom=1,sourceHeight=720):Array<RangeEstimate|null> {
  if(!Number.isFinite(zoom)||zoom<1||zoom>4)throw Error('Zoom video cần nằm trong 1–4×.');
  if(!Number.isInteger(sourceHeight)||sourceHeight<1)throw Error('Chiều cao nguồn cần là số nguyên dương.');
  const out=boxes.map((_,i)=>ranges[i]?structuredClone(ranges[i]!):null);
  if(zoom!==1)return out.map(range=>range?.kind==='learned_optical_axis_z_m'?invalidLearned('Video có zoom/crop; cần profile đúng tiêu cự hiệu dụng, không tự sửa scale AI'):range);
  for(let i=0;i<boxes.length;i++){
    const far=boxes[i],range=out[i];if(range?.kind!=='learned_optical_axis_z_m'||range.distanceM==null)continue;
    const fh=far.y1-far.y0,fw=far.x1-far.x0;
    for(let j=0;j<boxes.length;j++){
      const near=boxes[j],nr=out[j];if(i===j||nr?.kind!=='learned_optical_axis_z_m'||nr.distanceM==null||near.label!==far.label||near.score<.65||far.score<.65)continue;
      const nh=near.y1-near.y0;
      const overlap=Math.max(0,Math.min(near.x1,far.x1)-Math.max(near.x0,far.x0))/Math.max(1e-6,Math.min(fw,near.x1-near.x0));
      // Same-class aligned vehicles with a pronounced perspective size change.
      // Vehicle dimensions are unknown, hence only reject severe disagreement.
      if(nh/fh>=1.8&&overlap>=.5&&near.y1-far.y1>=.015&&
        range.distanceM/nr.distanceM<.95*Math.sqrt(nh/fh)){
        out[i]=invalidLearned('Depth xa–gần bị nén hoặc sai thứ tự so với phối cảnh; cần hình học/đối chứng');break;
      }
    }
  }
  // Cross-lane vehicles do not overlap horizontally, so the aligned-box gate
  // above cannot see an inverted near/far order. Once the ground-contact rows
  // differ by more than detector resolution, a reversed learned order is
  // internally inconsistent and unsafe to publish. Invalidate both:
  // the image can identify the contradiction but cannot prove which metre value
  // is correct. Never swap or synthesize distances.
  const conflicts=new Set<number>();
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
    const a=boxes[i],b=boxes[j],ar=out[i],br=out[j];
    // Raw RT-DETR vehicle subclasses may flicker (car/truck/bus) even though
    // candidate suppression and tracking already treat them as competing labels.
    // Ground-contact ordering is independent of vehicle subclass, so apply it
    // consistently to the entire reviewed vehicle family.
    if(!usableOrdinalBox(a)||!usableOrdinalBox(b)||!ORDINAL_VEHICLE_LABELS.has(a.label)||!ORDINAL_VEHICLE_LABELS.has(b.label)||a.score<.65||b.score<.65||ar?.kind!=='learned_optical_axis_z_m'||br?.kind!=='learned_optical_axis_z_m'||ar.distanceM==null||br.distanceM==null)continue;
    const near=visuallyNearer(a,b,sourceHeight)?i:visuallyNearer(b,a,sourceHeight)?j:-1;if(near<0)continue;
    const far=near===i?j:i,nearDistance=out[near]!.distanceM!,farDistance=out[far]!.distanceM!;
    // This is a publication invariant, not a tolerance-based model score. Once
    // the contact rows are resolved, *any* reversed metric order is internally
    // inconsistent. Abstain rather than allowing a smaller wrong order onto the
    // HUD, swapping values, or inventing an isotonic metre correction.
    if(nearDistance>farDistance){conflicts.add(near);conflicts.add(far);}
  }
  for(const index of conflicts)out[index]=invalidLearned('Depth đảo thứ tự gần–xa so với điểm chạm mặt đường; kích thước ảnh không phủ quyết; cần hình học hoặc model đối chứng');
  return out;
}

/** Final publication guard. Tracking/Kalman may legitimately smooth each range,
 * but independently filtered tracks can recreate an ordinal contradiction that
 * was absent in the raw frame. Revalidate the exact boxes and ranges sent to the
 * HUD/risk layer, then clear every range-derived signal when the metre is unsafe.
 */
export function validatePublishedLearnedTracks(tracks:readonly DriveTrack[],zoom=1,sourceHeight=720):DriveTrack[] {
  const ranges=validateLearnedRanges(tracks.map(track=>track.box),tracks.map(track=>track.range),zoom,sourceHeight);
  return tracks.map((track,index)=>{
    const out=structuredClone(track),range=ranges[index];
    if(range)out.range=range;
    if(out.range.kind==='learned_optical_axis_z_m'&&out.range.distanceM===null){
      out.status='unknown';out.closingSpeed=null;out.rangeTtcS=null;
    }
    return out;
  });
}
