import {DA2_DRIVE,type MetricMap} from './metric-contract';
import {estimateLearnedVehicleRange,letterboxTransform} from './learned-range';
import {buildReplay,type ReplaySample} from './replay';
import type {DetBox} from '../detection-types';

const status=document.getElementById('status')!,canvas=document.getElementById('view') as HTMLCanvasElement,ctx=canvas.getContext('2d',{willReadFrequently:true})!;
const report:{status:string;distanceM:number|null;backend:string;p50Ms:number|null;p95Ms:number|null;samples:number;provenance:string|null;error:string|null}={status:'running',distanceM:null,backend:'',p50Ms:null,p95Ms:null,samples:0,provenance:null,error:null};
Object.assign(window,{driveRangeSmoke:report});
const image=new Image();image.src='/tests/.detection-benchmark-cache/bus.jpg';await image.decode();
canvas.width=DA2_DRIVE.width;canvas.height=DA2_DRIVE.height;const t=letterboxTransform(image.naturalWidth,image.naturalHeight,canvas.width,canvas.height);
ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,image.naturalWidth,image.naturalHeight,t.offsetX,t.offsetY,t.contentWidth,t.contentHeight);
const worker=new Worker(new URL('../worker/drive-range-worker.ts',import.meta.url),{type:'module'}),box:DetBox={label:'bus',score:.96,x0:.01,y0:.22,x1:.99,y1:.71},latencies:number[]=[];
const send=()=>{const rgba=ctx.getImageData(0,0,canvas.width,canvas.height),id=latencies.length+1;worker.postMessage({type:'frame',id,width:canvas.width,height:canvas.height,rgba:rgba.data.buffer},[rgba.data.buffer]);};
const finished=new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Timeout metric smoke')),120000);worker.onmessage=({data:m})=>{if(m?.channel!=='drive-range-v1')return;
  if(m.type==='ready'){report.backend=m.backend;send();}
  else if(m.type==='result'){
    const range=estimateLearnedVehicleRange(m.map as MetricMap,box,t);latencies.push(m.latencyMs);if(latencies.length<21){send();return;}
    const samples:ReplaySample[]=[0,200,400].map((timeMs,index)=>({timeMs,boxes:[box],latencyMs:10,width:image.naturalWidth,height:image.naturalHeight,learnedRanges:[range],metricLatencyMs:latencies[index]}));
    const replay=buildReplay(samples,null),track=replay.at(-1)?.tracks[0],sorted=[...latencies].sort((a,b)=>a-b),pick=(q:number)=>sorted[Math.ceil(q*sorted.length)-1];if(!track?.range.distanceM)reject(Error(track?.range.reason??'Tracker không có range'));
    else{report.status='pass';report.distanceM=track.range.distanceM;report.p50Ms=pick(.5);report.p95Ms=pick(.95);report.samples=latencies.length;report.provenance=track.range.provenance;status.textContent=`PASS · bus ≈${track.range.distanceM.toFixed(1)} m · ${report.backend} · P50 ${report.p50Ms.toFixed(1)} ms · P95 ${report.p95Ms.toFixed(1)} ms · ${report.samples} mẫu · learned-unverified`;clearTimeout(timer);resolve();}
  }else if(m.type==='error'){clearTimeout(timer);reject(Error(m.message));}
};worker.onerror=()=>reject(Error('Worker crash'));worker.postMessage({type:'init',backend:'webgpu'});});
try{await finished;}catch(error){report.status='fail';report.error=error instanceof Error?error.message:String(error);status.textContent=`FAIL · ${report.error}`;}finally{worker.terminate();}
