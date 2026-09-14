import {MOGE_SMALL,DA2_METRIC,MetricFrameGate,probeMetric,type MetricMap} from './metric-contract';
import {evaluateMetric,parseMetricReferences,type MetricReference,type MetricObservation} from './metric-benchmark';
import {percentile} from './benchmark';
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const video=$<HTMLVideoElement>('video'),image=$<HTMLImageElement>('image');
const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true})!;
const gate=new MetricFrameGate();
let worker:Worker|null=null,ready=false,inflight=false,live=false,source:'none'|'image'|'video'|'camera'|'reference'='none';
let epoch=0,url:string|null=null,stream:MediaStream|null=null,stillFrame=0,probe:[number,number]=[.5,.5],last:MetricMap|null=null;
let capturedAt=0,prepMs=0,timer:ReturnType<typeof setTimeout>|null=null;
let sourceFrameMs=0,referenceInput:{rgb:Float32Array;width:number;height:number;tokens:number}|null=null;
type Sample=MetricObservation&{computeMs:number;postMs:number;prepMs:number;mode:string;mediaMs:number;point:[number,number];warmup:boolean};
let samples:Sample[]=[],refs:MetricReference[]=[],backend='',totalCompleted=0,lastError:string|null=null;
let lastResultAt=0,latestId='',dropped=0,raf=0;
let selectedModel='moge';
const status=(text:string)=>{$('status').textContent=text;};
function buttons(){for(const id of ['step','live'])$<HTMLButtonElement>(id).disabled=!ready||source==='none'||inflight;$('live').textContent=live?'Dừng đo liên tục':'Bắt đầu đo liên tục';}
function clearTimer(){if(timer!==null)clearTimeout(timer);timer=null;}
function stopAI(){live=false;ready=false;inflight=false;worker?.terminate();worker=null;gate.cancel();clearTimer();last=null;buttons();$('measurement').textContent='AI đã dừng — không có phép đo hiện tại.';}
function clearSource(){epoch++;stopAI();video.pause();stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;video.removeAttribute('src');video.load();image.removeAttribute('src');if(url)URL.revokeObjectURL(url);url=null;source='none';referenceInput=null;image.hidden=video.hidden=true;$('probe').hidden=true;samples=[];refs=[];totalCompleted=dropped=0;stillFrame=0;}
function report(){return {schema:'drivesense-metric-lab-v1',model:selectedModel==='moge'?MOGE_SMALL:DA2_METRIC,backend,userAgent:navigator.userAgent,sourceKind:source,
  probe,completed:totalCompleted,retained:samples.length,dropped,computeP95Ms:percentile(samples.map(s=>s.computeMs),.95),
  executionProviderRequested:backend,kernelPlacement:'not-profiled; ORT can place shape/control nodes on CPU',
  warmSampleCount:samples.filter(s=>!s.warmup).length,warmAgeP95Ms:percentile(samples.filter(s=>!s.warmup).map(s=>s.ageMs),.95),
  postP95Ms:percentile(samples.map(s=>s.postMs),.95),quality:evaluateMetric(samples,refs),samples,
  status:'experimental-not-road-qualified',lastError,note:'Browser measurements, not sensor-to-screen. No video upload. Warmup retained and identified by sample order; no phone result inferred.'};}
function showReport(){$('stats').textContent=JSON.stringify({...report(),samples:undefined},null,2);}
function display(){
  if(!last)return;
  const expired=live&&performance.now()-capturedAt>200,d=probeMetric(last,...probe);
  $('measurement').textContent=expired?'Dữ liệu quá 200 ms — không hiển thị như khoảng cách hiện tại.':d===null?'Điểm chọn không có độ sâu hợp lệ.':`≈ ${d.toFixed(1)} m Z · ước lượng chưa kiểm chứng${live?'':' · frame tĩnh, không phải realtime'}`;
}
async function loadImage(src:string){const token=epoch;image.src=src;await image.decode();if(token!==epoch)return;source='image';image.hidden=false;$('probe').hidden=false;positionProbe();status('Ảnh đã sẵn sàng. Khởi tạo model để đo.');buttons();}
function positionProbe(){const visual=source==='image'?image:video;const rect=visual.getBoundingClientRect(),stage=$('stage').getBoundingClientRect();
  const iw=source==='image'?image.naturalWidth:video.videoWidth,ih=source==='image'?image.naturalHeight:video.videoHeight;
  if(!iw||!ih)return;const s=Math.min(rect.width/iw,rect.height/ih);
  const marker=$('probe');marker.style.left=`${rect.left-stage.left+(rect.width-iw*s)/2+probe[0]*iw*s}px`;marker.style.top=`${rect.top-stage.top+(rect.height-ih*s)/2+probe[1]*ih*s}px`;}
async function init(){
  stopAI();samples=[];refs=[];totalCompleted=dropped=0;lastError=null;selectedModel=$<HTMLSelectElement>('model').value;backend=$<HTMLSelectElement>('backend').value;status('Khởi tạo model…');
  const current=new Worker(new URL('../worker/drive-metric-worker.ts',import.meta.url),{type:'module'});worker=current;
  timer=setTimeout(()=>{if(worker===current){lastError='Timeout khởi tạo';stopAI();status('Timeout khởi tạo; không fallback ngầm.');}},120000);
  current.onmessage=({data:m})=>{
    if(worker!==current)return;
    if(m.type==='status')status(m.message);
    else if(m.type==='ready'){clearTimer();ready=true;buttons();status(`Model đã kiểm hash. Backend yêu cầu: ${backend}. Chưa kiểm chứng mét thực.`);}
    else if(m.type==='error'){lastError=m.message;stopAI();status(`LỖI: ${m.message}`);showReport();}
    else if(m.type==='result'){
      clearTimer();inflight=false;const now=performance.now(),accepted=gate.finish(m.id,now,Infinity);
      if(!accepted){dropped++;buttons();return;}
      last=m.map;lastResultAt=now;latestId=`${sourceFrameMs.toFixed(2)}:${probe[0].toFixed(3)}:${probe[1].toFixed(3)}:${++totalCompleted}`;
      const estimateM=probeMetric(last!,...probe),sample={id:latestId,estimateM,ageMs:accepted.ageMs,computeMs:m.computeMs,postMs:m.postMs,prepMs,mode:live?'live':'static',mediaMs:sourceFrameMs,point:[...probe] as [number,number],warmup:totalCompleted===1};
      samples.push(sample);if(samples.length>5000)samples.shift();display();showReport();buttons();
    }
  };
  current.onerror=e=>{lastError=e.message;stopAI();status(`Worker lỗi: ${e.message}`);};
  current.postMessage({type:'init',backend,model:selectedModel});
}
function send(){
  if(!ready||!worker||inflight||source==='none')return;
  if(selectedModel==='da2'&&source!=='reference'){status('DA2 chỉ mở cho Fixture tham chiếu: chưa xác minh resize/shape khác.');return;}
  if((source==='video'||source==='camera')&&(video.readyState<2||video.seeking))return;
  if(live&&source==='video'&&video.paused)return;
  const staticSource=source==='image'||source==='reference';
  const stamp=staticSource?++stillFrame:video.currentTime*1000;
  const wall=performance.now(),request=gate.begin(stamp,wall);if(!request)return;
  capturedAt=wall;sourceFrameMs=staticSource?0:stamp;inflight=true;last=null;$('measurement').textContent='Đang đo frame mới…';buttons();
  try {
    let rgb:Float32Array,width:number,height:number,tokens=Number($<HTMLSelectElement>('tokens').value);
    if(source==='reference'&&referenceInput){({width,height,tokens}=referenceInput);rgb=referenceInput.rgb.slice();}
    else {
      const visual=source==='image'?image:video,iw=source==='image'?image.naturalWidth:video.videoWidth,ih=source==='image'?image.naturalHeight:video.videoHeight;
      width=280;height=Math.max(28,Math.round(280*ih/iw));if(height>1000){height=280;width=Math.max(28,Math.round(height*iw/ih));}
      canvas.width=width;canvas.height=height;ctx.drawImage(visual,0,0,width,height);const rgba=ctx.getImageData(0,0,width,height).data,n=width*height;rgb=new Float32Array(3*n);
      for(let k=0;k<n;k++)for(let c=0;c<3;c++)rgb[c*n+k]=rgba[4*k+c]/255;
    }
    prepMs=performance.now()-wall;
    timer=setTimeout(()=>{lastError='Inference timeout 30s';stopAI();status('Inference quá 30 giây: đã hủy, không giữ khoảng cách cũ.');},30000);
    worker.postMessage({type:'frame',id:request.id,width,height,tokens,rgb:rgb.buffer},[rgb.buffer]);
  }catch(e){stopAI();status(String(e));}
}
function loop(){raf=requestAnimationFrame(loop);if(live){display();send();}}
loop();
$('init').onclick=()=>void init();$('step').onclick=()=>{live=false;if(source==='video'||source==='camera')video.pause();buttons();send();};
for(const id of ['model','backend'])$(id).onchange=()=>{stopAI();status('Cấu hình đã đổi. Khởi tạo lại model trước khi đo.');};
$('live').onclick=async()=>{if(source==='image'||source==='reference'){status('Ảnh tĩnh chỉ dùng đo một frame; không gọi là realtime.');return;}live=!live;if(live)try{await video.play();}catch(e){live=false;status(String(e));}buttons();};
$('stop').onclick=()=>{stopAI();status('Đã dừng AI.');};$('source-stop').onclick=()=>{clearSource();status('Đã dừng nguồn và giải phóng camera.');};
$('fixture').onclick=()=>{clearSource();void loadImage('/tests/.detection-benchmark-cache/bus.jpg').catch(e=>status(String(e)));};
$('reference').onclick=async()=>{clearSource();const token=epoch;try{const r=await fetch('/tests/.metric-cache/reference.json');if(!r.ok)throw Error('Chưa tạo fixture tham chiếu.');const meta=await r.json();const data=await fetch('/tests/.metric-cache/input.bin');if(!data.ok)throw Error('Thiếu input.bin');const buffer=await data.arrayBuffer();if(token!==epoch)return;referenceInput={rgb:new Float32Array(buffer),width:meta.width,height:meta.height,tokens:meta.tokens};source='reference';status('Fixture tham chiếu cùng tensor NCHW. Khởi tạo rồi đo.');buttons();}catch(e){status(String(e));}};
$<HTMLInputElement>('file').onchange=async e=>{const file=(e.target as HTMLInputElement).files?.[0];if(!file)return;clearSource();url=URL.createObjectURL(file);try{if(file.type.startsWith('image/'))await loadImage(url);else if(file.type.startsWith('video/')){source='video';video.src=url;video.hidden=false;await video.play();$('probe').hidden=false;status('Video đang phát. Khởi tạo model rồi chọn đo liên tục.');buttons();}else throw Error('Chọn ảnh hoặc video.');}catch(error){status(String(error));}};
$('camera').onclick=async()=>{clearSource();const token=epoch;try{const next=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280}},audio:false});if(token!==epoch){next.getTracks().forEach(t=>t.stop());return;}stream=next;source='camera';video.srcObject=stream;video.hidden=false;await video.play();$('probe').hidden=false;status('Camera sẵn sàng. Khởi tạo model để đo.');buttons();}catch(e){status(String(e));}};
$('stage').onclick=e=>{if(source!=='image'&&source!=='video'&&source!=='camera')return;const visual=source==='image'?image:video,r=visual.getBoundingClientRect(),iw=source==='image'?image.naturalWidth:video.videoWidth,ih=source==='image'?image.naturalHeight:video.videoHeight,s=Math.min(r.width/iw,r.height/ih);
  const u=(e.clientX-r.left-(r.width-iw*s)/2)/(iw*s),v=(e.clientY-r.top-(r.height-ih*s)/2)/(ih*s);if(u<0||v<0||u>1||v>1)return;probe=[u,v];positionProbe();display();};
$<HTMLInputElement>('refs').onchange=async e=>{const file=(e.target as HTMLInputElement).files?.[0];if(!file)return;try{if(file.size>1000000)throw Error('JSON quá lớn.');refs=parseMetricReferences(JSON.parse(await file.text()));showReport();}catch(error){status(String(error));}};
$('export').onclick=()=>{const link=document.createElement('a'),blob=new Blob([JSON.stringify(report(),null,2)],{type:'application/json'});link.href=URL.createObjectURL(blob);link.download='drivesense-metric-lab.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);};
video.onseeking=()=>{gate.reset();last=null;$('measurement').textContent='Đã đổi thời điểm video — cần phép đo mới.';};
video.onplay=()=>{if(!live){last=null;$('measurement').textContent='Video đang chạy — bật đo liên tục để lấy dữ liệu mới.';}};
addEventListener('resize',positionProbe);video.onloadedmetadata=positionProbe;
addEventListener('pagehide',()=>{clearSource();cancelAnimationFrame(raf);});
// Read-only diagnostic output for the independent browser parity test.
Object.assign(window,{metricLab:{report,getMap:()=>last,getLastResultAt:()=>lastResultAt}});
