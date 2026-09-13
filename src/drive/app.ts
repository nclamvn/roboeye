import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/noto-serif/400.css';
import './drive.css';
import { parseProfile, refineMount, type CameraProfile } from './geometry';
import { VehicleTracker, type DriveTrack } from './tracking';
import { evaluate, parseReferences, percentile, type Observation, type ReferenceSample } from './benchmark';
import { DEMO_PROFILE, demoFrame } from './demo';
import type { DetectionWorkerToMain } from '../detection-types';

const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const video=$<HTMLVideoElement>('video'),canvas=$<HTMLCanvasElement>('overlay'),ctx=canvas.getContext('2d')!;
const capture=document.createElement('canvas'),captureCtx=capture.getContext('2d',{willReadFrequently:true})!;
let source:'none'|'file'|'camera'|'demo'='none',sourceName='',stream:MediaStream|null=null,objectUrl:string|null=null;
let profile:CameraProfile|null=null,tracker=new VehicleTracker(),epoch=0,sourceTicket=0,frameId=0,raf=0;
let worker:Worker|null=null,ready=false,loading=false,backend='',pending:{id:number;t:number;wall:number;epoch:number;w:number;h:number}|null=null;
let observations:Observation[]=[],references:ReferenceSample[]=[],latest:DriveTrack[]=[];
let importedDraft:CameraProfile|null=null,frameLatencies:number[]=[],droppedResults=0;
let demoStart=0,lastDemo=-Infinity,lastFrame=-1,lastTable=0,loadAt=0;
const status=(s:string)=>{$('status').textContent=s;};
const number=(id:string)=>Number($<HTMLInputElement>(id).value);
function size():[number,number]{return source==='demo'?[1280,720]:[video.videoWidth,video.videoHeight];}
function clock(){return source==='demo'?performance.now()-demoStart:video.currentTime*1000;}
function resetTimeline(clearReferences=true){epoch++;tracker=new VehicleTracker();observations=[];latest=[];lastFrame=-1;frameLatencies=[];droppedResults=0;if(clearReferences){references=[];$('reference-status').textContent='Chưa có đối chứng cho phiên này.';}}
function clearProfile(){profile=null;$('profile-status').textContent='Chưa hiệu chuẩn — nhãn khoảng cách bị khóa.';$<HTMLButtonElement>('export-profile').disabled=true;$<HTMLInputElement>('confirmed').checked=false;resetTimeline();}
function stopSource(){sourceTicket++;source='none';sourceName='';importedDraft=null;video.pause();stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;video.removeAttribute('src');video.load();if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=null;clearProfile();resetTimeline(true);for(const key of ['fx','fy','cx','cy','heightM','pitchDeg'])$<HTMLInputElement>(key).value='';$('empty').hidden=false;$('source-label').textContent='Chưa chọn nguồn';$<HTMLButtonElement>('play').disabled=true;$<HTMLInputElement>('seek').disabled=true;}
function stopWorker(){worker?.terminate();worker=null;ready=false;loading=false;pending=null;$('backend').textContent='AI chưa tải';$('model').textContent='Bật nhận diện xe';}
function profileToForm(p:CameraProfile){for(const key of ['width','height','fx','fy','cx','cy','heightM','pitchDeg','rollDeg','maxM'] as const)$<HTMLInputElement>(key).value=String(p[key]);$<HTMLInputElement>('distortion').value=p.distortion.join(',');}
function applyProfile(p:CameraProfile){const [w,h]=size();if(!w||w!==p.width||h!==p.height)throw Error('Profile phải đúng kích thước nguồn đã mở.');profile=parseProfile(p);resetTimeline();$('profile-status').textContent=`${p.name}: ${w}×${h}. Thông số người dùng cung cấp; chưa nghiệm thu thực địa.`;$<HTMLButtonElement>('export-profile').disabled=false;}
function record(t:number,wall:number,latency:number,paused=false){latest=tracker.snapshot(t,wall,paused);for(const a of latest)observations.push({timeMs:t,trackId:a.id,distanceM:a.range.distanceM,latencyMs:latency,reason:a.range.reason});if(observations.length>20000)observations.splice(0,observations.length-20000);}

function startWorker(){
  stopWorker();loading=true;loadAt=performance.now();$('backend').textContent='Đang tải RT-DETR…';$('model').textContent='Dừng nhận diện';
  const instance=new Worker(new URL('../worker/detect-worker.ts',import.meta.url),{type:'module'});worker=instance;
  instance.onmessage=(event:MessageEvent<DetectionWorkerToMain>)=>{
    if(worker!==instance)return;const m=event.data;
    if(m.type==='ready'){ready=true;loading=false;backend=m.device;$('backend').textContent=`RT-DETR · ${backend}`;status('AI sẵn sàng. Chưa hiệu chuẩn vẫn chỉ khoanh xe.');lastFrame=-1;}
    else if(m.type==='progress')$('backend').textContent=`Tải model ${Math.round(m.progress)}%`;
    else if(m.type==='error'){pending=null;status(`${m.message} — có thể bật WASM và thử lại.`);stopWorker();resetTimeline();}
    else if(m.type==='det'){
      const request=pending;if(!request||request.id!==m.capturedAt)return;pending=null;
      const now=performance.now();
      if(request.epoch!==epoch||source==='none'||source==='demo')return;
      frameLatencies.push(now-request.wall);if(frameLatencies.length>5000)frameLatencies.shift();
      const samePausedFrame=source==='file'&&video.paused&&Math.abs(clock()-request.t)<1;
      if(now-request.wall>1000&&!samePausedFrame){droppedResults++;status('Kết quả AI chậm hơn 1 giây: không hiển thị như phép đo hiện tại. Tạm dừng video để phân tích frame hoặc dùng thiết bị/backend nhanh hơn.');return;}
      const current=size();if(current[0]!==request.w||current[1]!==request.h){clearProfile();status('Nguồn đổi kích thước: cần hiệu chuẩn lại.');return;}
      // Scale detector endpoint uncertainty back into original image coordinates.
      const effective=profile?{...profile,pixelSigma:Math.max(profile.pixelSigma,3*request.w/capture.width)}:null;
      tracker.observe(m.boxes,request.t,request.wall,effective,request.w,request.h);
      record(request.t,now,now-request.wall,video.paused);
    }
  };
  instance.onerror=()=>{status('Worker lỗi: nhận diện đã dừng. Hãy bật lại hoặc chọn WASM.');stopWorker();resetTimeline();};
  instance.postMessage({type:'init',engine:'rtdetr',queries:['car','bus','truck'],forceWasm:$<HTMLInputElement>('wasm').checked,
    localModels:new URLSearchParams(location.search).get('local-models')==='1',profile:'drive'});
}

function sendFrame(){
  if(!ready||pending||!worker||source==='none'||source==='demo'||video.readyState<2||video.seeking)return;
  const t=video.currentTime*1000;if(t===lastFrame)return;
  const [w,h]=size();if(!w||!h)return;
  if(profile&&(profile.width!==w||profile.height!==h)){clearProfile();status('Kích thước camera thay đổi: calibration bị hủy.');}
  capture.width=Math.min(640,w);capture.height=Math.max(1,Math.round(capture.width*h/w));
  try {
    const wall=performance.now();
    captureCtx.drawImage(video,0,0,capture.width,capture.height);const data=captureCtx.getImageData(0,0,capture.width,capture.height);
    const id=++frameId;pending={id,t,wall,epoch,w,h};lastFrame=t;
    worker.postMessage({type:'frame',rgba:data.data.buffer,width:capture.width,height:capture.height,capturedAt:id},[data.data.buffer]);
  }catch(error){status(`Không đọc được frame: ${String(error)}`);stopWorker();resetTimeline();}
}
if('requestVideoFrameCallback' in video){const tick=()=>{sendFrame();video.requestVideoFrameCallback(tick);};video.requestVideoFrameCallback(tick);}

function formatTime(seconds:number){return `${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;}
function draw(now:number){
  raf=requestAnimationFrame(draw);
  if(loading&&now-loadAt>120000){stopWorker();status('Tải model quá 120 giây. Kiểm tra mạng hoặc thử WASM.');}
  if(pending&&now-pending.wall>15000){stopWorker();resetTimeline();status('Inference quá 15 giây: đã dừng để không hiển thị dữ liệu cũ.');}
  if(source==='demo'&&now-lastDemo>100){lastDemo=now;const t=clock(),f=demoFrame(t);tracker.observe(f.boxes,t,now,profile,1280,720);record(t,now,0);}
  else if(source!=='none'&&source!=='demo'&&(!('requestVideoFrameCallback' in video)||video.paused))sendFrame();
  latest=tracker.snapshot(clock(),now,source==='file'&&video.paused);
  const [iw,ih]=size(),stage=$('stage'),aspect=`${iw||1280} / ${ih||720}`;
  // Match the frame to the source. Never stretch/crop the image independently
  // of the overlay, and keep the stage as wide as its playback controls.
  if(stage.style.getPropertyValue('--media-aspect')!==aspect)stage.style.setProperty('--media-aspect',aspect);
  const rect=stage.getBoundingClientRect(),dpr=Math.min(devicePixelRatio,2);
  if(canvas.width!==Math.round(rect.width*dpr)||canvas.height!==Math.round(rect.height*dpr)){canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr);}
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,rect.width,rect.height);
  const scale=Math.min(rect.width/(iw||1280),rect.height/(ih||720)),w=(iw||1280)*scale,h=(ih||720)*scale,left=(rect.width-w)/2,top=(rect.height-h)/2;
  if(source==='demo'){
    ctx.fillStyle='#91b1bf';ctx.fillRect(left,top,w,h*.5);ctx.fillStyle='#52666e';ctx.fillRect(left,top+h*.5,w,h*.5);
    ctx.strokeStyle='#d9d5b5';ctx.lineWidth=2;for(const x of [-.1,.32,.68,1.1]){ctx.beginPath();ctx.moveTo(left+w*.5,top+h*.5);ctx.lineTo(left+w*x,top+h);ctx.stroke();}
    for(const b of demoFrame(clock()).boxes){ctx.fillStyle=b.label==='car'?'#d8e2e7':'#8c9da7';ctx.fillRect(left+b.x0*w,top+b.y0*h,(b.x1-b.x0)*w,(b.y1-b.y0)*h);ctx.fillStyle='#274651';ctx.fillRect(left+(b.x0+.015)*w,top+(b.y0+.02)*h,Math.max(0,(b.x1-b.x0-.03)*w),Math.max(0,(b.y1-b.y0)*h*.35));}
    ctx.fillStyle='#17232b';ctx.font='12px Inter, sans-serif';ctx.fillText('Mẫu tổng hợp • Không phải camera / AI',left+14,top+25);
  }
  const colors={unknown:'#a6b3bc',tracked:'#69c0e1',caution:'#f3bb53',near:'#ff8074'};
  const occupied:Array<{x:number;y:number;w:number}>=[];
  ctx.save();ctx.beginPath();ctx.rect(left,top,w,h);ctx.clip();
  for(const a of latest){const b=a.box,x=left+b.x0*w,y=top+b.y0*h,bw=(b.x1-b.x0)*w,bh=(b.y1-b.y0)*h;
    const label=`#${a.id} ${b.label==='car'?'Ô tô':b.label==='truck'?'Xe tải':'Xe buýt'} · ${a.range.distanceM===null?'chưa đo':`≈${Math.round(a.range.distanceM)} m*`}`;
    ctx.strokeStyle=colors[a.status];ctx.lineWidth=2;ctx.setLineDash(a.status==='unknown'?[6,4]:[]);ctx.strokeRect(x,y,bw,bh);ctx.setLineDash([]);ctx.font='600 12px Inter, sans-serif';
    const tw=Math.min(w-4,ctx.measureText(label).width+16),tx=Math.max(left,Math.min(x,left+w-tw));let ty=Math.max(top,y-26);
    for(let n=0;n<8&&occupied.some(o=>tx<o.x+o.w&&tx+tw>o.x&&Math.abs(ty-o.y)<27);n++)ty=Math.max(top,ty-28);
    occupied.push({x:tx,y:ty,w:tw});if(ty<y-27){ctx.strokeStyle=colors[a.status];ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(tx+5,ty+25);ctx.lineTo(x,y);ctx.stroke();}
    ctx.fillStyle='#152936';ctx.fillRect(tx,ty,tw,25);ctx.fillStyle=colors[a.status];ctx.fillText(label,tx+7,ty+17,tw-12);
  }ctx.restore();
  if(now-lastTable>200){lastTable=now;
    $('count').textContent=String(latest.length);$('age').textContent=latest.length?`${Math.round(Math.max(...latest.map(a=>a.ageMs)))} ms`:'—';
    $('method').textContent=profile?(source==='demo'?'Hình học · mẫu tổng hợp':'Hình học · ước lượng chân xe'):'Chưa hiệu chuẩn';
    $('time').textContent=formatTime(clock()/1000);
    const seek=$<HTMLInputElement>('seek');if(source==='file'&&Number.isFinite(video.duration)){seek.max=String(video.duration);seek.value=String(video.currentTime);}
    $('track-list').replaceChildren(...latest.map(a=>{const row=document.createElement('div');row.className='track';row.dataset.state=a.status;
      const label=document.createElement('span');label.textContent=`#${a.id} ${a.box.label==='car'?'Ô tô':a.box.label==='truck'?'Xe tải':'Xe buýt'} · ${a.range.distanceM===null?'Chưa đủ dữ liệu':`≈${Math.round(a.range.distanceM)} m đến chân xe`}`;
      const detail=document.createElement('small');detail.textContent=a.range.interval?`Dải nhạy sai số ${a.range.interval.map(x=>Math.round(x)).join('–')} m`:a.range.reason;row.append(label,detail);return row;}));
  }
}

async function jsonFile(input:HTMLInputElement){const file=input.files?.[0];input.value='';if(!file)return null;if(file.size>10*1024*1024)throw Error('JSON vượt 10 MB.');return JSON.parse(await file.text()) as unknown;}
function download(name:string,value:unknown){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function safe(action:()=>void|Promise<void>){return ()=>{Promise.resolve().then(action).catch(e=>status(e instanceof Error?e.message:String(e)));};}

$('demo').onclick=()=>{stopSource();source='demo';sourceName='Synthetic analytical replay';profile=structuredClone(DEMO_PROFILE);demoStart=performance.now();lastDemo=-Infinity;$('empty').hidden=true;$('source-label').textContent='Mẫu toán học · không phải AI';profileToForm(profile);$('profile-status').textContent='Profile synthetic; tự hủy khi đổi sang video/camera.';status('Kiểm tra hình học và độ ổn định. Không dùng mẫu này để công bố chất lượng camera.');};
$<HTMLInputElement>('file').onchange=safe(async()=>{const input=$<HTMLInputElement>('file'),file=input.files?.[0];input.value='';if(!file)return;stopSource();source='file';sourceName=file.name;objectUrl=URL.createObjectURL(file);video.src=objectUrl;video.load();$('source-label').textContent=file.name;$('empty').hidden=true;$<HTMLButtonElement>('play').disabled=false;$<HTMLInputElement>('seek').disabled=false;status('Đã mở video. Bật nhận diện; nhập hiệu chuẩn nếu muốn ước lượng mét.');});
$('camera').onclick=safe(async()=>{
  stopSource();const ticket=sourceTicket;status('Đang xin quyền camera sau…');
  const next=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});
  if(ticket!==sourceTicket){next.getTracks().forEach(t=>t.stop());return;}
  stream=next;source='camera';sourceName='Camera local';video.srcObject=stream;
  next.getVideoTracks().forEach(track=>track.addEventListener('ended',()=>{if(stream===next){stopSource();status('Camera đã ngắt; dữ liệu đo đã hủy.');}},{once:true}));
  try{await video.play();}catch(error){if(ticket===sourceTicket)stopSource();throw error;}
  if(ticket!==sourceTicket)return;
  $('empty').hidden=true;$('source-label').textContent='Camera local · không ghi hình';status('Camera đã mở. Chỉ thử tại bãi có kiểm soát, không dùng khi lái.');
});
$('play').onclick=safe(async()=>{if(source!=='file')return;if(video.paused)await video.play();else video.pause();});
$<HTMLInputElement>('seek').oninput=()=>{if(source==='file')video.currentTime=number('seek');};
video.addEventListener('seeking',()=>{resetTimeline(true);status('Đã đổi vị trí video: reset ID/đối chứng để tránh ghép nhầm frame.');});
video.addEventListener('loadedmetadata',()=>{if(source==='none')return;const [w,h]=size();$<HTMLInputElement>('width').value=String(w);$<HTMLInputElement>('height').value=String(h);lastFrame=-1;});
video.addEventListener('error',()=>{if(source!=='none'){status('Không giải mã được video. Chọn MP4/H.264 hoặc định dạng trình duyệt hỗ trợ.');stopSource();}});
$('stop').onclick=()=>{stopSource();stopWorker();status('Đã dừng nguồn, camera và nhận diện.');};
$('model').onclick=()=>{if(worker){stopWorker();resetTimeline();}else startWorker();};
$<HTMLInputElement>('wasm').onchange=()=>{if(worker)startWorker();resetTimeline();};
$('clear-profile').onclick=clearProfile;
$('calibration').addEventListener('input',event=>{if((event.target as HTMLElement).id!=='confirmed'){importedDraft=null;clearProfile();}});
$('calibration').onsubmit=event=>{event.preventDefault();safe(()=>{if(!$<HTMLInputElement>('confirmed').checked)throw Error('Cần xác nhận calibration đã đo.');const base=importedDraft??{...DEMO_PROFILE,pitchSigmaDeg:.3,heightSigmaM:.03,focalSigmaFraction:.02};
  const p:CameraProfile={...base,name:importedDraft?.name??'Thông số người dùng',width:number('width'),height:number('height'),fx:number('fx'),fy:number('fy'),cx:number('cx'),cy:number('cy'),heightM:number('heightM'),pitchDeg:number('pitchDeg'),rollDeg:number('rollDeg'),maxM:number('maxM'),distortion:$<HTMLInputElement>('distortion').value.split(',').map(Number) as CameraProfile['distortion']};
  applyProfile(parseProfile(p));status('Đã áp dụng: còn giả định đường phẳng và mép box là chân xe.');})();};
$<HTMLInputElement>('profile-file').onchange=safe(async()=>{const ticket=epoch,value=await jsonFile($<HTMLInputElement>('profile-file'));if(value===null)return;if(ticket!==epoch)throw Error('Nguồn đã thay đổi; nhập lại profile.');const p=parseProfile(value);if(source==='none')throw Error('Mở nguồn trước khi nhập profile.');profileToForm(p);clearProfile();importedDraft=p;status('Đã điền profile. Kiểm tra và xác nhận thông số trước khi áp dụng.');});
$('export-profile').onclick=()=>{if(profile)download('drivesense-camera-profile.json',profile);};
$<HTMLInputElement>('ground-file').onchange=safe(async()=>{const ticket=epoch,value=await jsonFile($<HTMLInputElement>('ground-file'));if(value===null)return;if(!profile||ticket!==epoch)throw Error('Cần profile đang áp dụng.');const result=refineMount(profile,value as Parameters<typeof refineMount>[1]);applyProfile(result.profile);profileToForm(result.profile);$('fit-status').textContent=`Holdout ${result.checkCount} điểm: MAE ${result.checkMAE.toFixed(2)} m, max ${result.checkMax.toFixed(2)} m. Không chứng nhận cảnh báo lái xe.`;});
$<HTMLInputElement>('reference-file').onchange=safe(async()=>{const ticket=epoch,value=await jsonFile($<HTMLInputElement>('reference-file'));if(value===null)return;if(ticket!==epoch)throw Error('Timeline đã đổi, hãy nhập lại đối chứng.');references=parseReferences(value);$('reference-status').textContent=`${references.length} mẫu đối chứng người dùng. Không tự xác minh phép đo này.`;});
$('report').onclick=()=>download('drivesense-report.json',{version:1,createdAt:new Date().toISOString(),source:sourceName,sourceKind:source,session:epoch,synthetic:source==='demo',distanceKind:'ground_contact_forward_m',model:source!=='demo'&&backend?{name:'RT-DETRv2 R18',backend}:null,profile,summary:evaluate(observations,references),frameTiming:{count:frameLatencies.length,captureToResultP95Ms:percentile(frameLatencies,.95),droppedResults,scope:'Bao gồm kết quả quá hạn, tính từ đọc video frame, không đo độ trễ sensor/encode/mạng hay photon-to-display.'},observations,references,limits:'Baseline nghiên cứu. Không FCW, không khoảng hở cản xe, không accuracy nếu thiếu ground truth; quan sát giới hạn 20000 mẫu mới nhất.'});
document.addEventListener('visibilitychange',()=>{if(document.hidden){video.pause();resetTimeline();status('Tab bị ẩn: dữ liệu tracking đã hủy. Phát lại khi quay lại.');}});
window.addEventListener('pagehide',()=>{cancelAnimationFrame(raf);stopSource();stopWorker();});
raf=requestAnimationFrame(draw);
