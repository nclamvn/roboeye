import type {DetBox,DetectionWorkerToMain} from '../detection-types';
import {detectionIoU} from '../detection-postprocess';

export const DRIVE_LITE_DETECTOR=Object.freeze({id:'Megvii-BaseDetection/YOLOX-Nano',revision:'0.1.1rc0',
  file:'yolox-nano-416.onnx',bytes:3659407,sha256:'c789161ed43c8269fcd4e67c67eeeb4e80c622da2eb296a20bc6007bd18a0b7d',
  releaseUrl:'https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_nano.onnx',
  license:'Apache-2.0',width:416,height:416,dtype:'fp32',runtime:'onnxruntime-web-mobile@1.30.0',
  adapter:'official-yolox-raw-bgr-top-left-416-grid-nms-v1'} as const);
export type DriveDetectorChoice='auto'|'lite'|'rtdetr';
export type DriveWorkerMessage=DetectionWorkerToMain|{type:'ready';engine:'yolox';device:'webgpu'|'wasm'};
/** Mobile is an initial workload hint, NOT an acceptance verdict. */
export function chooseDriveDetector(choice:DriveDetectorChoice,mobileHint:boolean):'lite'|'rtdetr'{
  return choice==='auto'?(mobileHint?'lite':'rtdetr'):choice;
}
const labels:Readonly<Record<number,string>>={2:'car',5:'bus',7:'truck'};
/** Upstream legacy=false preprocessing consumes cv2 BGR, raw 0..255,
 * top-left letterbox padded 114. Do NOT reuse RT-DETR's RGB /255 processor. */
export function liteBgr(rgba:Uint8ClampedArray,out=new Float32Array(3*416*416)){
  const n=416*416;if(rgba.length!==n*4||out.length!==n*3)throw Error('Nano input shape mismatch');
  for(let i=0,j=0;i<n;i++,j+=4){out[i]=rgba[j+2];out[n+i]=rgba[j+1];out[2*n+i]=rgba[j];}return out;
}
/** Official ONNX output has undecoded grid offsets, not pixel centre boxes. */
export function decodeLite(data:Float32Array,dims:readonly number[],width:number,height:number):DetBox[]{
  if(dims.join(',')!=='1,3549,85'||data.length!==3549*85||!Number.isFinite(width+height)||width<1||height<1)throw Error('Nano output/source contract mismatch');
  const ratio=Math.min(416/width,416/height),boxes:DetBox[]=[];let row=0;
  for(const stride of [8,16,32])for(let gy=0;gy<416/stride;gy++)for(let gx=0;gx<416/stride;gx++,row++){
    const at=row*85,objectness=data[at+4];if(!Number.isFinite(objectness)||objectness<.15||objectness>1)continue;
    let cls=0,prob=-Infinity;for(let k=0;k<80;k++){const p=data[at+5+k];if(Number.isFinite(p)&&p>prob){cls=k;prob=p;}}
    const score=objectness*prob,label=labels[cls]??`coco-${cls}`;if(score<.15||score>1)continue;
    const cx=(data[at]+gx)*stride,cy=(data[at+1]+gy)*stride,bw=Math.exp(data[at+2])*stride,bh=Math.exp(data[at+3])*stride;
    if(![cx,cy,bw,bh].every(Number.isFinite)||bw<=0||bh<=0)continue;
    const x0=Math.max(0,(cx-bw/2)/ratio/width),x1=Math.min(1,(cx+bw/2)/ratio/width),y0=Math.max(0,(cy-bh/2)/ratio/height),y1=Math.min(1,(cy+bh/2)/ratio/height);
    if(x1>x0&&y1>y0)boxes.push({label,score,x0,y0,x1,y1});
  }
  // Suppress across all winning COCO classes before the vehicle allowlist:
  // a strong sign/person must also suppress a weak overlapping vehicle.
  const kept:DetBox[]=[];for(const box of boxes.sort((a,b)=>b.score-a.score).slice(0,300))if(!kept.some(other=>detectionIoU(box,other)>.45))kept.push(box);
  return kept.filter(box=>!box.label.startsWith('coco-')).slice(0,32);
}
