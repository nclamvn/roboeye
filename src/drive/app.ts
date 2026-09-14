import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/noto-serif/400.css';
import './drive.css';
import { parseProfile, refineMount, type CameraProfile } from './geometry';
import { VehicleTracker, type DriveTrack } from './tracking';
import { evaluate, parseReferences, percentile, type Observation, type ReferenceSample } from './benchmark';
import { DEMO_PROFILE, demoFrame } from './demo';
import type { DetBox, DetectionWorkerToMain } from '../detection-types';
import {buildReplay,replayAt,sampleTimes,seekDecoded,type ReplaySample,type ReplayFrame} from './replay';
import {DRIVE_DECODER} from './detector-decode';
import {DRIVE_CANDIDATE_POLICY,vehicleCandidates,VEHICLE_STRONG_SCORE} from './vehicle-candidates';
import {DA2_DRIVE,type MetricMap} from './metric-contract';
import {estimateLearnedVehicleRange,letterboxTransform,LEARNED_RANGE_POLICY,type LetterboxTransform} from './learned-range';
import type {RangeEstimate} from './geometry';
import {assessRisk,corridorHalfWidth,type RiskSnapshot,type RiskTrack,type ThreatLevel} from './risk';
import {trackColour} from './track-identity';
import {hudDistance,hudMode,highlightThreat,hudWarning,redThreat,playbackControl} from './hud';
import {FileAnalysisJob} from './analysis-job';
import {runOfflinePipeline} from './offline-pipeline';
import {focalFromHorizontalFov} from './camera-intrinsics';
import {DRIVE_GPU_DETECTOR} from './detector-contract';

// A release service worker previously installed on localhost must never make the
// development session look stale after a code change.
if(import.meta.env.DEV&&'serviceWorker' in navigator)void navigator.serviceWorker.getRegistrations().then(registrations=>Promise.all(registrations.map(registration=>registration.unregister())));

const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const video=$<HTMLVideoElement>('video'),canvas=$<HTMLCanvasElement>('overlay'),ctx=canvas.getContext('2d')!;
const capture=document.createElement('canvas'),captureCtx=capture.getContext('2d',{willReadFrequently:true})!;
const metricCapture=document.createElement('canvas'),metricCaptureCtx=metricCapture.getContext('2d',{willReadFrequently:true})!;
let source:'none'|'file'|'camera'|'demo'='none',sourceName='',stream:MediaStream|null=null,objectUrl:string|null=null;
let profile:CameraProfile|null=null,tracker=new VehicleTracker(),epoch=0,sourceTicket=0,frameId=0,raf=0;
interface PendingFrame {id:number;t:number;wall:number;epoch:number;w:number;h:number;resolve?:(s:ReplaySample)=>void;reject?:(e:Error)=>void}
let worker:Worker|null=null,ready=false,loading=false,backend='',pending:PendingFrame|null=null;
interface PendingMetric {id:number;wall:number;boxes:DetBox[];transform:LetterboxTransform;resolve:(value:{ranges:Array<RangeEstimate|null>;latencyMs:number})=>void;reject:(error:Error)=>void}
type MetricWorkerMessage=({type:'status';message:string}|{type:'ready';backend:'webgpu'|'wasm';warmupMs:number}|{type:'result';id:number;map:MetricMap;latencyMs:number}|{type:'error';id?:number;stage:'load'|'infer';message:string})&{channel:'drive-range-v1'};
let metricWorker:Worker|null=null,metricReady=false,metricLoading=false,metricBackend='',metricPending:PendingMetric|null=null,metricFrameId=0,metricLoadAt=0;
let observations:Observation[]=[],references:ReferenceSample[]=[],latest:DriveTrack[]=[];
let importedDraft:CameraProfile|null=null,frameLatencies:number[]=[],droppedResults=0;
let demoStart=0,lastDemo=-Infinity,lastFrame=-1,lastTable=0,loadAt=0;
let analysis:AbortController|null=null,autoAnalyse=false,replayReady=false,samples:ReplaySample[]=[],replayFrames:ReplayFrame[]=[];
let analysisStarted=0,analysisElapsedMs=0;
const fileJob=new FileAnalysisJob();
let analysisBackend='';
let analysisMetricBackend='',metricLatencies:number[]=[];
interface HazardEvent {timeMs:number;trackId:number;level:'caution'|'critical';ttcS:number|null;distanceM:number|null;confidence:number;reason:string}
let riskEvents:HazardEvent[]=[],lastRiskEvent=new Map<string,number>(),latestRisk:RiskSnapshot=assessRisk([],{speedKph:0,adverse:false});
let alertsEnabled=false,audioContext:AudioContext|null=null,lastAlertWall=-Infinity;
const status=(s:string)=>{$('status').textContent=s;};
const number=(id:string)=>Number($<HTMLInputElement>(id).value);
function size():[number,number]{return source==='demo'?[1280,720]:[video.videoWidth,video.videoHeight];}
function clock(){return source==='demo'?performance.now()-demoStart:video.currentTime*1000;}
function resetTimeline(clearReferences=true){epoch++;tracker=new VehicleTracker();observations=[];latest=[];latestRisk=assessRisk([],{speedKph:0,adverse:false});riskEvents=[];lastRiskEvent.clear();lastFrame=-1;frameLatencies=[];metricLatencies=[];droppedResults=0;$('event-count').textContent='0';if(clearReferences){references=[];$('reference-status').textContent='Chưa có đối chứng cho phiên này.';}}
function refreshReplay(){if(replayReady)replayFrames=buildReplay(samples,profile?{...profile,pixelSigma:Math.max(profile.pixelSigma,3*profile.width/640)}:null,number('video-zoom'));}
function cancelAnalysis(){autoAnalyse=false;analysis?.abort();analysis=null;fileJob.cancel();$<HTMLButtonElement>('analyse').textContent='Phân tích lại video';}
function zoomDescription(){const zoom=number('video-zoom');return zoom===1?'1×: AI chưa kiểm chứng; xe cắt biên, quá nhỏ hoặc phối cảnh mâu thuẫn sẽ không hiện số đo.':`${zoom}×: AI không biết tiêu cự; nhập profile đúng lens/crop để có mét hình học. Không chia/nhân số AI theo zoom.`;}
function clearProfile(){profile=null;$('profile-status').textContent=number('video-zoom')===1?'Chưa có profile hình học; chỉ dùng AI metric chưa kiểm chứng khi ROI hợp lệ.':'Chưa có profile đúng zoom/crop; chưa thể công bố số mét.';$('zoom-status').textContent=zoomDescription();$<HTMLButtonElement>('export-profile').disabled=true;$<HTMLInputElement>('confirmed').checked=false;resetTimeline();refreshReplay();}
function stopSource(){cancelAnalysis();fileJob.reset();replayReady=false;samples=[];replayFrames=[];analysisElapsedMs=0;$<HTMLProgressElement>('analysis-progress').value=0;sourceTicket++;source='none';sourceName='';importedDraft=null;video.pause();stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;video.removeAttribute('src');video.load();if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=null;$<HTMLInputElement>('video-zoom').value='1';clearProfile();resetTimeline(true);for(const key of ['fx','fy','cx','cy','heightM','pitchDeg','base-fov'])$<HTMLInputElement>(key).value='';$('empty').hidden=false;$('source-label').textContent='Chưa chọn nguồn';$<HTMLButtonElement>('play').disabled=true;$<HTMLInputElement>('seek').disabled=true;}
function stopWorker(){pending?.reject?.(Error('Nhận diện đã dừng.'));worker?.terminate();worker=null;ready=false;loading=false;pending=null;$('backend').textContent='AI chưa tải';$('model').textContent='Bật nhận diện xe';}
function stopMetricWorker(message='Khoảng cách AI chưa tải'){metricPending?.reject(Error('Metric AI đã dừng.'));metricWorker?.terminate();metricWorker=null;metricReady=false;metricLoading=false;metricPending=null;metricBackend='';$('metric-backend').textContent=message;}
function failFileAnalysis(message:string,action:'retry'|'choose'='retry'){
  if(source==='file'){cancelAnalysis();stopWorker();stopMetricWorker();replayReady=false;samples=[];replayFrames=[];fileJob.fail(message,action);}
  status(message);
}
function queueFileAnalysis(){
  if(source!=='file'||analysis)return;
  try{
    // Metadata preflight precedes any AI initialisation, including retry paths.
    const times=fileJob.prepare(video.duration*1000),progress=$<HTMLProgressElement>('analysis-progress');
    progress.max=times.length;progress.value=0;autoAnalyse=true;
    if(!worker)startWorker();else if(!metricWorker)startMetricWorker();
    status(`Video hợp lệ · ${times.length} khung cần xử lý. Đang chuẩn bị AI.`);
  }catch(e){failFileAnalysis(e instanceof Error?e.message:String(e),'choose');}
}
function cancelFileAnalysis(){
  cancelAnalysis();stopWorker();stopMetricWorker();replayReady=false;samples=[];replayFrames=[];resetTimeline();
  status('Đã hủy phân tích; chưa có kết quả hoàn chỉnh. Bấm Chạy lại để thử lại.');
}
function profileToForm(p:CameraProfile){for(const key of ['width','height','fx','fy','cx','cy','heightM','pitchDeg','rollDeg','maxM'] as const)$<HTMLInputElement>(key).value=String(p[key]);$<HTMLInputElement>('distortion').value=p.distortion.join(',');}
function applyProfile(p:CameraProfile){const [w,h]=size();if(!w||w!==p.width||h!==p.height)throw Error('Profile phải đúng kích thước nguồn đã mở.');profile=parseProfile(p);resetTimeline();refreshReplay();$('profile-status').textContent=`${p.name}: ${w}×${h}. Thông số người dùng cung cấp; chưa nghiệm thu thực địa.`;$<HTMLButtonElement>('export-profile').disabled=false;}
function record(t:number,wall:number,latency:number,paused=false){latest=tracker.snapshot(t,wall,paused);for(const a of latest)observations.push({timeMs:t,trackId:a.id,distanceM:a.range.distanceM,latencyMs:latency,reason:a.range.reason});if(observations.length>20000)observations.splice(0,observations.length-20000);}

function startMetricWorker(cleanWasmRetry=false){
  stopMetricWorker('Đang tải khoảng cách AI…');metricLoading=true;metricLoadAt=performance.now();
  const instance=new Worker(new URL('../worker/drive-range-worker.ts',import.meta.url),{type:'module'});metricWorker=instance;
  instance.onmessage=(event:MessageEvent<MetricWorkerMessage>)=>{
    if(metricWorker!==instance)return;const m=event.data;if(m?.channel!=='drive-range-v1')return;
    if(m.type==='status')$('metric-backend').textContent=m.message;
    else if(m.type==='ready'){metricReady=true;metricLoading=false;metricBackend=m.backend;$('metric-backend').textContent=`Khoảng cách AI · ${m.backend}`;}
    else if(m.type==='result'){
      const request=metricPending;if(!request||request.id!==m.id)return;metricPending=null;
      try{request.resolve({ranges:request.boxes.map(box=>estimateLearnedVehicleRange(m.map,box,request.transform)),latencyMs:m.latencyMs});}
      catch(error){request.reject(error instanceof Error?error:Error(String(error)));}
    }else if(m.type==='error'){
      if(m.stage==='load'&&!cleanWasmRetry&&!$<HTMLInputElement>('wasm').checked){startMetricWorker(true);return;}
      metricPending?.reject(Error(m.message));metricPending=null;stopMetricWorker('Khoảng cách AI không khả dụng');
      status(`Khoảng cách AI không tải được; vẫn tiếp tục khoanh xe. ${m.message}`);
    }
  };
  instance.onerror=()=>{metricPending?.reject(Error('Metric worker lỗi.'));metricPending=null;stopMetricWorker('Khoảng cách AI không khả dụng');status('Khoảng cách AI lỗi; nhận diện xe vẫn tiếp tục.');};
  instance.postMessage({type:'init',backend:$<HTMLInputElement>('wasm').checked||cleanWasmRetry?'wasm':'webgpu'});
}

function startWorker(cleanWasmRetry=false){
  stopWorker();if(!metricWorker)startMetricWorker();loading=true;loadAt=performance.now();$('backend').textContent='Đang tải RT-DETR…';$('model').textContent='Dừng nhận diện';
  const useGpu=!cleanWasmRetry&&!$<HTMLInputElement>('wasm').checked;
  const instance=useGpu?new Worker(new URL('../worker/drive-detect-worker.ts',import.meta.url),{type:'module'}):new Worker(new URL('../worker/detect-worker.ts',import.meta.url),{type:'module'});worker=instance;
  instance.onmessage=(event:MessageEvent<DetectionWorkerToMain>)=>{
    if(worker!==instance)return;const m=event.data;
    if(m.type==='ready'){ready=true;loading=false;backend=m.device;$('backend').textContent=`RT-DETR · ${backend}`;status(source==='file'?'AI sẵn sàng. Đang chuẩn bị phân tích video.':'AI sẵn sàng. Chưa hiệu chuẩn vẫn chỉ khoanh xe.');lastFrame=-1;}
    else if(m.type==='progress')$('backend').textContent=`Tải model ${Math.round(m.progress)}%`;
    else if(m.type==='error'){
      // An unsuccessful GPU/session initialisation may leave the runtime unusable
      // for in-worker fallback. Retry load once in a new, WASM-only worker.
      if(m.stage==='load'&&!cleanWasmRetry&&!$<HTMLInputElement>('wasm').checked){
        startWorker(true);
        status(`Backend mặc định không khởi tạo được. Đang thử WASM trong phiên mới. ${m.message}`);return;
      }
      failFileAnalysis(`AI không tải được: ${m.message} — kiểm tra mạng hoặc thử WASM.`);stopWorker();resetTimeline();
    }
    else if(m.type==='det'){
      const request=pending;if(!request||request.id!==m.capturedAt)return;pending=null;
      const now=performance.now();
      if(request.resolve){request.resolve({timeMs:request.t,boxes:m.boxes,latencyMs:now-request.wall,width:request.w,height:request.h});return;}
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
  instance.onerror=()=>{failFileAnalysis('Worker lỗi: nhận diện đã dừng. Chạy lại hoặc chọn WASM trong Phân tích.');stopWorker();resetTimeline();};
  instance.postMessage({type:'init',engine:'rtdetr',queries:['car','bus','truck'],
    localModels:new URLSearchParams(location.search).get('local-models')==='1',profile:'drive',forceWasm:!useGpu});
}

function sendFrame(){
  if(!ready||pending||!worker||source==='none'||source==='demo'||source==='file'||video.readyState<2||video.seeking)return;
  const t=video.currentTime*1000;if(t===lastFrame)return;
  const [w,h]=size();if(!w||!h)return;
  if(profile&&(profile.width!==w||profile.height!==h)){clearProfile();status('Kích thước camera thay đổi: calibration bị hủy.');}
  if(capture.width!==Math.min(640,w))capture.width=Math.min(640,w);
  const height=Math.max(1,Math.round(capture.width*h/w));if(capture.height!==height)capture.height=height;
  try {
    const wall=performance.now();
    captureCtx.drawImage(video,0,0,capture.width,capture.height);const data=captureCtx.getImageData(0,0,capture.width,capture.height);
    const id=++frameId;pending={id,t,wall,epoch,w,h};lastFrame=t;
    worker.postMessage({type:'frame',rgba:data.data.buffer,width:capture.width,height:capture.height,capturedAt:id},[data.data.buffer]);
  }catch(error){status(`Không đọc được frame: ${String(error)}`);stopWorker();resetTimeline();}
}
function inferReplay(signal:AbortSignal):Promise<ReplaySample>{
  return new Promise((resolve,reject)=>{
    if(!worker||!ready||pending||signal.aborted){reject(Error('AI chưa sẵn sàng hoặc đang bận.'));return;}
    const aborted=()=>reject(new DOMException('Đã hủy phân tích','AbortError'));
    signal.addEventListener('abort',aborted,{once:true});
    const done=(sample:ReplaySample)=>{signal.removeEventListener('abort',aborted);if(!signal.aborted)resolve(sample);};
    const fail=(e:Error)=>{signal.removeEventListener('abort',aborted);reject(e);};
    try{
      const [w,h]=size();if(capture.width!==Math.min(640,w))capture.width=Math.min(640,w);
      const height=Math.max(1,Math.round(capture.width*h/w));if(capture.height!==height)capture.height=height;
      const wall=performance.now();captureCtx.drawImage(video,0,0,capture.width,capture.height);
      const data=captureCtx.getImageData(0,0,capture.width,capture.height),id=++frameId;
      pending={id,t:clock(),wall,epoch,w,h,resolve:done,reject:fail};
      worker.postMessage({type:'frame',rgba:data.data.buffer,width:capture.width,height:capture.height,capturedAt:id},[data.data.buffer]);
    }catch(e){pending=null;fail(e instanceof Error?e:Error(String(e)));}
  });
}
function inferMetricReplay(signal:AbortSignal,boxes:DetBox[]):Promise<{ranges:Array<RangeEstimate|null>;latencyMs:number|null}>{
  if(!metricWorker||!metricReady||!vehicleCandidates(boxes).some(box=>box.score>=VEHICLE_STRONG_SCORE))return Promise.resolve({ranges:boxes.map(()=>null),latencyMs:null});
  const current=metricWorker;
  return new Promise((resolve,reject)=>{
    if(metricPending||signal.aborted){reject(Error('Khoảng cách AI chưa sẵn sàng hoặc đang bận.'));return;}
    const aborted=()=>reject(new DOMException('Đã hủy phân tích','AbortError'));
    signal.addEventListener('abort',aborted,{once:true});
    const done=(value:{ranges:Array<RangeEstimate|null>;latencyMs:number})=>{signal.removeEventListener('abort',aborted);if(!signal.aborted)resolve(value);};
    const fail=(error:Error)=>{signal.removeEventListener('abort',aborted);reject(error);};
    try{
      const [sourceWidth,sourceHeight]=size(),transform=letterboxTransform(sourceWidth,sourceHeight,DA2_DRIVE.width,DA2_DRIVE.height);
      if(metricCapture.width!==DA2_DRIVE.width)metricCapture.width=DA2_DRIVE.width;
      if(metricCapture.height!==DA2_DRIVE.height)metricCapture.height=DA2_DRIVE.height;
      metricCaptureCtx.fillStyle='#000';metricCaptureCtx.fillRect(0,0,metricCapture.width,metricCapture.height);
      metricCaptureCtx.drawImage(video,0,0,sourceWidth,sourceHeight,transform.offsetX,transform.offsetY,transform.contentWidth,transform.contentHeight);
      const rgba=metricCaptureCtx.getImageData(0,0,metricCapture.width,metricCapture.height),id=++metricFrameId;
      metricPending={id,wall:performance.now(),boxes,transform,resolve:done,reject:fail};
      current.postMessage({type:'frame',id,width:metricCapture.width,height:metricCapture.height,rgba:rgba.data.buffer},[rgba.data.buffer]);
    }catch(error){metricPending=null;fail(error instanceof Error?error:Error(String(error)));}
  });
}
async function analyseVideo(){
  if(source!=='file'||analysis||pending||metricPending||!ready||metricLoading||fileJob.phase!=='loading')return;
  autoAnalyse=false;const job=new AbortController();analysis=job;replayReady=false;samples=[];replayFrames=[];
  video.pause();resetTimeline();analysisStarted=performance.now();analysisBackend=backend;analysisMetricBackend=metricReady?metricBackend:'unavailable';
  $<HTMLButtonElement>('analyse').textContent='Hủy phân tích';
  try{
    const times=sampleTimes(video.duration*1000),progress=$<HTMLProgressElement>('analysis-progress');progress.max=times.length;progress.value=0;
    fileJob.start(analysisStarted);
    await runOfflinePipeline(times,job.signal,async target=>{
      const start=performance.now();
      await seekDecoded(video,target,job.signal);
      const seekMs=performance.now()-start,sample=await inferReplay(job.signal);
      sample.seekMs=seekMs;return {sample,start};
    },async({sample,start})=>{
      // inferMetricReplay snapshots RGBA synchronously before this function
      // returns: the next seek/detector can overlap without mixing timestamps.
      try{const metric=await inferMetricReplay(job.signal,sample.boxes);sample.learnedRanges=metric.ranges;sample.metricLatencyMs=metric.latencyMs;sample.metricState=metric.latencyMs===null?'skipped':'success';if(metric.latencyMs!==null)metricLatencies.push(metric.latencyMs);}
      catch(error){if(job.signal.aborted)throw error;sample.learnedRanges=sample.boxes.map(()=>null);sample.metricLatencyMs=null;sample.metricState='failed';stopMetricWorker('Khoảng cách AI không khả dụng');status(`Depth frame lỗi; tiếp tục khoanh xe không có mét. ${error instanceof Error?error.message:String(error)}`);}
      sample.sampleWallMs=performance.now()-start;return sample;
    },sample=>{
      samples.push(sample);progress.value=samples.length;fileJob.advance(samples.length);
      const seconds=Math.round((performance.now()-analysisStarted)/1000),remaining=Math.ceil((times.length-samples.length)*(seconds/Math.max(1,samples.length)));
      $('analysis-status').textContent=`Đang phân tích ${samples.length}/${times.length} frame · ${seconds}s đã chạy · còn khoảng ${remaining}s`;
    });
    if(job.signal.aborted)return;
    analysisElapsedMs=performance.now()-analysisStarted;replayReady=true;refreshReplay();
    await seekDecoded(video,0,job.signal);
    const measured=replayFrames.reduce((sum,frame)=>sum+frame.tracks.filter(track=>track.range.distanceM!==null).length,0),tracked=replayFrames.reduce((sum,frame)=>sum+frame.tracks.length,0),strong=samples.reduce((sum,s)=>sum+vehicleCandidates(s.boxes).filter(box=>box.score>=VEHICLE_STRONG_SCORE).length,0);
    const resultNote=!tracked?'chưa có xe đủ điều kiện hiển thị.':measured||profile?'phát để xem kết quả.':'đã khoanh xe; chưa có mét hợp lệ.';
    fileJob.complete(`${samples.length} khung · ${resultNote}`);
    status(`Đã phân tích ${samples.length} frame · ${strong} detection mạnh · ${tracked} quan sát track. Bấm Phát để xem đồng bộ. ${measured?`${measured} quan sát có mét (chưa nghiệm thu thực địa).`:'Không có phép đo metric hợp lệ; vẫn giữ kết quả khoanh xe.'}`);
  }catch(e){if(!job.signal.aborted){replayReady=false;samples=[];replayFrames=[];const message=`Phân tích chưa hoàn tất: ${e instanceof Error?e.message:String(e)}`;fileJob.fail(message);status(message);}}
  finally{if(analysis===job){analysis=null;$<HTMLButtonElement>('analyse').textContent='Phân tích lại video';}}
}
if('requestVideoFrameCallback' in video){const tick=()=>{sendFrame();video.requestVideoFrameCallback(tick);};video.requestVideoFrameCallback(tick);}

function formatTime(seconds:number){return `${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;}
function riskConfig(){return {speedKph:number('ego-speed'),adverse:$<HTMLInputElement>('adverse').checked};}
function tone(level:'caution'|'critical'){
  if(!alertsEnabled||!audioContext)return;
  const now=performance.now(),wait=level==='critical'?1100:3000;if(now-lastAlertWall<wait)return;lastAlertWall=now;
  const oscillator=audioContext.createOscillator(),gain=audioContext.createGain(),start=audioContext.currentTime;
  oscillator.type='sine';oscillator.frequency.value=level==='critical'?920:620;gain.gain.setValueAtTime(.0001,start);gain.gain.exponentialRampToValueAtTime(.1,start+.015);gain.gain.exponentialRampToValueAtTime(.0001,start+.18);
  oscillator.connect(gain).connect(audioContext.destination);oscillator.start(start);oscillator.stop(start+.2);
}
function captureRiskEvent(risk:RiskSnapshot,timeMs:number){
  const target=risk.primary;if(!target||!['caution','critical'].includes(target.level))return;
  const level=target.level as 'caution'|'critical',key=`${target.track.id}:${level}`,previous=lastRiskEvent.get(key)??-Infinity;
  if(timeMs<previous||timeMs-previous<5000)return;lastRiskEvent.set(key,timeMs);
  riskEvents.push({timeMs,trackId:target.track.id,level,ttcS:target.ttcS,distanceM:target.track.range.distanceM,confidence:target.confidence,reason:target.reason});
  if(riskEvents.length>500)riskEvents.shift();tone(level);
}
function riskColour(level:ThreatLevel){return level==='critical'?'#ef3340':level==='caution'?'#f3bb53':level==='clear'?'#80909a':'#69c0e1';}
function rangeLabel(track:DriveTrack){
  return hudDistance(track.range);
}
function rangeSource(track:DriveTrack|null){
  if(!track||track.range.distanceM===null)return 'Chưa đủ dữ liệu mét';
  return track.range.provenance==='learned-unverified'?'AI metric · chưa kiểm chứng':'Hình học chân xe';
}
function visibleRiskReason(item:RiskTrack|null){
  if(!item)return 'Chờ xe nằm trong hành lang chạy ước lượng.';
  if(!item.inPath)return 'Ngoài hành lang chạy ước lượng';
  const distance=item.track.range.distanceM;
  if(distance===null){
    if(item.ttcAgreement==='conflict')return 'Xu hướng tiến gần chưa đồng thuận · chưa có số mét';
    return item.ttcS===null?'Chưa đủ dữ liệu khoảng cách':'Đang tiến gần · chưa có số mét';
  }
  if(item.referenceDistanceM!==null&&distance<item.referenceDistanceM)return 'Dưới mốc khoảng cách theo tốc độ';
  if(item.ttcAgreement==='conflict')return 'Xu hướng tiến gần chưa đồng thuận';
  if(item.level==='critical'||item.level==='caution')return 'Khoảng cách đang giảm';
  return 'Đang theo dõi khoảng cách';
}
function draw(now:number){
  raf=requestAnimationFrame(draw);
  if(fileJob.metadataExpired(now))failFileAnalysis('Chờ đọc video quá 15 giây. Chọn MP4/H.264 hoặc thử mở lại file.','choose');
  if(loading&&now-loadAt>120000){failFileAnalysis('Tải model quá 120 giây. Kiểm tra mạng hoặc thử WASM.');stopWorker();}
  if(metricLoading&&now-metricLoadAt>120000){stopMetricWorker('Khoảng cách AI timeout');status('Khoảng cách AI tải quá 120 giây; vẫn có thể tiếp tục khoanh xe.');}
  if(pending&&now-pending.wall>15000){failFileAnalysis('Inference quá 15 giây: đã dừng để không hiển thị dữ liệu cũ.');stopWorker();resetTimeline();}
  if(metricPending&&now-metricPending.wall>15000){stopMetricWorker('Khoảng cách AI timeout');status('Depth inference quá 15 giây; tiếp tục khoanh xe và không hiển thị số mét giả.');}
  if(source==='file'&&autoAnalyse&&!analysis&&!pending&&ready&&video.readyState>=2)void analyseVideo();
  if(source==='demo'&&now-lastDemo>100){lastDemo=now;const t=clock(),f=demoFrame(t);tracker.observe(f.boxes,t,now,profile,1280,720);record(t,now,0);}
  else if(source!=='none'&&source!=='demo'&&(!('requestVideoFrameCallback' in video)||video.paused))sendFrame();
  const replay=source==='file'&&replayReady?replayAt(replayFrames,clock()):null;
  latest=source==='file'?(replay?.tracks??[]):tracker.snapshot(clock(),now);
  latestRisk=assessRisk(latest,riskConfig(),replay?'analysed-replay':source==='demo'?'synthetic':'live');const riskById=new Map(latestRisk.tracks.map(item=>[item.track.id,item]));
  const warningText=hudWarning(latestRisk.primary,source!=='none'&&!analysis);
  const warning=$('hud-warning'),warningLabel=$('hud-warning-text');
  if(warningLabel.textContent!==(warningText??''))warningLabel.textContent=warningText??'';
  if(warning.hidden!==(warningText===null))warning.hidden=warningText===null;
  const [iw,ih]=size(),stage=$('stage');
  if(stage.dataset.source!==source)stage.dataset.source=source;
  // The viewport shell and all controls stay fixed; source video and overlay
  // use the same contain transform so letterboxing never misaligns boxes.
  const rect=stage.getBoundingClientRect(),dpr=Math.min(devicePixelRatio,2);
  if(canvas.width!==Math.round(rect.width*dpr)||canvas.height!==Math.round(rect.height*dpr)){canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr);}
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,rect.width,rect.height);
  const scale=Math.min(rect.width/(iw||1280),rect.height/(ih||720)),w=(iw||1280)*scale,h=(ih||720)*scale,left=(rect.width-w)/2,top=(rect.height-h)/2;
  if(source==='demo'){
    ctx.fillStyle='#91b1bf';ctx.fillRect(left,top,w,h*.5);ctx.fillStyle='#52666e';ctx.fillRect(left,top+h*.5,w,h*.5);
    ctx.strokeStyle='#d9d5b5';ctx.lineWidth=2;for(const x of [-.1,.32,.68,1.1]){ctx.beginPath();ctx.moveTo(left+w*.5,top+h*.5);ctx.lineTo(left+w*x,top+h);ctx.stroke();}
    for(const b of demoFrame(clock()).boxes){ctx.fillStyle=b.label==='car'?'#d8e2e7':'#8c9da7';ctx.fillRect(left+b.x0*w,top+b.y0*h,(b.x1-b.x0)*w,(b.y1-b.y0)*h);ctx.fillStyle='#274651';ctx.fillRect(left+(b.x0+.015)*w,top+(b.y0+.02)*h,Math.max(0,(b.x1-b.x0-.03)*w),Math.max(0,(b.y1-b.y0)*h*.35));}
  }
  const occupied:Array<{x:number;y:number;w:number}>=[];
  ctx.save();ctx.beginPath();ctx.rect(left,top,w,h);ctx.clip();
  if($<HTMLDetailsElement>('analysis-panel').open){
  const corridorLevel=latestRisk.primary?.level??'clear',corridorColor=riskColour(corridorLevel),centre=left+w*.5,horizonY=top+h*.42,bottomY=top+h*.98;
  ctx.fillStyle=corridorLevel==='critical'?'rgba(255,90,78,.10)':corridorLevel==='caution'?'rgba(243,187,83,.09)':'rgba(105,192,225,.055)';
  ctx.strokeStyle=corridorColor;ctx.lineWidth=1.5;ctx.setLineDash([8,7]);ctx.beginPath();ctx.moveTo(centre-corridorHalfWidth(.42)*w,horizonY);ctx.lineTo(centre+corridorHalfWidth(.42)*w,horizonY);ctx.lineTo(centre+corridorHalfWidth(.98)*w,bottomY);ctx.lineTo(centre-corridorHalfWidth(.98)*w,bottomY);ctx.closePath();ctx.fill();ctx.stroke();ctx.setLineDash([]);
  }
  for(const a of latest){const b=a.box,x=left+b.x0*w,y=top+b.y0*h,bw=(b.x1-b.x0)*w,bh=(b.y1-b.y0)*h;
    const hazard=riskById.get(a.id);
    const critical=redThreat(hazard),label=rangeLabel(a),emphasized=critical||
      (hazard?.level==='caution'&&highlightThreat(a.id,latestRisk.primary?.track.id??null,'caution'));
    const identityColour=trackColour(a.id),hazardColour=hazard?riskColour(hazard.level):riskColour('monitor');
    const boxColour=critical?riskColour('critical'):identityColour;
    // A translucent rectangle highlights the detected extent, not a fabricated
    // pixel-accurate vehicle segmentation. Never flash the vehicle/video.
    if(critical){ctx.fillStyle='rgba(239,51,64,.17)';ctx.fillRect(x,y,bw,bh);}
    // Missing metric calibration does not mean vehicle detection failed.
    ctx.setLineDash(!replay&&a.ageMs>400?[6,4]:[]);ctx.strokeStyle='#152936';ctx.lineWidth=emphasized?5:3.5;ctx.strokeRect(x,y,bw,bh);
    ctx.strokeStyle=boxColour;ctx.lineWidth=critical?4:emphasized?2.5:1.5;ctx.strokeRect(x,y,bw,bh);ctx.setLineDash([]);
    const fontSize=Math.round(Math.max(16,Math.min(emphasized?28:22,rect.width*(emphasized ? .028 : .023)))),badgeHeight=fontSize+14;
    ctx.font=`600 ${fontSize}px Inter, sans-serif`;
    const tw=Math.min(w-4,ctx.measureText(label).width+20),tx=Math.max(left,Math.min(x,left+w-tw));let ty=Math.max(top,y-badgeHeight-3);
    for(let n=0;n<8&&occupied.some(o=>tx<o.x+o.w&&tx+tw>o.x&&Math.abs(ty-o.y)<badgeHeight+3);n++)ty=Math.max(top,ty-badgeHeight-4);
    occupied.push({x:tx,y:ty,w:tw});if(ty<y-badgeHeight-5){ctx.strokeStyle=boxColour;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(tx+5,ty+badgeHeight);ctx.lineTo(x,y);ctx.stroke();}
    ctx.fillStyle='#152936';ctx.fillRect(tx,ty,tw,badgeHeight);
    if(critical){ctx.strokeStyle=boxColour;ctx.lineWidth=2;ctx.strokeRect(tx,ty,tw,badgeHeight);}
    ctx.fillStyle=critical?'#ff737d':identityColour;ctx.fillText(label,tx+10,ty+fontSize+3,tw-18);
    // Red overrides identity only during high risk; track ID/colour remains
    // unchanged internally and in Analysis, restored as soon as risk subsides.
    if(emphasized){const k=Math.min(22,bw/4,bh/4);ctx.strokeStyle=hazardColour;ctx.lineWidth=5;for(const [sx,sy,dx,dy] of [[x,y,1,1],[x+bw,y,-1,1],[x,y+bh,1,-1],[x+bw,y+bh,-1,-1]] as const){ctx.beginPath();ctx.moveTo(sx+dx*k,sy);ctx.lineTo(sx,sy);ctx.lineTo(sx,sy+dy*k);ctx.stroke();}}
  }ctx.restore();
  if(now-lastTable>200){lastTable=now;
    captureRiskEvent(latestRisk,clock());
    $<HTMLButtonElement>('analyse').disabled=source!=='file'||loading||metricLoading||!!metricPending||(!analysis&&!ready);
    $<HTMLButtonElement>('play').disabled=source!=='file'||!!analysis;
    $<HTMLInputElement>('seek').disabled=source!=='file'||!!analysis;
    if(!analysis)$('analysis-status').textContent=loading||metricLoading?'Đang tải detector và khoảng cách AI — video vẫn ở trên máy.':replayReady?`Đã phân tích ${samples.length} frame · ${Math.round(analysisElapsedMs/1000)}s xử lý · sẵn sàng phát/tua`:source==='file'?'Chưa có bản phân tích. Bật AI hoặc bấm Phân tích lại video.':'Mở video: AI tự phân tích trước, sau đó phát lại kết quả.';
    $('display-mode').textContent=source==='file'?(analysis?'Đang phân tích — không phải phát realtime':replayReady?`Phát lại đã phân tích · ${replay?.interpolated?'nội suy khung':'frame mẫu'} · 5 mẫu/giây`:'Video chưa phân tích'):source==='camera'?'Camera trực tiếp · thử nghiệm':source==='demo'?'Mẫu tổng hợp · không phải AI':'Chưa có nguồn';
    const distances=latest.flatMap(t=>t.range.distanceM===null?[]:[t.range.distanceM]),learned=latest.some(t=>t.range.provenance==='learned-unverified');
    const modeLabel=hudMode({source,loading:loading||metricLoading,analysing:!!analysis,replayReady,hasRange:distances.length>0});
    $('hud-mode').textContent=modeLabel;$('hud-mode').title=modeLabel;
    const jobView=fileJob.view(now),notice=$('job-notice');
    notice.hidden=!jobView.visible||(jobView.phase==='ready'&&!video.paused);
    notice.dataset.phase=jobView.phase;
    for(const [id,text] of [['job-title',jobView.title],['job-detail',jobView.detail],['job-action',jobView.actionLabel]])if($(id).textContent!==text)$(id).textContent=text;
    $<HTMLButtonElement>('job-action').hidden=jobView.action===null;
    const hudProgress=$<HTMLProgressElement>('hud-progress');hudProgress.hidden=jobView.phase!=='running';hudProgress.max=jobView.total||1;hudProgress.value=jobView.completed;
    $('range-status').textContent=distances.length?(learned?`Dọc phía trước: ≈${Math.round(Math.min(...distances))} m theo AI metric. Chưa hiệu chuẩn thực địa; không phải khoảng hở cản xe hay khoảng cách ngang.`:`Dọc phía trước: ≈${Math.round(Math.min(...distances))} m theo hình học chân xe. Không phải khoảng hở cản xe.`):!profile&&number('video-zoom')!==1?'Video zoom/crop: cần profile đúng tiêu cự hiệu dụng; không tự đổi scale của AI.':profile?'Đã nhập profile; chưa có xe đủ điều kiện đo.':metricReady&&source==='file'?'Chưa có mét hợp lệ: xem lý do ROI, xe cắt biên hoặc phối cảnh mâu thuẫn trong danh sách xe.':source==='demo'?'Mẫu tổng hợp có profile giả lập.':'Khoảng cách chưa có; video đã phân tích mới dùng AI metric.';
    $('count').textContent=String(latest.length);$('age').textContent=latest.length?`${Math.round(Math.max(...latest.map(a=>a.ageMs)))} ms`:'—';
    $('method').textContent=learned?'AI metric · chưa kiểm chứng':profile?(source==='demo'?'Hình học · mẫu tổng hợp':'Hình học · ước lượng chân xe'):metricReady?'AI metric · chờ video':'Chưa có phép đo';
    const threat=latestRisk.primary,console=$('risk-console');console.dataset.level=threat?.level??'clear';
    $('risk-target').textContent=threat?`#${threat.track.id} · ${threat.level==='critical'?'NGUY CƠ CAO':threat.level==='caution'?'CẦN CHÚ Ý':'ĐANG THEO DÕI'}`:'Chưa có mục tiêu';
    $('risk-reason').textContent=visibleRiskReason(threat);
    $('risk-distance').textContent=threat?rangeLabel(threat.track):'—';
    $('risk-distance-source').textContent=rangeSource(threat?.track??null);
    $('risk-reference').textContent=latestRisk.referenceDistanceM===null?'—':`${Math.round(latestRisk.referenceDistanceM)} m`;
    $('risk-reference-label').textContent=latestRisk.referenceLabel;
    $('risk-confidence').textContent=threat?`${Math.round(threat.confidence*100)}%`:'—';$('event-count').textContent=String(riskEvents.length);
    $('time').textContent=formatTime(clock()/1000);
    const seek=$<HTMLInputElement>('seek');if(source==='file'&&Number.isFinite(video.duration)&&video.duration>0){seek.max=String(video.duration);seek.value=String(video.currentTime);seek.style.setProperty('--seek-progress',`${Math.min(100,Math.max(0,video.currentTime/video.duration*100))}%`);}
    $('track-list').replaceChildren(...latest.map(a=>{const row=document.createElement('div');row.className='track';row.dataset.state=a.status;row.style.setProperty('--track-colour',trackColour(a.id));
      const label=document.createElement('span');label.textContent=`#${a.id} ${a.box.label==='car'?'Ô tô':a.box.label==='truck'?'Xe tải':'Xe buýt'} · ${a.range.distanceM===null?'Chưa đo khoảng cách':`≈${Math.round(a.range.distanceM)} m dọc phía trước`}`;
      const hazard=riskById.get(a.id),detail=document.createElement('small');detail.textContent=a.range.distanceM===null?a.range.reason:hazard?`${hazard.inPath?'Trong hành lang':'Ngoài hành lang'} · ${rangeSource(a)} · ${visibleRiskReason(hazard)}`:a.range.interval?`${a.range.provenance==='learned-unverified'?'AI chưa hiệu chuẩn':'Dải nhạy sai số'} · ${a.range.interval.map(x=>Math.round(x)).join('–')} m`:a.range.reason;row.dataset.state=hazard?.level??a.status;row.append(label,detail);return row;}));
  }
}

async function jsonFile(input:HTMLInputElement){const file=input.files?.[0];input.value='';if(!file)return null;if(file.size>10*1024*1024)throw Error('JSON vượt 10 MB.');return JSON.parse(await file.text()) as unknown;}
function download(name:string,value:unknown){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function safe(action:()=>void|Promise<void>){return ()=>{Promise.resolve().then(action).catch(e=>status(e instanceof Error?e.message:String(e)));};}

$('demo').onclick=()=>{stopSource();source='demo';sourceName='Synthetic analytical replay';profile=structuredClone(DEMO_PROFILE);demoStart=performance.now();lastDemo=-Infinity;$<HTMLInputElement>('ego-speed').value='80';$('ego-speed-value').textContent='80 km/h';$('empty').hidden=true;$('source-label').textContent='Mẫu toán học · không phải AI';profileToForm(profile);$('profile-status').textContent='Profile synthetic; tự hủy khi đổi sang video/camera.';status('Kiểm tra khoảng cách và policy shadow ở tốc độ giả định 80 km/h. Không dùng mẫu này để công bố chất lượng camera.');};
$<HTMLInputElement>('file').onchange=safe(async()=>{const input=$<HTMLInputElement>('file'),file=input.files?.[0];input.value='';if(!file)return;stopSource();source='file';sourceName=file.name;fileJob.open(performance.now());objectUrl=URL.createObjectURL(file);video.src=objectUrl;video.load();$('source-label').textContent=file.name;$('empty').hidden=true;status('Đang đọc thông tin video. Chưa tải AI cho đến khi kiểm tra thời lượng hợp lệ.');});
$('camera').onclick=safe(async()=>{
  stopSource();const ticket=sourceTicket;status('Đang xin quyền camera sau…');
  const next=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});
  if(ticket!==sourceTicket){next.getTracks().forEach(t=>t.stop());return;}
  stream=next;source='camera';sourceName='Camera local';video.srcObject=stream;
  next.getVideoTracks().forEach(track=>track.addEventListener('ended',()=>{if(stream===next){stopSource();status('Camera đã ngắt; dữ liệu đo đã hủy.');}},{once:true}));
  try{await video.play();}catch(error){if(ticket===sourceTicket)stopSource();throw error;}
  if(ticket!==sourceTicket)return;
  $('empty').hidden=true;$('source-label').textContent='Camera local · không ghi hình';if(!worker)startWorker();status('Camera đã mở. Risk engine theo dõi xu hướng tiến gần; khoảng cách metric live chưa bật nên chưa công bố số mét. Chỉ thử tại bãi có kiểm soát.');
});
$('open-video').onclick=()=>$<HTMLInputElement>('file').click();
$('open-camera').onclick=()=>$('camera').click();
const analysisPanel=$<HTMLDetailsElement>('analysis-panel');
function closeAnalysis(){analysisPanel.open=false;analysisPanel.querySelector('summary')?.focus();}
$('close-analysis').onclick=closeAnalysis;
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&analysisPanel.open)closeAnalysis();});
$('play').onclick=safe(async()=>{if(source!=='file'||analysis)return;if(video.paused)await video.play();else video.pause();});
function syncPlaybackControl(){const state=playbackControl(video.paused,video.ended),button=$('play');button.dataset.playing=String(state.playing);button.setAttribute('aria-label',state.label);button.title=state.label;}
for(const event of ['play','pause','ended','emptied'])video.addEventListener(event,syncPlaybackControl);
syncPlaybackControl();
const fullscreenButton=$<HTMLButtonElement>('fullscreen');
fullscreenButton.disabled=!document.fullscreenEnabled;
if(fullscreenButton.disabled)fullscreenButton.title='Trình duyệt không hỗ trợ toàn màn hình';
fullscreenButton.onclick=safe(async()=>{if(!document.fullscreenEnabled)return;if(document.fullscreenElement===$('stage'))await document.exitFullscreen();else await $('stage').requestFullscreen();});
document.addEventListener('fullscreenchange',()=>{const active=document.fullscreenElement===$('stage'),label=active?'Thoát toàn màn hình':'Toàn màn hình';fullscreenButton.setAttribute('aria-pressed',String(active));fullscreenButton.setAttribute('aria-label',label);fullscreenButton.title=label;});
$('analyse').onclick=()=>{if(source!=='file')return;if(analysis)cancelFileAnalysis();else{video.pause();queueFileAnalysis();}};
$('job-action').onclick=()=>{const action=fileJob.view(performance.now()).action;if(action==='cancel')cancelFileAnalysis();else if(action==='retry')queueFileAnalysis();else if(action==='choose')$<HTMLInputElement>('file').click();else if(action==='play')$('play').click();};
$<HTMLInputElement>('seek').oninput=()=>{if(source==='file')video.currentTime=number('seek');};
video.addEventListener('seeking',()=>{if(analysis||replayReady)return;resetTimeline(true);status('Đã đổi vị trí video; chưa có bản phân tích hoàn chỉnh.');});
video.addEventListener('loadedmetadata',()=>{if(source==='none')return;const [w,h]=size();$<HTMLInputElement>('width').value=String(w);$<HTMLInputElement>('height').value=String(h);lastFrame=-1;if(source==='file'&&fileJob.phase==='reading')queueFileAnalysis();});
video.addEventListener('error',()=>{if(source!=='none'&&video.error){const message='Không giải mã được video. Chọn MP4/H.264 hoặc định dạng trình duyệt hỗ trợ.';stopSource();stopWorker();stopMetricWorker();fileJob.fail(message,'choose');status(message);}});
$('stop').onclick=()=>{stopSource();stopWorker();stopMetricWorker();status('Đã dừng nguồn, camera và nhận diện.');};
$('model').onclick=()=>{if(worker){cancelAnalysis();stopWorker();stopMetricWorker();resetTimeline();status(replayReady?'AI đã dừng; bản phân tích vẫn phát lại được.':'AI đã dừng. Bấm Bật nhận diện xe để thử lại.');}else if(source==='file'&&!replayReady)queueFileAnalysis();else startWorker();};
$<HTMLInputElement>('ego-speed').oninput=()=>{$('ego-speed-value').textContent=`${Math.round(number('ego-speed'))} km/h`;};
$('enable-alerts').onclick=safe(async()=>{if(!alertsEnabled){audioContext??=new AudioContext();await audioContext.resume();alertsEnabled=true;$('alert-status').textContent='Âm thanh bật; cảnh báo được giới hạn tần suất.';}else{alertsEnabled=false;$('alert-status').textContent='Âm thanh tắt. Khi lái thử, không thao tác màn hình.';}const button=$('enable-alerts'),label=alertsEnabled?'Tắt âm cảnh báo':'Bật âm cảnh báo';button.setAttribute('aria-pressed',String(alertsEnabled));button.setAttribute('aria-label',label);button.title=label;});
$<HTMLInputElement>('wasm').onchange=()=>{cancelAnalysis();const active=!!worker||!!metricWorker;stopWorker();stopMetricWorker();if(active){if(source==='file'&&!replayReady)queueFileAnalysis();else startWorker();}resetTimeline();};
$('clear-profile').onclick=clearProfile;
$<HTMLInputElement>('video-zoom').onchange=safe(()=>{
  const zoom=number('video-zoom');if(!Number.isFinite(zoom)||zoom<1||zoom>4){$<HTMLInputElement>('video-zoom').value='1';throw Error('Zoom cần nằm trong 1–4×.');}
  clearProfile();
});
$('fill-focal').onclick=safe(()=>{
  const [w,h]=size();if(!w||!h)throw Error('Mở video trước khi điền tiêu cự.');
  const f=focalFromHorizontalFov(w,number('base-fov'),number('video-zoom'));clearProfile();
  for(const [id,value] of [['fx',f],['fy',f],['cx',w/2],['cy',h/2]] as const)$<HTMLInputElement>(id).value=String(value);
  status('Đã điền intrinsics pinhole/crop giữa từ thông số bạn cung cấp. Nhập chiều cao/góc gá/độ méo thực, xác nhận rồi Áp dụng; chưa tự hiệu chuẩn.');
});
$('calibration').addEventListener('input',event=>{if((event.target as HTMLElement).id!=='confirmed'){importedDraft=null;clearProfile();}});
$('calibration').onsubmit=event=>{event.preventDefault();safe(()=>{if(!$<HTMLInputElement>('confirmed').checked)throw Error('Cần xác nhận calibration đã đo.');const base=importedDraft??{...DEMO_PROFILE,pitchSigmaDeg:.3,heightSigmaM:.03,focalSigmaFraction:.02};
  const p:CameraProfile={...base,name:importedDraft?.name??'Thông số người dùng',width:number('width'),height:number('height'),fx:number('fx'),fy:number('fy'),cx:number('cx'),cy:number('cy'),heightM:number('heightM'),pitchDeg:number('pitchDeg'),rollDeg:number('rollDeg'),maxM:number('maxM'),distortion:$<HTMLInputElement>('distortion').value.split(',').map(Number) as CameraProfile['distortion']};
  applyProfile(parseProfile(p));status('Đã áp dụng: còn giả định đường phẳng và mép box là chân xe.');})();};
$<HTMLInputElement>('profile-file').onchange=safe(async()=>{const ticket=epoch,value=await jsonFile($<HTMLInputElement>('profile-file'));if(value===null)return;if(ticket!==epoch)throw Error('Nguồn đã thay đổi; nhập lại profile.');const p=parseProfile(value);if(source==='none')throw Error('Mở nguồn trước khi nhập profile.');profileToForm(p);clearProfile();importedDraft=p;status('Đã điền profile. Kiểm tra và xác nhận thông số trước khi áp dụng.');});
$('export-profile').onclick=()=>{if(profile)download('drivesense-camera-profile.json',profile);};
$<HTMLInputElement>('ground-file').onchange=safe(async()=>{const ticket=epoch,value=await jsonFile($<HTMLInputElement>('ground-file'));if(value===null)return;if(!profile||ticket!==epoch)throw Error('Cần profile đang áp dụng.');const result=refineMount(profile,value as Parameters<typeof refineMount>[1]);applyProfile(result.profile);profileToForm(result.profile);$('fit-status').textContent=`Holdout ${result.checkCount} điểm: MAE ${result.checkMAE.toFixed(2)} m, max ${result.checkMax.toFixed(2)} m. Không chứng nhận cảnh báo lái xe.`;});
$<HTMLInputElement>('reference-file').onchange=safe(async()=>{const ticket=epoch,value=await jsonFile($<HTMLInputElement>('reference-file'));if(value===null)return;if(ticket!==epoch)throw Error('Timeline đã đổi, hãy nhập lại đối chứng.');references=parseReferences(value);$('reference-status').textContent=`${references.length} mẫu đối chứng người dùng. Không tự xác minh phép đo này.`;});
$('report').onclick=()=>{
  const recorded=source==='file'&&replayReady;
  const values:Observation[]=recorded?replayFrames.flatMap((f,i)=>f.tracks.map(t=>({timeMs:f.timeMs,trackId:t.id,distanceM:t.range.distanceM,latencyMs:samples[i].latencyMs,reason:t.range.reason}))):observations;
  const latencies=recorded?samples.map(s=>s.latencyMs):frameLatencies;
  const rangeLatencies=recorded?samples.flatMap(s=>s.metricLatencyMs===null||s.metricLatencyMs===undefined?[]:[s.metricLatencyMs]):metricLatencies;
  const depthCounts=recorded?{depthAttempts:samples.filter(s=>s.metricState==='success'||s.metricState==='failed').length,depthSuccessfulRequests:rangeLatencies.length,depthSkippedFrames:samples.filter(s=>s.metricState==='skipped').length,depthFailedFrames:samples.filter(s=>s.metricState==='failed').length}:{};
  download('drivesense-report.json',{version:5,createdAt:new Date().toISOString(),source:sourceName,sourceKind:source,session:epoch,synthetic:source==='demo',mode:recorded?'analysed-replay':source==='file'?'unanalysed-video':'live-or-synthetic',distanceKinds:['learned_optical_axis_z_m','ground_contact_forward_m'],distanceDefinition:'Forward Z from camera; NOT bumper clearance, lateral separation or inter-vehicle B-C gap',videoZoom:number('video-zoom'),rangePolicy:LEARNED_RANGE_POLICY,model:source!=='demo'&&backend?{name:'RT-DETRv2 R18',backend:recorded?analysisBackend:backend,gpuArtifact:(recorded?analysisBackend:backend)==='webgpu'?DRIVE_GPU_DETECTOR:null,decoder:DRIVE_DECODER,candidatePolicy:DRIVE_CANDIDATE_POLICY}:null,rangeModel:recorded?{...DA2_DRIVE,backend:analysisMetricBackend||'unavailable',validation:'learned-unverified'}:null,profile,risk:{config:riskConfig(),policy:'shadow-risk-v1',events:riskEvents,latest:latestRisk},summary:evaluate(values,references),frameTiming:{count:latencies.length,detectorRequestP95Ms:percentile(latencies,.95),metricInferenceP95Ms:percentile(rangeLatencies,.95),seekP95Ms:recorded?percentile(samples.flatMap(s=>s.seekMs===undefined?[]:[s.seekMs]),.95):null,...depthCounts,droppedResults,analysisElapsedMs:recorded?analysisElapsedMs:null,analysedFramesPerSecond:recorded&&analysisElapsedMs>0?samples.length/(analysisElapsedMs/1000):null,mediaToProcessingRatio:recorded&&analysisElapsedMs>0?video.duration*1000/analysisElapsedMs:null,scope:'Bounded offline detector/depth overlap with same-frame snapshots; 5Hz sampled replay, NOT realtime sensor-to-display latency.'},observations:values,references,samples:recorded?samples:[],limits:'PoC desktop shadow-mode. Absolute metres/zoom/near-side/far-vehicle accuracy remain ground-truth unvalidated; not for braking/steering.'});
};
document.addEventListener('visibilitychange',()=>{if(document.hidden&&!analysis){video.pause();if(!replayReady)resetTimeline();}});
window.addEventListener('pagehide',()=>{cancelAnimationFrame(raf);stopSource();stopWorker();stopMetricWorker();});
raf=requestAnimationFrame(draw);
