import type {DetBox} from '../detection-types';
import {assertMetricMap,type MetricMap} from './metric-contract';
import {unknownRange,type RangeEstimate} from './geometry';

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

export const LEARNED_RANGE_POLICY='visible-roi-zoom-perspective-gates-v2';
const invalidLearned=(reason:string)=>unknownRange(reason,'learned_optical_axis_z_m');

/** These are abstention heuristics, NOT a metric correction or lane detector.
 * Never manufacture A-C metres by adding an apparent B-C gap. Known zoom does
 * not license dividing an unconditioned neural depth output by that zoom.
 */
export function validateLearnedRanges(boxes:readonly DetBox[],ranges:readonly (RangeEstimate|null)[],zoom=1):Array<RangeEstimate|null> {
  if(!Number.isFinite(zoom)||zoom<1||zoom>4)throw Error('Zoom video cần nằm trong 1–4×.');
  const out=boxes.map((_,i)=>ranges[i]?structuredClone(ranges[i]!):null);
  if(zoom!==1)return boxes.map(()=>invalidLearned('Video có zoom/crop; cần profile đúng tiêu cự hiệu dụng, không tự sửa scale AI'));
  for(let i=0;i<boxes.length;i++){
    const far=boxes[i],range=out[i];if(range?.distanceM==null)continue;
    const fh=far.y1-far.y0,fw=far.x1-far.x0;
    for(let j=0;j<boxes.length;j++){
      const near=boxes[j],nr=ranges[j];if(i===j||nr?.distanceM==null||near.label!==far.label||near.score<.65||far.score<.65)continue;
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
  return out;
}
