import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/noto-serif/400.css';
import './drive.css';
import { parseProfile, refineMount, type CameraProfile } from './geometry';
import { VehicleTracker, type DriveTrack } from './tracking';
import { evaluate, parseReferences, percentile, type Observation, type ReferenceSample } from './benchmark';
import { DEMO_PROFILE, demoFrame } from './demo';
import type { DetBox } from '../detection-types';
import {buildReplay,replayAt,REPLAY_STEP_MS,seekDecoded,type ReplaySample,type ReplayFrame} from './replay';
import {DRIVE_DECODER} from './detector-decode';
import {DRIVE_CANDIDATE_POLICY,vehicleCandidates,VEHICLE_STRONG_SCORE} from './vehicle-candidates';
import {DA2_DRIVE,DA2_DRIVE_PORTRAIT,selectDa2DriveContract,type Da2DriveContract,type MetricMap} from './metric-contract';
import {estimateLearnedVehicleRange,probeLearnedVehicleRange,letterboxTransform,LEARNED_RANGE_POLICY,validateLearnedRanges,validatePublishedLearnedTracks,type LetterboxTransform} from './learned-range';
import type {RangeEstimate} from './geometry';
import {assessRisk,corridorHalfWidth,type RiskSnapshot,type RiskTrack,type ThreatLevel} from './risk';
import {trackColour} from './track-identity';
import {hudDistance,hudMode,highlightThreat,hudWarning,redThreat,playbackControl} from './hud';
import {FileAnalysisJob} from './analysis-job';
import {runOfflinePipeline} from './offline-pipeline';
import {focalFromHorizontalFov} from './camera-intrinsics';
import {DRIVE_GPU_DETECTOR,DRIVE_WASM_DETECTOR} from './detector-contract';
import {LiveTelemetry} from './live-telemetry';
import {evaluateLiveEvidence} from './live-evidence';
import {cameraChoices,cameraConstraints} from './camera-source';
import {offlinePlan,type OfflinePreset} from './offline-plan';
import {RoadUI} from './road-ui';
import {exportCurrentDriveCandidate} from './evidence-plane';
import {liveMetricIntervalMs,liveMetricPlan,liveMetricAlignmentWaitMs} from './live-scheduler';
import type {MetricObjectDiagnostic,MetricCaptureDiagnostic} from './metric-diagnostics';
import {MobileSoakTelemetry,safeCameraSettings,type PresentedFrameMetadata} from './mobile-soak';
import {LiveMetricJoin,LIVE_METRIC_MAX_AGE_MS,LIVE_BOX_MAX_AGE_MS} from './live-metric-join';
import {DiagnosticLedger,type DiagnosticSource,type SkipReason} from './diagnostic-ledger';
import {SessionJournal,JOURNAL_LIMITS,type SessionManifest,type DiagnosticPayload} from './session-journal';
import {MetricLifecycle,type MetricFault} from './metric-lifecycle';
import {SourceLifecycle} from './source-lifecycle';
import {ScreenAwake} from './screen-awake';
import {DRIVE_REPORT_VERSION} from './report-contract';
import {DRIVE_LITE_DETECTOR,chooseDriveDetector,type DriveDetectorChoice,type DriveWorkerMessage} from './lite-detector';
import {MobileBudget} from './mobile-budget';
import {estimateAnchorRange,type AnchorProfile} from './anchor-range';
import {AnchorUI} from './anchor-ui';
import {MeterCoverage} from './meter-coverage';

// A release service worker previously installed on localhost must never make the
// development session look stale after a code change.
if(import.meta.env.DEV&&'serviceWorker' in navigator)void navigator.serviceWorker.getRegistrations().then(registrations=>Promise.all(registrations.map(registration=>registration.unregister())));

const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const video=$<HTMLVideoElement>('video'),canvas=$<HTMLCanvasElement>('overlay'),ctx=canvas.getContext('2d')!;
const road=new RoadUI(video,$('road-chip'),$('road-detail'),$<HTMLButtonElement>('road-retry'));
const capture=document.createElement('canvas'),captureCtx=capture.getContext('2d',{willReadFrequently:true})!;
const metricCapture=document.createElement('canvas'),metricCaptureCtx=metricCapture.getContext('2d',{willReadFrequently:true})!;
let source:'none'|'file'|'camera'|'demo'|'fixture'='none',sourceName='',stream:MediaStream|null=null,objectUrl:string|null=null;
function isLiveSource(){return source==='camera'||source==='fixture';}
let profile:CameraProfile|null=null,tracker=new VehicleTracker(),epoch=0,sourceTicket=0,frameId=0,raf=0;
let anchorProfile:AnchorProfile|null=null,activeDetector:'lite'|'rtdetr'='rtdetr',metricBudgetBlocked=false,autoDepthProbeStarted=false;
const mobileBudget=new MobileBudget(),joinedBudget=new MobileBudget('joined'),meterCoverage=new MeterCoverage();
const anchorUI=new AnchorUI(video,()=>{const [width,height]=size();return {width,height,zoom:number('video-zoom'),ticket:sourceTicket,available:source!=='none'&&source!=='demo'&&video.readyState>=2&&!analysis};},p=>applyAnchors(p));
function detectorChoice(){const v=$<HTMLSelectElement>('drive-detector').value;if(!['auto','lite','rtdetr'].includes(v))throw Error('Detector choice invalid');return v as DriveDetectorChoice;}
function wantsDepth(){
  const path=$<HTMLSelectElement>('range-path').value;
  if(profile||anchorProfile||path==='anchors')return false;
  // A weak CPU phone gets a real geometry route, not a 100 MB depth load
  // which cannot meet freshness. Explicit AI mode retains the A/B baseline.
  return path==='ai'||activeDetector!=='lite'||(ready&&backend==='webgpu'&&!metricBudgetBlocked&&(source==='file'||mobileBudget.report().state==='within-budget'));
}
function applyAnchors(p:AnchorProfile|null){anchorProfile=p;if(p)profile=null;resetTimeline();
  if(p){stopMetricWorker('Mét theo mốc · không chạy depth AI');$('profile-status').textContent='Đang dùng mốc đã kiểm; profile intrinsics không bị trộn với AI.';}
  else if(rangeEnabled&&worker&&wantsDepth())startMetricWorker();refreshReplay();}
interface MetricSnapshot {rgba:ArrayBuffer;transform:LetterboxTransform;diagnostics:MetricCaptureDiagnostic}
interface PendingFrame {id:number;t:number;wall:number;epoch:number;w:number;h:number;resolve?:(s:ReplaySample)=>void;reject?:(e:Error)=>void}
let worker:Worker|null=null,ready=false,loading=false,backend='',pending:PendingFrame|null=null;
interface PendingMetric {id:number;wall:number;boxes:DetBox[];transform:LetterboxTransform;resolve?:(value:{ranges:Array<RangeEstimate|null>;latencyMs:number})=>void;reject?:(error:Error)=>void;live?:{epoch:number;t:number;w:number;h:number;detectorId:number}}
type MetricWorkerMessage=({type:'status';message:string}|{type:'ready';backend:'webgpu'|'wasm';warmupMs:number;model?:Da2DriveContract;artifactSource?:'same-origin'|'release'}|{type:'result';id:number;map:MetricMap;latencyMs:number}|{type:'error';id?:number;stage:'load'|'infer';message:string})&{channel:'drive-range-v1'};
let metricWorker:Worker|null=null,metricReady=false,metricLoading=false,metricBackend='',metricPending:PendingMetric|null=null,metricFrameId=0,metricLoadAt=0;
let metricModel:Da2DriveContract=DA2_DRIVE,metricArtifactSource:string|null=null;
function sourceMetricContract(){const [decodedW,decodedH]=size(),settings=stream?.getVideoTracks()[0]?.getSettings();
  const w=decodedW||settings?.width,h=decodedH||settings?.height;return w&&h?selectDa2DriveContract(w,h):DA2_DRIVE;}
let observations:Observation[]=[],references:ReferenceSample[]=[],latest:DriveTrack[]=[];
let importedDraft:CameraProfile|null=null,frameLatencies:number[]=[],droppedResults=0;
let demoStart=0,lastDemo=-Infinity,lastFrame=-1,lastTable=0,loadAt=0;
let analysis:AbortController|null=null,autoAnalyse=false,replayReady=false,samples:ReplaySample[]=[],replayFrames:ReplayFrame[]=[];
const initialRoadOnly=import.meta.env.DEV&&new URLSearchParams(location.search).get('lanes')==='1';
let rangeEnabled=!initialRoadOnly;
let analysisStarted=0,analysisElapsedMs=0;
const fileJob=new FileAnalysisJob();
let analysisBackend='';
let analysisMetricBackend='',metricLatencies:number[]=[];
let currentFile:File|null=null,activeOfflinePlan:ReturnType<typeof offlinePlan>|null=null,analysisCacheHit=false;
const sessionAnalysisCache=new WeakMap<File,Map<string,ReplaySample[]>>();
let lastLiveMetricCapture=-Infinity,liveMetricAttempts=0,liveMetricAccepted=0,liveMetricDropped=0;
let joinedLatencies:number[]=[];
let metricAlignmentHoldAt:number|null=null;
const liveMetricJoin=new LiveMetricJoin();
let liveMetricReason='Đang chờ phép đo cùng frame.',liveMetricReasonCode='waiting',detectorError='',metricError='';
let liveMetricRejections:Record<string,number>={};
interface HazardEvent {timeMs:number;trackId:number;level:'caution'|'critical';ttcS:number|null;distanceM:number|null;confidence:number;reason:string}
let riskEvents:HazardEvent[]=[],lastRiskEvent=new Map<string,number>(),latestRisk:RiskSnapshot=assessRisk([],{speedKph:0,adverse:false});
let alertsEnabled=false,audioContext:AudioContext|null=null,lastAlertWall=-Infinity;
const liveTelemetry=new LiveTelemetry(5000),mobileSoak=new MobileSoakTelemetry();let liveTraceId:number|null=null;
const journal=new SessionJournal();
let diagnosticLedger=new DiagnosticLedger(),manifest:SessionManifest|null=null,diagnosticStartedAt=0;
let diagnosticState:'active'|'ended'='active';
const metricLifecycle=new MetricLifecycle();
const sourceLifecycle=new SourceLifecycle();
const screenAwake=new ScreenAwake('wakeLock' in navigator?()=>navigator.wakeLock.request('screen'):null);
let metricRetryTimer:ReturnType<typeof setTimeout>|null=null;
// Baseline fault reproduction is opt-in on localhost only, never a release override.
const automaticMetricRecovery=!(import.meta.env.DEV&&new URLSearchParams(location.search).get('depth-recovery')==='0');
let fixtureIdentity:SessionManifest['fixture'];
function beginDiagnostics(kind:DiagnosticSource,settings:unknown){
  diagnosticLedger=new DiagnosticLedger();diagnosticStartedAt=performance.now();diagnosticState='active';
  manifest={sessionId:crypto.randomUUID(),source:kind,
    execution:import.meta.env.DEV&&(window as Window&{__DRIVESENSE_TEST_WORKERS__?:boolean}).__DRIVESENSE_TEST_WORKERS__===true?'mock-workers':'actual-workers',
    startedUtc:new Date().toISOString(),timeOrigin:performance.timeOrigin,
    build:{version:__ROBOEYE_VERSION__,commit:__ROBOEYE_COMMIT__,sourceFingerprint:__ROBOEYE_SOURCE_FINGERPRINT__},
    userAgent:navigator.userAgent.slice(0,512),capabilities:{webgpuPresent:'gpu' in navigator,crossOriginIsolated,videoFrameCallback:'requestVideoFrameCallback' in video},
    models:{detectorGpuSha256:DRIVE_GPU_DETECTOR.sha256,detectorWasmSha256:DRIVE_WASM_DETECTOR.sha256,metricSha256:sourceMetricContract().sha256,
      metricLandscapeSha256:DA2_DRIVE.sha256,metricPortraitSha256:DA2_DRIVE_PORTRAIT.sha256,detectorLiteSha256:DRIVE_LITE_DETECTOR.sha256},
    metricMaxAgeMs:LIVE_METRIC_MAX_AGE_MS,wasmThreads:1,
    policies:{range:LEARNED_RANGE_POLICY,detector:JSON.stringify(DRIVE_CANDIDATE_POLICY),metricAdapter:'source-aspect-static-support-v2',
      processorRevision:DRIVE_WASM_DETECTOR.revision,processorSha256:'cd38cd59999e7a95d68e487fbe5132df3d4e5c32a0836add57e6126ba0c4eaf1'},
    ...(kind==='fixture-live-replay'&&fixtureIdentity?{fixture:fixtureIdentity}:{})};
  liveTelemetry.provenance=kind;
  mobileSoak.cameraOpened(epoch,diagnosticStartedAt,settings,kind==='live-camera'?'live-camera-runtime':kind);
  if(worker&&ready)mobileSoak.modelObserved('detector',backend);else if(worker&&loading)mobileSoak.modelLoadStarted('detector','preloaded-before-session',performance.now());
  if(metricWorker&&metricReady)mobileSoak.modelObserved('metric-depth',metricBackend);else if(metricWorker&&metricLoading)mobileSoak.modelLoadStarted('metric-depth','preloaded-before-session',performance.now());
}
function diagnosticPayload():DiagnosticPayload|null{
  if(!manifest)return null;
  return {manifest,status:diagnosticState,epoch,elapsedMs:Math.max(0,performance.now()-diagnosticStartedAt),
    ledger:diagnosticLedger.report(),mobileSoak:mobileSoak.report(performance.now()),
    backends:{detector:ready?backend:null,metric:metricReady?metricBackend:null},metricLifecycle:metricLifecycle.report(),
    sourceLifecycle:{...sourceLifecycle.report(),screenAwake:screenAwake.report()},
    mobileRanging:{detector:activeDetector,budget:mobileBudget.report(),joinedBudget:joinedBudget.report(),path:anchorProfile?'ground-anchors':profile?'camera-profile':wantsDepth()?'metric-ai':'calibration-needed',anchorProfile,metres:meterCoverage.report()}};
}
async function refreshSavedSessions(){
  try{
    const select=$<HTMLSelectElement>('saved-session'),previous=select.value,records=await journal.list();
    select.replaceChildren(...records.map(r=>{const option=document.createElement('option');option.value=r.sessionId;
      option.textContent=`${r.payload?.manifest?.startedUtc??r.updatedUtc} · ${r.payload?.manifest?.source??'schema cũ'} · #${r.sequence}`;return option;}));
    if(records.some(r=>r.sessionId===previous))select.value=previous;
    $<HTMLButtonElement>('saved-export').disabled=!records.length;
    $('journal-status').textContent=journal.health.state==='error'?`Không lưu được: ${journal.health.error}. AI vẫn tiếp tục.`:
      journal.health.savedUtc?`Đã lưu checkpoint · ${journal.health.savedUtc} · ${records.length} phiên local.`:`${records.length} phiên local. Camera/test realtime sẽ tự lưu.`;
  }catch(error){$('journal-status').textContent=`Storage local không khả dụng: ${error instanceof Error?error.message:String(error)}. AI vẫn tiếp tục.`;}
}
function checkpointDiagnostics(){const payload=diagnosticPayload();if(payload)void journal.checkpoint(payload).then(refreshSavedSessions);}
function endDiagnostics(){
  if(!manifest)return;const now=performance.now();diagnosticState='ended';diagnosticLedger.reset(now);mobileSoak.cameraEnded(now);
  checkpointDiagnostics();manifest=null;
}
setInterval(checkpointDiagnostics,JOURNAL_LIMITS.checkpointMs);
void refreshSavedSessions();
const status=(s:string)=>{$('status').textContent=s;};
function syncFeatureToggles(){
  const range=$<HTMLButtonElement>('range-toggle'),lane=$<HTMLButtonElement>('road-toggle');
  const rangeState=!rangeEnabled?'off':loading||metricLoading||!!analysis||autoAnalyse?'loading':replayReady||ready||source==='demo'?'ready':'standby';
  range.setAttribute('aria-pressed',String(rangeEnabled));range.dataset.state=rangeState;
  range.setAttribute('aria-label',rangeEnabled?'Tắt nhận diện và đo khoảng cách':'Bật nhận diện và đo khoảng cách');
  range.title=rangeEnabled?(rangeState==='loading'?'Khoảng cách · đang tải hoặc phân tích':'Khoảng cách · đang bật'):'Khoảng cách · đang tắt';
  lane.dataset.state=road.enabled?$('road-chip').dataset.state??'loading':'off';
  $('model').textContent=rangeEnabled?'Tắt nhận diện xe':'Bật nhận diện xe';
}
const number=(id:string)=>Number($<HTMLInputElement>(id).value);
function size():[number,number]{return source==='demo'?[1280,720]:[video.videoWidth,video.videoHeight];}
function clock(){return source==='demo'?performance.now()-demoStart:video.currentTime*1000;}
function resetTimeline(clearReferences=true){if(metricRetryTimer!==null)cancelMetricRetry();diagnosticLedger.reset(performance.now());meterCoverage.reset();epoch++;liveMetricJoin.reset();liveMetricRejections={};liveMetricReason='Đang chờ phép đo cùng frame.';liveTelemetry.reset(epoch);mobileSoak.timelineReset(epoch);liveTraceId=null;lastLiveMetricCapture=-Infinity;liveMetricAttempts=0;liveMetricAccepted=0;liveMetricDropped=0;joinedLatencies=[];metricAlignmentHoldAt=null;tracker=new VehicleTracker();observations=[];latest=[];latestRisk=assessRisk([],{speedKph:0,adverse:false});riskEvents=[];lastRiskEvent.clear();lastFrame=-1;frameLatencies=[];metricLatencies=[];droppedResults=0;$('event-count').textContent='0';if(clearReferences){references=[];$('reference-status').textContent='Chưa có đối chứng cho phiên này.';}}
function refreshReplay(){if(replayReady){const p=anchorProfile,inputs=p?samples.map(s=>({...s,learnedRanges:s.boxes.map(b=>estimateAnchorRange(b,p,s.width,s.height,number('video-zoom')))})):samples;replayFrames=buildReplay(inputs,profile?{...profile,pixelSigma:Math.max(profile.pixelSigma,3*profile.width/640)}:null,number('video-zoom'));}}
function cancelAnalysis(){autoAnalyse=false;analysis?.abort();analysis=null;fileJob.cancel();$<HTMLButtonElement>('analyse').textContent='Phân tích lại video';}
function zoomDescription(){const zoom=number('video-zoom');return zoom===1?'1×: AI chưa kiểm chứng; xe cắt biên, quá nhỏ hoặc phối cảnh mâu thuẫn sẽ không hiện số đo.':`${zoom}×: AI không biết tiêu cự; nhập profile đúng lens/crop để có mét hình học. Không chia/nhân số AI theo zoom.`;}
function clearProfile(){profile=null;anchorProfile=null;anchorUI.invalidate();if(source==='none')autoDepthProbeStarted=false;$('profile-status').textContent='Chưa có profile/mốc; số AI chỉ là ước lượng chưa kiểm chứng.';$('zoom-status').textContent=zoomDescription();$<HTMLButtonElement>('export-profile').disabled=true;$<HTMLInputElement>('confirmed').checked=false;resetTimeline();refreshReplay();}
function stopSource(){sourceLifecycle.stop();screenAwake.setActive(false);cancelMetricRetry();endDiagnostics();stopMetricWorker();mobileBudget.reset();joinedBudget.reset();metricBudgetBlocked=false;road.stop();cancelAnalysis();fileJob.reset();replayReady=false;samples=[];replayFrames=[];analysisElapsedMs=0;currentFile=null;activeOfflinePlan=null;analysisCacheHit=false;$<HTMLProgressElement>('analysis-progress').value=0;sourceTicket++;source='none';sourceName='';importedDraft=null;video.pause();stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;video.removeAttribute('src');video.load();if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=null;$<HTMLInputElement>('video-zoom').value='1';clearProfile();resetTimeline(true);for(const key of ['fx','fy','cx','cy','heightM','pitchDeg','base-fov'])$<HTMLInputElement>(key).value='';$('empty').hidden=false;$('source-label').textContent='Chưa chọn nguồn';$<HTMLButtonElement>('play').disabled=true;$<HTMLInputElement>('seek').disabled=true;}
function suspendLiveSource(reason:'hidden'|'muted'){
  sourceLifecycle.suspend(reason,!video.paused);screenAwake.setActive(false);cancelMetricRetry();video.pause();resetTimeline(false);checkpointDiagnostics();
}
async function resumeLiveSource(manual=false){
  const ticket=sourceTicket;
  if(!isLiveSource()||!sourceLifecycle.requestResume(ticket,manual))return;
  try{
    await video.play();
    if(ticket!==sourceTicket)return;
    if(video.paused)throw Error('Playback interrupted before resume completed');
    sourceLifecycle.resumed(ticket);
    if(document.hidden||stream?.getVideoTracks().some(track=>track.muted)){
      suspendLiveSource(document.hidden?'hidden':'muted');return;
    }
    sourceLifecycle.playing(ticket);screenAwake.setActive(true);
    if(!manifest&&source==='camera')beginDiagnostics('live-camera',safeCameraSettings(stream?.getVideoTracks()[0]?.getSettings()));
    if(rangeEnabled){if(!worker)startWorker();else if(ready&&!metricWorker)startMetricWorker();}
  }catch{
    if(ticket!==sourceTicket)return;
    sourceLifecycle.playFailed(ticket);screenAwake.setActive(false);resetTimeline(false);
    if(!manifest&&source==='camera')beginDiagnostics('live-camera',safeCameraSettings(stream?.getVideoTracks()[0]?.getSettings()));
    status('Camera tạm dừng. Bấm Tiếp tục camera ngay trên video để chạy lại.');checkpointDiagnostics();
  }
}
function stopWorker(){if(pending&&!pending.resolve)diagnosticLedger.finish('detector',pending.id,'wrong-generation',performance.now());pending?.reject?.(Error('Nhận diện đã dừng.'));worker?.terminate();worker=null;ready=false;loading=false;pending=null;$('backend').textContent='AI chưa tải';$('model').textContent='Bật nhận diện xe';}
function cancelMetricRetry(){if(metricRetryTimer!==null){clearTimeout(metricRetryTimer);metricRetryTimer=null;}metricLifecycle.cancel(performance.now());}
function stopMetricWorker(message='Khoảng cách AI chưa tải'){cancelMetricRetry();if(metricPending?.live)diagnosticLedger.finish('metric',metricPending.live.detectorId,'wrong-generation',performance.now());liveMetricJoin.reset();metricPending?.reject?.(Error('Metric AI đã dừng.'));metricWorker?.terminate();metricWorker=null;metricReady=false;metricLoading=false;metricPending=null;metricBackend='';$('metric-backend').textContent=message;}
function recoverMetricWorker(fault:MetricFault,message:string,forceWasm=false){
  const now=performance.now();diagnosticLedger.fail('metric',now);
  if(metricPending?.live&&liveMetricJoin.busy){rejectLiveMetric('worker-error','Depth lỗi; chưa công bố số đo.');mobileSoak.metricOutcome(metricPending.wall,false);}
  metricPending?.reject?.(Error(message));metricPending=null;metricError=message;stopMetricWorker('Khoảng cách AI không khả dụng');
  const retry=metricLifecycle.recover(now,fault,automaticMetricRecovery&&isLiveSource()&&rangeEnabled&&!document.hidden);
  checkpointDiagnostics();
  if(!retry){status('Depth đã dừng theo giới hạn phục hồi; detector vẫn chạy. Có thể Thử lại AI trong Phân tích.');return;}
  const ticket=sourceTicket;
  $('metric-backend').textContent=`Đang phục hồi depth · ${retry.delayMs/1000}s`;
  status('Depth gặp lỗi; đang khởi tạo worker mới có giới hạn. Không giữ mét cũ.');
  metricRetryTimer=setTimeout(()=>{
    metricRetryTimer=null;
    if(ticket!==sourceTicket||!metricLifecycle.canRestart(retry.generation)||!isLiveSource()||!rangeEnabled||document.hidden)return;
    startMetricWorker(forceWasm);
  },retry.delayMs);
}
function failFileAnalysis(message:string,action:'retry'|'choose'='retry'){
  if(source==='file'){cancelAnalysis();stopWorker();stopMetricWorker();replayReady=false;samples=[];replayFrames=[];fileJob.fail(message,action);}
  status(message);
}
function queueFileAnalysis(){
  if(source!=='file'||analysis)return;
  rangeEnabled=true;syncFeatureToggles();
  try{
    // Metadata preflight precedes any AI initialisation, including retry paths.
    activeOfflinePlan=offlinePlan(video.duration*1000,selectedOfflinePreset());analysisCacheHit=false;
    const times=fileJob.prepare(video.duration*1000,activeOfflinePlan.stepMs),progress=$<HTMLProgressElement>('analysis-progress');
    progress.max=times.length;progress.value=0;autoAnalyse=true;
    const cached=cachedAnalysis();
    if(!cached){if(!worker)startWorker();else if(!metricWorker||sourceMetricContract().sha256!==metricModel.sha256)startMetricWorker();}
    status(cached?`Đã tìm thấy cache chính xác của phiên này · ${times.length} khung. Đang dựng lại replay.`:`Video hợp lệ · ${times.length} khung · ${activeOfflinePlan.disclosure} Đang chuẩn bị AI.`);
  }catch(e){failFileAnalysis(e instanceof Error?e.message:String(e),'choose');}
}
function cancelFileAnalysis(){
  cancelAnalysis();stopWorker();stopMetricWorker();replayReady=false;samples=[];replayFrames=[];resetTimeline();
  status('Đã hủy phân tích; chưa có kết quả hoàn chỉnh. Bấm Chạy lại để thử lại.');
}
function profileToForm(p:CameraProfile){for(const key of ['width','height','fx','fy','cx','cy','heightM','pitchDeg','rollDeg','maxM'] as const)$<HTMLInputElement>(key).value=String(p[key]);$<HTMLInputElement>('distortion').value=p.distortion.join(',');}
function applyProfile(p:CameraProfile){const [w,h]=size();if(!w||w!==p.width||h!==p.height)throw Error('Profile phải đúng kích thước nguồn đã mở.');profile=parseProfile(p);anchorProfile=null;anchorUI.invalidate();stopMetricWorker('Mét theo profile hình học');resetTimeline();refreshReplay();$('profile-status').textContent=`${p.name}: ${w}×${h}. Thông số người dùng cung cấp; chưa nghiệm thu thực địa.`;$<HTMLButtonElement>('export-profile').disabled=false;}
function publishedSnapshot(t:number,wall:number,paused=false){return validatePublishedLearnedTracks(tracker.snapshot(t,wall,paused),number('video-zoom'),size()[1]||720);}
function record(t:number,wall:number,latency:number,paused=false){latest=publishedSnapshot(t,wall,paused);if(isLiveSource())meterCoverage.measurement(wall,latest);for(const a of latest)observations.push({timeMs:t,trackId:a.id,distanceM:a.range.distanceM,latencyMs:latency,reason:a.range.reason});if(observations.length>20000)observations.splice(0,observations.length-20000);}
function selectedOfflinePreset():OfflinePreset {const value=$<HTMLSelectElement>('analysis-preset').value;if(!['quality','balanced','fast'].includes(value))throw Error('Chế độ phân tích không hợp lệ.');return value as OfflinePreset;}
function analysisCacheKey(){return `${activeOfflinePlan?.preset??selectedOfflinePreset()}:${detectorChoice()}:${$<HTMLSelectElement>('range-path').value}:${$<HTMLInputElement>('wasm').checked?'wasm':'auto'}:${DRIVE_GPU_DETECTOR.sha256}:${sourceMetricContract().sha256}:${LEARNED_RANGE_POLICY}`;}
function cachedAnalysis(){return currentFile?sessionAnalysisCache.get(currentFile)?.get(analysisCacheKey())??null:null;}
function storeCachedAnalysis(){if(!currentFile)return;let entries=sessionAnalysisCache.get(currentFile);if(!entries){entries=new Map();sessionAnalysisCache.set(currentFile,entries);}entries.set(analysisCacheKey(),structuredClone(samples));}

function rejectLiveMetric(reason:string,detail:string){liveMetricDropped++;liveMetricRejections[reason]=(liveMetricRejections[reason]??0)+1;liveMetricReason=detail;liveMetricReasonCode=reason;}
function flushLiveMetric(){
  const now=performance.now(),[w,h]=size(),joined=liveMetricJoin.take(now,epoch,w,h);if(!joined)return;
  joinedBudget.observe(now-(joined.reason==='ready'?joined.value.wall:joined.wall));
  if(activeDetector==='lite'&&$<HTMLSelectElement>('range-path').value==='auto'&&joinedBudget.report().state==='too-slow'){metricBudgetBlocked=true;stopMetricWorker('AI vượt ngân sách · dùng mốc đã kiểm');return;}
  joinedLatencies.push(now-(joined.reason==='ready'?joined.value.wall:joined.wall));if(joinedLatencies.length>24)joinedLatencies.shift();
  if(joined.reason!=='ready'){diagnosticLedger.finish('metric',joined.id,joined.reason==='stale'?'stale':'wrong-generation',now);rejectLiveMetric(joined.reason,joined.reason==='stale'?'Depth hoặc detector quá chậm (>1,2 giây từ lúc chụp); không công bố mét cũ.':'Nguồn hình đã đổi; bỏ phép đo cũ.');mobileSoak.metricOutcome(joined.wall,false);return;}
  const frame=joined.value;
  diagnosticLedger.stage('metric',frame.id,'join',now);
  try{
    const probes=frame.boxes.map(box=>probeLearnedVehicleRange(frame.map,box,frame.transform)),raw=probes.map(probe=>probe.range);
    const ranges=validateLearnedRanges(frame.boxes,raw,number('video-zoom'),frame.h);
    const candidates=new Set(vehicleCandidates(frame.boxes));
    const objects:MetricObjectDiagnostic[]=frame.boxes.map((box,index)=>({index,trackId:frame.trackIds[index],label:box.label.slice(0,40),score:box.score,
      box:[box.x0,box.y0,box.x1,box.y1],probe:probes[index].evidence,rawM:raw[index].distanceM,policyM:ranges[index]?.distanceM??null,filteredM:null,publishedM:null,
      terminalStage:raw[index].distanceM===null?'roi':ranges[index]?.distanceM===null?'policy':'binding',
      code:!candidates.has(box)||box.score<VEHICLE_STRONG_SCORE?'not-candidate':ranges[index]?.reasonCode??'binding-mismatch'}));
    for(const object of objects)if(object.policyM!==null&&object.code==='accepted')object.code='binding-mismatch';
    diagnosticLedger.stage('metric',frame.id,'roi',performance.now());
    diagnosticLedger.stage('metric',frame.id,'policy',performance.now());
    const applied=tracker.enrichLearnedRanges(frame.boxes,ranges,frame.t,frame.w,frame.h,now,{trackIds:frame.trackIds,capturedWall:frame.wall},(index,code,filteredM)=>{
      const object=objects[index];object.code=code;object.filteredM=filteredM;
      object.terminalStage=code.startsWith('temporal-')?'filter':filteredM===null?'binding':'publication';
    });
    diagnosticLedger.stage('metric',frame.id,'binding',performance.now());
    diagnosticLedger.stage('metric',frame.id,'filter',performance.now());
    if(applied){latest=publishedSnapshot(clock(),now);
      for(const object of objects)if(object.filteredM!==null){
        const track=latest.find(track=>track.id===object.trackId&&Math.abs((track.rangeAgeMs??-1)-(now-frame.wall))<2);
        object.publishedM=track?.range.distanceM??null;object.code=object.publishedM!==null?'accepted':track?.range.reasonCode??'publication-rejected';object.terminalStage='publication';
      }
      const visible=objects.some(object=>object.publishedM!==null);
      mobileSoak.metricOutcome(frame.wall,visible);
      if(visible){liveMetricAccepted++;liveMetricReasonCode='measured';liveMetricReason='Đã ghép depth và xe cùng frame · mét AI chưa kiểm chứng.';}
      else rejectLiveMetric('publication','Số đo sau lọc không đủ điều kiện công bố; không dùng cho cảnh báo.');
      diagnosticLedger.stage('metric',frame.id,'publication',performance.now());
      diagnosticLedger.metricObjects(frame.id,objects);
      diagnosticLedger.finish('metric',frame.id,visible?'accepted-observed':'publication-rejected',performance.now());
    }
    else{
      mobileSoak.metricOutcome(frame.wall,false);
      const reasons=ranges.flatMap((range,index)=>frame.boxes[index].score>=VEHICLE_STRONG_SCORE&&range?.distanceM===null?[range.reason]:[]);
      diagnosticLedger.metricObjects(frame.id,objects);
      diagnosticLedger.finish('metric',frame.id,reasons.length?'roi-rejected':objects.some(o=>o.terminalStage==='filter')?'filter-rejected':'binding-rejected',performance.now());
      const filterRejected=objects.some(o=>o.terminalStage==='filter');
      rejectLiveMetric(reasons.length?'roi-policy':filterRejected?'temporal-filter':'track-binding',reasons[0]??(filterRejected?'Phép đo nhảy bất thường hoặc cần tái xác nhận; không công bố mét.':'Xe mất quan sát, di chuyển hoặc chưa có ID chắc chắn; chờ phép đo mới.'));
    }
  }catch(error){diagnosticLedger.finish('metric',frame.id,'roi-rejected',performance.now());rejectLiveMetric('invalid-result',`Depth không hợp lệ: ${error instanceof Error?error.message:String(error)}`);mobileSoak.metricOutcome(frame.wall,false);}
}
function startMetricWorker(cleanWasmRetry=false){
  if(!wantsDepth()){if(metricWorker)stopMetricWorker('Chọn mốc/profile để đo nhẹ');return;}
  if(activeDetector==='lite'&&$<HTMLSelectElement>('range-path').value==='auto')autoDepthProbeStarted=true;
  stopMetricWorker('Đang tải khoảng cách AI…');metricLoading=true;metricLoadAt=performance.now();
  const selected=sourceMetricContract();metricModel=selected;metricArtifactSource=null;
  metricLifecycle.loading(metricLoadAt);
  metricError='';
  mobileSoak.modelLoadStarted('metric-depth',$<HTMLInputElement>('wasm').checked||cleanWasmRetry?'wasm':'webgpu',metricLoadAt);
  const instance=new Worker(new URL('../worker/drive-range-worker.ts',import.meta.url),{type:'module'});metricWorker=instance;
  instance.onmessage=(event:MessageEvent<MetricWorkerMessage>)=>{
    if(metricWorker!==instance)return;const m=event.data;if(m?.channel!=='drive-range-v1')return;
    if(m.type==='status'){metricLoadAt=performance.now();$('metric-backend').textContent=m.message;}
    else if(m.type==='ready'){
      if(m.model&&m.model.sha256!==selected.sha256){recoverMetricWorker('load-error','Metric worker trả về sai graph/source shape.',true);return;}
      metricLifecycle.ready(performance.now());metricReady=true;metricLoading=false;metricBackend=m.backend;metricArtifactSource=m.artifactSource??null;
      mobileSoak.modelReady('metric-depth',m.backend,performance.now(),m.warmupMs);$('metric-backend').textContent=`Khoảng cách AI · ${m.backend} · ${selected.width}×${selected.height}`;
    }
    else if(m.type==='result'){
      const request=metricPending;if(!request||request.id!==m.id)return;metricPending=null;
      metricLifecycle.completed(performance.now());
      if(request.live)diagnosticLedger.stage('metric',request.live.detectorId,'result',performance.now());
      try{
        if(request.live){
          if(request.live.epoch===epoch&&isLiveSource()){
            metricLatencies.push(m.latencyMs);if(metricLatencies.length>5000)metricLatencies.shift();
            mobileSoak.metricInferenceOnly(request.wall,m.latencyMs);liveMetricJoin.depth(request.live.detectorId,m.map,m.latencyMs);flushLiveMetric();
          }else diagnosticLedger.finish('metric',request.live.detectorId,'wrong-generation',performance.now());
        }else{
          const rawRanges=request.boxes.map(box=>estimateLearnedVehicleRange(m.map,box,request.transform));
          const ranges=validateLearnedRanges(request.boxes,rawRanges,number('video-zoom'),request.transform.sourceHeight);
          request.resolve?.({ranges,latencyMs:m.latencyMs});
        }
      }catch(error){if(request.live){diagnosticLedger.finish('metric',request.live.detectorId,'roi-rejected',performance.now());liveMetricDropped++;mobileSoak.metricResult(request.wall,m.latencyMs,false);}else request.reject?.(error instanceof Error?error:Error(String(error)));}
    }else if(m.type==='error'){
      if(m.stage==='load')mobileSoak.modelError('metric-depth','metricLoadError');else mobileSoak.event('metricWorkerError');
      if(isLiveSource()){
        if(m.id!==undefined&&metricPending?.id!==m.id)return;
        recoverMetricWorker(m.stage==='load'?'load-error':'infer-error',m.message,m.stage==='load'&&!cleanWasmRetry&&!$<HTMLInputElement>('wasm').checked);return;
      }
      if(m.stage==='load'&&!cleanWasmRetry&&!$<HTMLInputElement>('wasm').checked){startMetricWorker(true);return;}
      metricError=m.message;
      diagnosticLedger.fail('metric',performance.now());
      if(metricPending?.live&&liveMetricJoin.busy){rejectLiveMetric('worker-error','Depth lỗi; thử lại AI.');mobileSoak.metricOutcome(metricPending.wall,false);}else metricPending?.reject?.(Error(m.message));metricPending=null;stopMetricWorker('Khoảng cách AI không khả dụng');
      status(`Khoảng cách AI không tải được; vẫn tiếp tục khoanh xe. ${m.message}`);
    }
  };
  instance.onerror=()=>{if(metricWorker!==instance)return;diagnosticLedger.fail('metric',performance.now());if(!mobileSoak.modelError('metric-depth','metricLoadError'))mobileSoak.event('metricWorkerError');if(isLiveSource()){recoverMetricWorker('module-error','Module khoảng cách lỗi.',metricLoading&&!cleanWasmRetry&&!$<HTMLInputElement>('wasm').checked);return;}if(metricLoading&&!cleanWasmRetry&&!$<HTMLInputElement>('wasm').checked){startMetricWorker(true);return;}metricError='Module khoảng cách lỗi; thử tải lại AI.';if(metricPending?.live&&liveMetricJoin.busy){rejectLiveMetric('worker-error','Depth worker lỗi.');mobileSoak.metricOutcome(metricPending.wall,false);}else metricPending?.reject?.(Error('Metric worker lỗi.'));metricPending=null;stopMetricWorker('Khoảng cách AI không khả dụng');status('Khoảng cách AI lỗi; nhận diện xe vẫn tiếp tục.');};
  instance.postMessage({type:'init',orientation:selected.orientation,backend:$<HTMLInputElement>('wasm').checked||cleanWasmRetry?'wasm':'webgpu'});
}
function dispatchLiveMetric(request:PendingFrame,snapshot:MetricSnapshot){
  const current=metricWorker;
  if(!current||!metricReady||metricPending||!wantsDepth()||!liveMetricJoin.begin({...request,transform:snapshot.transform}))return;
  const id=++metricFrameId;metricPending={id,wall:request.wall,boxes:[],transform:snapshot.transform,live:{epoch:request.epoch,t:request.t,w:request.w,h:request.h,detectorId:request.id}};liveMetricAttempts++;mobileSoak.metricAttempt(request.wall);
  diagnosticLedger.begin('metric',request.id,request.epoch,request.wall);
  diagnosticLedger.metricContext(request.id,snapshot.diagnostics);
  metricLifecycle.running(performance.now());
  current.postMessage({type:'frame',id,width:snapshot.transform.targetWidth,height:snapshot.transform.targetHeight,rgba:snapshot.rgba},[snapshot.rgba]);
  diagnosticLedger.stage('metric',request.id,'dispatch',performance.now());
}

function startWorker(cleanWasmRetry=false){
  stopWorker();activeDetector=chooseDriveDetector(detectorChoice(),/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent));mobileBudget.reset();joinedBudget.reset();metricBudgetBlocked=false;autoDepthProbeStarted=false;
  // A detector retry must not cancel an owned, scheduled depth recovery or
  // restart the failed GPU depth backend before its clean WASM retry fires.
  if(!wantsDepth())stopMetricWorker('Chọn mốc/profile để đo nhẹ');
  else if(metricRetryTimer===null&&(!metricWorker||sourceMetricContract().sha256!==metricModel.sha256))startMetricWorker(cleanWasmRetry);
  loading=true;loadAt=performance.now();$('backend').textContent=activeDetector==='lite'?'Đang tải Nano · 3,66 MB…':'Đang tải RT-DETR…';$('model').textContent='Dừng nhận diện';
  detectorError='';
  const useGpu=!cleanWasmRetry&&!$<HTMLInputElement>('wasm').checked;
  mobileSoak.modelLoadStarted('detector',useGpu?'webgpu':'wasm',loadAt);
  const instance=activeDetector==='lite'?new Worker(new URL('../worker/drive-lite-worker.ts',import.meta.url),{type:'module'}):useGpu?new Worker(new URL('../worker/drive-detect-worker.ts',import.meta.url),{type:'module'}):new Worker(new URL('../worker/detect-worker.ts',import.meta.url),{type:'module'});worker=instance;
  instance.onmessage=(event:MessageEvent<DriveWorkerMessage>)=>{
    if(worker!==instance)return;const m=event.data;
    if(m.type==='ready'){ready=true;loading=false;backend=m.device;mobileSoak.modelReady('detector',m.device,performance.now());$('backend').textContent=`${activeDetector==='lite'?'YOLOX-Nano':'RT-DETR'} · ${backend}`;if(!metricWorker&&metricRetryTimer===null&&wantsDepth())startMetricWorker(cleanWasmRetry);status(source==='file'?'AI sẵn sàng. Đang chuẩn bị phân tích video.':wantsDepth()?'Nhận diện sẵn sàng; mét AI xuất hiện khi depth cùng frame đủ điều kiện.':'Detector nhẹ sẵn sàng. Chọn Đo theo mốc trên video để có mét không cần depth AI.');lastFrame=-1;}
    else if(m.type==='progress'){loadAt=performance.now();$('backend').textContent=`Tải nhận diện ${Math.round(m.progress)}%`;}
    else if(m.type==='error'){
      diagnosticLedger.fail('detector',performance.now());
      if(m.stage==='load')mobileSoak.modelError('detector','detectorLoadError');else mobileSoak.event('detectorWorkerError');
      // An unsuccessful GPU/session initialisation may leave the runtime unusable
      // for in-worker fallback. Retry load once in a new, WASM-only worker.
      if(m.stage==='load'&&!cleanWasmRetry&&!$<HTMLInputElement>('wasm').checked){
        startWorker(true);
        status(`Backend mặc định không khởi tạo được. Đang thử WASM trong phiên mới. ${m.message}`);return;
      }
      detectorError=m.message;failFileAnalysis(`AI không tải được: ${m.message} — kiểm tra mạng hoặc thử WASM.`);stopWorker();resetTimeline();
    }
    else if(m.type==='det'){
      const request=pending;if(!request||request.id!==m.capturedAt)return;pending=null;
      const now=performance.now();
      if(isLiveSource()){liveTelemetry.result(request.id,now);mobileSoak.result(request.id,now);diagnosticLedger.stage('detector',request.id,'result',now);}
      if(request.resolve){request.resolve({timeMs:request.t,boxes:m.boxes,latencyMs:now-request.wall,width:request.w,height:request.h});return;}
      if(request.epoch!==epoch||source==='none'||source==='demo'){diagnosticLedger.finish('detector',request.id,'wrong-generation',now);liveTelemetry.drop(request.id,'source-reset');mobileSoak.drop(request.id,'source-reset');return;}
      frameLatencies.push(now-request.wall);if(frameLatencies.length>5000)frameLatencies.shift();
      mobileBudget.observe(now-request.wall);
      // Only the new Nano preflight may introduce depth after 10 detector
      // samples. This must never become an unbounded restart after a failure.
      if(activeDetector==='lite'&&!autoDepthProbeStarted&&metricLifecycle.state!=='DEGRADED'&&!metricWorker&&metricRetryTimer===null&&wantsDepth())startMetricWorker(cleanWasmRetry);
      const samePausedFrame=source==='file'&&video.paused&&Math.abs(clock()-request.t)<1;
      if(now-request.wall>LIVE_BOX_MAX_AGE_MS&&!samePausedFrame){diagnosticLedger.finish('detector',request.id,'stale',now);droppedResults++;liveTelemetry.drop(request.id,'stale-result');mobileSoak.drop(request.id,'stale-result');status('Nhận diện chậm hơn 2,5 giây; không hiển thị box cũ. Xem thời gian xử lý trong Phân tích.');flushLiveMetric();return;}
      const current=size();if(current[0]!==request.w||current[1]!==request.h){liveTelemetry.drop(request.id,'geometry-change');mobileSoak.drop(request.id,'geometry-change');clearProfile();status('Nguồn đổi kích thước: cần hiệu chuẩn lại.');return;}
      // Scale detector endpoint uncertainty back into original image coordinates.
      const effective=profile?{...profile,pixelSigma:Math.max(profile.pixelSigma,3*request.w/capture.width)}:null;
      const anchorRanges=anchorProfile?new Map(m.boxes.map(box=>[box,estimateAnchorRange(box,anchorProfile!,request.w,request.h,number('video-zoom'))])):null;
      tracker.observe(m.boxes,request.t,now,effective,request.w,request.h,anchorRanges,isLiveSource(),now-request.wall);
      record(request.t,now,now-request.wall,video.paused);
      if(isLiveSource()){
        diagnosticLedger.stage('detector',request.id,'publication',performance.now());diagnosticLedger.finish('detector',request.id,'accepted-observed',performance.now());
        if(liveTelemetry.accept(request.id,performance.now()))liveTraceId=request.id;
        mobileSoak.accept(request.id);mobileSoak.tracks(now,latest.map(track=>track.id));
      }
      if(isLiveSource()){liveMetricJoin.detection(request.id,m.boxes,tracker.bindLearnedFrame(m.boxes,request.t));flushLiveMetric();
        if(activeDetector==='lite'&&$<HTMLSelectElement>('range-path').value==='auto'&&mobileBudget.report().state==='too-slow'){metricBudgetBlocked=true;stopMetricWorker('Ngân sách chậm · dùng mốc đã kiểm');}}
    }
  };
  instance.onerror=()=>{if(worker!==instance)return;diagnosticLedger.fail('detector',performance.now());if(!mobileSoak.modelError('detector','detectorLoadError'))mobileSoak.event('detectorWorkerError');if(loading&&!cleanWasmRetry&&!$<HTMLInputElement>('wasm').checked){startWorker(true);status('Worker GPU không khởi động được; đang thử WASM local.');return;}detectorError='Module nhận diện lỗi; thử tải lại AI.';if(pending&&isLiveSource()){liveTelemetry.drop(pending.id,'worker-error');mobileSoak.drop(pending.id,'worker-error');}failFileAnalysis('Worker lỗi: nhận diện đã dừng. Chạy lại hoặc chọn WASM trong Phân tích.');stopWorker();resetTimeline();};
  instance.postMessage({type:'init',engine:'rtdetr',queries:['car','bus','truck'],
    localModels:!useGpu||new URLSearchParams(location.search).get('local-models')==='1',profile:'drive',forceWasm:!useGpu});
}

function sendFrame(frameAvailableAt=performance.now()){
  if(isLiveSource()&&(document.hidden||video.paused||!sourceLifecycle.canCapture(sourceTicket)))return;
  if(pending){if(isLiveSource()){diagnosticLedger.skip('busy');liveTelemetry.skip('busy');mobileSoak.busy(frameAvailableAt);}return;}
  if(!ready||!worker||source==='none'||source==='demo'||source==='file'||video.readyState<2||video.seeking)return;
  if(source==='fixture'&&video.paused){diagnosticLedger.skip('paused');return;}
  const t=video.currentTime*1000;if(t===lastFrame)return;
  const [w,h]=size();if(!w||!h)return;
  if(metricWorker&&sourceMetricContract().sha256!==metricModel.sha256){
    resetTimeline(false);startMetricWorker(metricBackend==='wasm');status('Nguồn đổi hướng; hủy mét cũ và tải graph đúng ảnh dọc/ngang.');return;
  }
  const intervalMs=liveMetricIntervalMs(frameLatencies,backend,metricBackend,metricLatencies,joinedLatencies),now=performance.now();
  if(isLiveSource()&&!profile&&metricReady&&metricPending?.live&&latest.some(track=>track.box.score>=VEHICLE_STRONG_SCORE)&&now-lastLiveMetricCapture>=intervalMs&&
    liveMetricAlignmentWaitMs(now,metricPending.wall,metricAlignmentHoldAt,metricLatencies,backend,metricBackend)>0){
    metricAlignmentHoldAt??=now;diagnosticLedger.skip('alignment');return;
  }
  metricAlignmentHoldAt=null;
  if((profile&&(profile.width!==w||profile.height!==h))||(anchorProfile&&(anchorProfile.width!==w||anchorProfile.height!==h))){clearProfile();status('Kích thước camera thay đổi: calibration bị hủy.');}
  if(capture.width!==Math.min(640,w))capture.width=Math.min(640,w);
  const height=Math.max(1,Math.round(capture.width*h/w));if(capture.height!==height)capture.height=height;
  try {
    const wall=performance.now(),id=++frameId;
    if(isLiveSource()){diagnosticLedger.begin('detector',id,epoch,wall);liveTelemetry.begin(id,epoch,t,frameAvailableAt);mobileSoak.begin(id,epoch,frameAvailableAt);}
    captureCtx.drawImage(video,0,0,capture.width,capture.height);const data=captureCtx.getImageData(0,0,capture.width,capture.height);
    let metricSnapshot:MetricSnapshot|undefined;
    if(isLiveSource()&&!profile&&metricReady&&!metricPending&&!liveMetricJoin.busy&&latest.some(track=>track.box.score>=VEHICLE_STRONG_SCORE)&&wall-lastLiveMetricCapture>=intervalMs){
      const transform=letterboxTransform(w,h,metricModel.width,metricModel.height);metricCapture.width=metricModel.width;metricCapture.height=metricModel.height;
      metricCaptureCtx.fillStyle='#000';metricCaptureCtx.fillRect(0,0,metricCapture.width,metricCapture.height);
      metricCaptureCtx.drawImage(video,0,0,w,h,transform.offsetX,transform.offsetY,transform.contentWidth,transform.contentHeight);
      metricSnapshot={rgba:metricCaptureCtx.getImageData(0,0,metricCapture.width,metricCapture.height).data.buffer,transform,
        diagnostics:{sourceWidth:w,sourceHeight:h,targetWidth:transform.targetWidth,targetHeight:transform.targetHeight,
          contentFraction:transform.contentWidth*transform.contentHeight/(transform.targetWidth*transform.targetHeight),modelSha256:metricModel.sha256,preparationMs:performance.now()-wall,requestedIntervalMs:intervalMs}};lastLiveMetricCapture=wall;
    }else if(isLiveSource()){
      const reason:SkipReason=profile?'profile':!metricReady?'not-ready':metricPending||liveMetricJoin.busy?'busy':!latest.some(track=>track.box.score>=VEHICLE_STRONG_SCORE)?'no-vehicle':'cadence';
      diagnosticLedger.skip(reason);
    }
    if(isLiveSource())liveTelemetry.captureDone(id,performance.now());pending={id,t,wall,epoch,w,h};lastFrame=t;
    if(metricSnapshot)dispatchLiveMetric(pending,metricSnapshot);
    worker.postMessage({type:'frame',rgba:data.data.buffer,width:capture.width,height:capture.height,capturedAt:id},[data.data.buffer]);
    if(isLiveSource()){const dispatchedAt=performance.now();diagnosticLedger.stage('detector',id,'dispatch',dispatchedAt);liveTelemetry.dispatched(id,dispatchedAt);mobileSoak.dispatched(id,dispatchedAt);}
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
      const [sourceWidth,sourceHeight]=size(),transform=letterboxTransform(sourceWidth,sourceHeight,metricModel.width,metricModel.height);
      if(sourceMetricContract().sha256!==metricModel.sha256)throw Error('Metric graph không khớp hướng video; chạy lại phân tích.');
      if(metricCapture.width!==metricModel.width)metricCapture.width=metricModel.width;
      if(metricCapture.height!==metricModel.height)metricCapture.height=metricModel.height;
      metricCaptureCtx.fillStyle='#000';metricCaptureCtx.fillRect(0,0,metricCapture.width,metricCapture.height);
      metricCaptureCtx.drawImage(video,0,0,sourceWidth,sourceHeight,transform.offsetX,transform.offsetY,transform.contentWidth,transform.contentHeight);
      const rgba=metricCaptureCtx.getImageData(0,0,metricCapture.width,metricCapture.height),id=++metricFrameId;
      metricPending={id,wall:performance.now(),boxes,transform,resolve:done,reject:fail};
      current.postMessage({type:'frame',id,width:metricCapture.width,height:metricCapture.height,rgba:rgba.data.buffer},[rgba.data.buffer]);
    }catch(error){metricPending=null;fail(error instanceof Error?error:Error(String(error)));}
  });
}
async function analyseVideo(){
  const cached=cachedAnalysis();
  if(source!=='file'||analysis||pending||metricPending||(!cached&&(!ready||metricLoading))||fileJob.phase!=='loading')return;
  autoAnalyse=false;const job=new AbortController();analysis=job;replayReady=false;samples=[];replayFrames=[];
  video.pause();resetTimeline();analysisStarted=performance.now();analysisBackend=backend;analysisMetricBackend=metricReady?metricBackend:'unavailable';
  $<HTMLButtonElement>('analyse').textContent='Hủy phân tích';
  try{
    const plan=activeOfflinePlan??offlinePlan(video.duration*1000,selectedOfflinePreset()),times=plan.times,progress=$<HTMLProgressElement>('analysis-progress');progress.max=times.length;progress.value=0;
    fileJob.start(analysisStarted);
    if(cached){samples=structuredClone(cached);analysisCacheHit=true;progress.value=samples.length;fileJob.advance(samples.length);}
    else await runOfflinePipeline(times,job.signal,async target=>{
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
    analysisElapsedMs=performance.now()-analysisStarted;if(!cached)storeCachedAnalysis();replayReady=true;refreshReplay();
    await seekDecoded(video,0,job.signal);
    const measured=replayFrames.reduce((sum,frame)=>sum+frame.tracks.filter(track=>track.range.distanceM!==null).length,0),tracked=replayFrames.reduce((sum,frame)=>sum+frame.tracks.length,0),strong=samples.reduce((sum,s)=>sum+vehicleCandidates(s.boxes).filter(box=>box.score>=VEHICLE_STRONG_SCORE).length,0);
    const resultNote=!tracked?'chưa có xe đủ điều kiện hiển thị.':measured||profile?'phát để xem kết quả.':'đã khoanh xe; chưa có mét hợp lệ.';
    fileJob.complete(`${samples.length} khung · ${analysisCacheHit?'cache phiên local · ':''}${resultNote}`);
    status(`${analysisCacheHit?'Đã dựng từ cache phiên local':'Đã phân tích'} ${samples.length} frame · ${strong} detection mạnh · ${tracked} quan sát track. Bấm Phát để xem đồng bộ. ${measured?`${measured} quan sát có mét (chưa nghiệm thu thực địa).`:'Không có phép đo metric hợp lệ; vẫn giữ kết quả khoanh xe.'}`);
  }catch(e){if(!job.signal.aborted){replayReady=false;samples=[];replayFrames=[];const message=`Phân tích chưa hoàn tất: ${e instanceof Error?e.message:String(e)}`;fileJob.fail(message);status(message);}}
  finally{if(analysis===job){analysis=null;$<HTMLButtonElement>('analyse').textContent='Phân tích lại video';}}
}
if('requestVideoFrameCallback' in video){const tick=(now:number,metadata:VideoFrameCallbackMetadata)=>{if(isLiveSource())mobileSoak.presentedFrame(now,metadata as PresentedFrameMetadata);sendFrame(now);video.requestVideoFrameCallback(tick);};video.requestVideoFrameCallback(tick);}

function formatTime(seconds:number){return `${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;}
function riskConfig(){return {speedKph:number('ego-speed'),adverse:$<HTMLInputElement>('adverse').checked};}
function tone(level:'caution'|'critical'){
  if(!alertsEnabled||!audioContext)return false;
  const now=performance.now(),wait=level==='critical'?1100:3000;if(now-lastAlertWall<wait)return false;lastAlertWall=now;
  const oscillator=audioContext.createOscillator(),gain=audioContext.createGain(),start=audioContext.currentTime;
  oscillator.type='sine';oscillator.frequency.value=level==='critical'?920:620;gain.gain.setValueAtTime(.0001,start);gain.gain.exponentialRampToValueAtTime(.1,start+.015);gain.gain.exponentialRampToValueAtTime(.0001,start+.18);
  oscillator.connect(gain).connect(audioContext.destination);oscillator.start(start);oscillator.stop(start+.2);
  return true;
}
function captureRiskEvent(risk:RiskSnapshot,timeMs:number){
  const target=risk.primary;if(!target||!['caution','critical'].includes(target.level))return false;
  const level=target.level as 'caution'|'critical',key=`${target.track.id}:${level}`,previous=lastRiskEvent.get(key)??-Infinity;
  if(timeMs<previous||timeMs-previous<5000)return false;lastRiskEvent.set(key,timeMs);
  riskEvents.push({timeMs,trackId:target.track.id,level,ttcS:target.ttcS,distanceM:target.track.range.distanceM,confidence:target.confidence,reason:target.reason});
  if(riskEvents.length>500)riskEvents.shift();return tone(level);
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
  road.tick(now,source==='fixture'?'file':source,!!analysis||autoAnalyse);
  if(fileJob.metadataExpired(now))failFileAnalysis('Chờ đọc video quá 15 giây. Chọn MP4/H.264 hoặc thử mở lại file.','choose');
  if(loading&&now-loadAt>120000){detectorError='Tải/khởi tạo nhận diện không tiến triển trong 120 giây.';failFileAnalysis(detectorError);stopWorker();}
  if(metricLoading&&now-metricLoadAt>120000){metricError='Tải/khởi tạo khoảng cách không tiến triển trong 120 giây.';if(isLiveSource())recoverMetricWorker('load-timeout',metricError);else{stopMetricWorker('Khoảng cách AI timeout');status(`${metricError} Vẫn tiếp tục khoanh xe.`);}}
  if(isLiveSource())flushLiveMetric();
  if(pending&&now-pending.wall>15000){diagnosticLedger.fail('detector',now);detectorError='Inference quá 15 giây: đã dừng để không hiển thị dữ liệu cũ.';failFileAnalysis(detectorError);stopWorker();resetTimeline();}
  if(metricPending&&now-metricPending.wall>15000){diagnosticLedger.fail('metric',now);metricError='Depth inference quá 15 giây; không hiển thị mét cũ.';if(isLiveSource())recoverMetricWorker('infer-timeout',metricError);else{stopMetricWorker('Khoảng cách AI timeout');status(metricError);}}
  if(source==='file'&&autoAnalyse&&!analysis&&!pending&&(ready||!!cachedAnalysis())&&video.readyState>=2)void analyseVideo();
  if(rangeEnabled&&source==='demo'&&now-lastDemo>100){lastDemo=now;const t=clock(),f=demoFrame(t);tracker.observe(f.boxes,t,now,profile,1280,720);record(t,now,0);}
  else if(source!=='none'&&source!=='demo'&&(!('requestVideoFrameCallback' in video)||video.paused))sendFrame(now);
  const replay=rangeEnabled&&source==='file'&&replayReady?replayAt(replayFrames,clock(),(activeOfflinePlan?.stepMs??REPLAY_STEP_MS)+5):null;
  latest=rangeEnabled?(source==='file'?(replay?.tracks??[]):publishedSnapshot(clock(),now)):[];
  if(isLiveSource()&&!video.paused)meterCoverage.presentation(now,latest);else meterCoverage.pause();
  if(manifest&&isLiveSource()&&!video.paused)diagnosticLedger.presentation(now,latest.some(t=>t.range.distanceM!==null),latest.some(t=>t.ageMs>0));
  else diagnosticLedger.pausePresentation();
  latestRisk=assessRisk(latest,riskConfig(),replay?'analysed-replay':source==='demo'?'synthetic':'live');const riskById=new Map(latestRisk.tracks.map(item=>[item.track.id,item]));
  const warningText=hudWarning(latestRisk.primary,source!=='none'&&!analysis);
  if(isLiveSource()&&liveTraceId!==null)liveTelemetry.risk(liveTraceId,performance.now(),warningText!==null);
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
  const pathChip=$<HTMLButtonElement>('range-path-chip');pathChip.hidden=!rangeEnabled||source==='none'||source==='demo';
  pathChip.textContent=anchorProfile?'Mét · mốc đã kiểm':profile?'Mét · profile':wantsDepth()?'Mét · AI thử nghiệm':'Đo theo mốc';
  pathChip.style.left=`${left+12}px`;pathChip.style.top=`${top+Math.min(h-44,72)}px`;
  if(road.enabled){
    const header=stage.querySelector<HTMLElement>('.topbar')!,mode=$('hud-mode');
    const chromeBottom=Math.max(header.getBoundingClientRect().bottom,mode.hidden?0:mode.getBoundingClientRect().bottom)-rect.top;
    road.position(left,top,w,h,chromeBottom);
  }
  if(source==='demo'){
    ctx.fillStyle='#91b1bf';ctx.fillRect(left,top,w,h*.5);ctx.fillStyle='#52666e';ctx.fillRect(left,top+h*.5,w,h*.5);
    ctx.strokeStyle='#d9d5b5';ctx.lineWidth=2;for(const x of [-.1,.32,.68,1.1]){ctx.beginPath();ctx.moveTo(left+w*.5,top+h*.5);ctx.lineTo(left+w*x,top+h);ctx.stroke();}
    for(const b of demoFrame(clock()).boxes){ctx.fillStyle=b.label==='car'?'#d8e2e7':'#8c9da7';ctx.fillRect(left+b.x0*w,top+b.y0*h,(b.x1-b.x0)*w,(b.y1-b.y0)*h);ctx.fillStyle='#274651';ctx.fillRect(left+(b.x0+.015)*w,top+(b.y0+.02)*h,Math.max(0,(b.x1-b.x0-.03)*w),Math.max(0,(b.y1-b.y0)*h*.35));}
  }
  const occupied:Array<{x:number;y:number;w:number}>=[];
  ctx.save();ctx.beginPath();ctx.rect(left,top,w,h);ctx.clip();
  road.draw(ctx,left,top,w,h,!!analysis||autoAnalyse||source==='none'||source==='demo');
  if($<HTMLDetailsElement>('analysis-panel').open&&!road.enabled){
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
  if(isLiveSource()&&liveTraceId!==null){const overlayAt=performance.now();liveTelemetry.overlay(liveTraceId,overlayAt,warningText!==null);mobileSoak.overlay(liveTraceId,overlayAt,warningText!==null);}
  if(now-lastTable>200){lastTable=now;
    syncFeatureToggles();
    const soak=mobileSoak.status(performance.now()),soakSeconds=Math.floor(soak.durationMs/1000);
    $('mobile-soak-status').textContent=isLiveSource()?`${source==='fixture'?'Fixture realtime':'Mobile soak'} · ${Math.floor(soakSeconds/60)}:${String(soakSeconds%60).padStart(2,'0')} · ${soak.phase} · pixel-free`:'Mobile soak chưa chạy · mở camera hoặc test realtime bằng video.';
    const audioRequested=captureRiskEvent(latestRisk,clock());
    if(audioRequested&&isLiveSource()&&liveTraceId!==null)liveTelemetry.audio(liveTraceId,performance.now());
    $<HTMLButtonElement>('analyse').disabled=source!=='file'||loading||metricLoading||!!metricPending;
    $<HTMLSelectElement>('analysis-preset').disabled=!!analysis||fileJob.phase==='loading'||fileJob.phase==='running';
    $<HTMLButtonElement>('play').disabled=(source!=='file'&&source!=='fixture')||!!analysis;
    $<HTMLInputElement>('seek').disabled=(source!=='file'&&source!=='fixture')||!!analysis;
    if(!analysis)$('analysis-status').textContent=loading||metricLoading?'Đang tải detector và khoảng cách AI — video vẫn ở trên máy.':replayReady?`Đã phân tích ${samples.length} frame · ${analysisCacheHit?'cache phiên local':`${Math.round(analysisElapsedMs/1000)}s xử lý`} · ${activeOfflinePlan?.samplesPerSecond.toLocaleString('vi-VN')??'—'} mẫu/giây · sẵn sàng phát/tua`:source==='file'?'Chưa có bản phân tích. Bật AI hoặc bấm Phân tích lại video.':'Mở video: AI tự phân tích trước, sau đó phát lại kết quả.';
    $('display-mode').textContent=source==='file'?(analysis?'Đang phân tích — không phải phát realtime':replayReady?`Phát lại đã phân tích · ${replay?.interpolated?'nội suy khung':'frame mẫu'} · ${activeOfflinePlan?.samplesPerSecond.toLocaleString('vi-VN')??'—'} mẫu/giây`:'Video chưa phân tích'):source==='camera'?'Camera local trực tiếp · detector + depth tách nhịp':source==='demo'?'Mẫu tổng hợp · không phải AI':'Chưa có nguồn';
    const distances=latest.flatMap(t=>t.range.distanceM===null?[]:[t.range.distanceM]),learned=latest.some(t=>t.range.provenance==='learned-unverified');
    const modeLabel=source==='fixture'?'TEST REALTIME · video local':hudMode({source,loading:loading||metricLoading,analysing:!!analysis,replayReady,hasRange:distances.length>0});
    if(source==='fixture'){$('display-mode').textContent='Fixture realtime · không phải camera';$('analysis-status').textContent='Phát theo wall-clock qua pipeline camera; frame bận bị bỏ, không chờ AI.';}
    const roadOnly=road.enabled&&!rangeEnabled&&!analysis&&!autoAnalyse&&(source==='file'||source==='camera');
    $('hud-mode').hidden=roadOnly;
    $('hud-mode').textContent=roadOnly?'Test làn · thử nghiệm':modeLabel;$('hud-mode').title=$('hud-mode').textContent??'';
    if(roadOnly){$('analysis-status').textContent='Test làn trên khung đang hiển thị. Phân tích lại video để chạy xe và khoảng cách.';$('display-mode').textContent='Test làn · không phải phép đo khoảng cách';}
    const jobView=fileJob.view(now),notice=$('job-notice');
    notice.hidden=roadOnly||!jobView.visible||(jobView.phase==='ready'&&!video.paused);
    notice.dataset.phase=jobView.phase;
    for(const [id,text] of [['job-title',jobView.title],['job-detail',jobView.detail],['job-action',jobView.actionLabel]])if($(id).textContent!==text)$(id).textContent=text;
    $<HTMLButtonElement>('job-action').hidden=jobView.action===null;
    const hudProgress=$<HTMLProgressElement>('hud-progress');hudProgress.hidden=jobView.phase!=='running';hudProgress.max=jobView.total||1;hudProgress.value=jobView.completed;
    if(isLiveSource()&&rangeEnabled){
      const failure=detectorError||(wantsDepth()?metricError:''),initialising=loading||metricLoading;
      notice.hidden=!failure&&!initialising;notice.dataset.phase=failure?'error':'loading';
      $('job-title').textContent=failure?'AI cần thử lại':'Chuẩn bị AI trên điện thoại';
      $('job-detail').textContent=failure||`${$('backend').textContent} · ${$('metric-backend').textContent}. Lần đầu tải model lớn; giữ trang mở. Hình ảnh không gửi đi.`;
      $('job-action').textContent='Thử lại AI';$<HTMLButtonElement>('job-action').hidden=!failure;hudProgress.hidden=true;
      if(!initialising&&!distances.length&&liveMetricDropped)$('hud-mode').textContent=source==='fixture'?'TEST REALTIME · chưa đo':liveMetricReasonCode==='stale'?'AI chậm · chưa đo':'Camera · chưa đủ dữ liệu đo';
    }
    const sourceNotice=isLiveSource()?sourceLifecycle.notice():null;
    if(sourceNotice){notice.hidden=false;notice.dataset.phase='error';$('job-title').textContent=sourceNotice.title;$('job-detail').textContent=sourceNotice.detail;
      $('job-action').textContent=sourceNotice.action??'';$<HTMLButtonElement>('job-action').hidden=sourceNotice.action===null;hudProgress.hidden=true;}
    $('range-status').textContent=!rangeEnabled?'Khoảng cách đang tắt. Bật nút Khoảng cách ngay trên video để nhận diện xe và đo mét.':distances.length?(learned?`Dọc phía trước: ≈${Math.round(Math.min(...distances))} m theo AI metric. Chưa hiệu chuẩn thực địa; không phải khoảng hở cản xe hay khoảng cách ngang.`:`Dọc phía trước: ≈${Math.round(Math.min(...distances))} m theo hình học chân xe. Không phải khoảng hở cản xe.`):!profile&&number('video-zoom')!==1?'Video zoom/crop: cần profile đúng tiêu cự hiệu dụng; không tự đổi scale của AI.':profile?'Đã nhập profile; chưa có xe đủ điều kiện đo.':metricReady&&source==='file'?'Chưa có mét hợp lệ: xem lý do ROI, xe cắt biên hoặc phối cảnh mâu thuẫn trong danh sách xe.':metricReady&&source==='camera'?`${liveMetricReason} Detector ${Math.round(percentile(frameLatencies,.5)??0)} ms · depth ${Math.round(percentile(metricLatencies,.5)??0)} ms.`:source==='demo'?'Mẫu tổng hợp có profile giả lập.':metricError||'Khoảng cách AI chưa sẵn sàng.';
    $('count').textContent=String(latest.length);$('age').textContent=latest.length?`${Math.round(Math.max(...latest.map(a=>a.ageMs)))} ms`:'—';
    $('method').textContent=anchorProfile?'Hình học · mốc đã kiểm':learned?'AI metric · chưa kiểm chứng':profile?(source==='demo'?'Hình học · mẫu tổng hợp':'Hình học · ước lượng chân xe'):metricReady?(source==='camera'?'AI metric live · đang chờ':'AI metric · đang chờ'):'Cần mốc/profile';
    const budget=mobileBudget.report();$('mobile-budget').textContent=budget.state==='probing'?'Đang đo ngân sách detector · cần 10 mẫu camera':`Detector P95 ${Math.round(budget.p95Ms!)} ms · ${budget.state==='within-budget'?'trong':'vượt'} ngân sách 300 ms. Không phải chứng nhận độ chính xác mét.`;
    if(anchorProfile&&!distances.length)$('range-status').textContent='Đã kiểm mốc; chờ xe đủ lớn, không cắt biên và nằm trong vùng/dải đã hiệu chuẩn.';
    else if(!wantsDepth()&&!profile&&!anchorProfile)$('range-status').textContent='Cần hiệu chuẩn mốc để có mét. Nhánh nhẹ không tải depth AI trên CPU yếu.';
    const threat=latestRisk.primary,console=$('risk-console');console.dataset.level=threat?.level??'clear';
    $('risk-target').textContent=threat?`#${threat.track.id} · ${threat.level==='critical'?'NGUY CƠ CAO':threat.level==='caution'?'CẦN CHÚ Ý':'ĐANG THEO DÕI'}`:'Chưa có mục tiêu';
    $('risk-reason').textContent=visibleRiskReason(threat);
    $('risk-distance').textContent=threat?rangeLabel(threat.track):'—';
    $('risk-distance-source').textContent=rangeSource(threat?.track??null);
    $('risk-reference').textContent=latestRisk.referenceDistanceM===null?'—':`${Math.round(latestRisk.referenceDistanceM)} m`;
    $('risk-reference-label').textContent=latestRisk.referenceLabel;
    $('risk-confidence').textContent=threat?`${Math.round(threat.confidence*100)}%`:'—';$('event-count').textContent=String(riskEvents.length);
    $('time').textContent=formatTime(clock()/1000);
    if(isLiveSource()&&metricReady&&!distances.length)$('range-status').textContent=`${liveMetricReason} Detector ${Math.round(percentile(frameLatencies,.5)??0)} ms · depth ${Math.round(percentile(metricLatencies,.5)??0)} ms.`;
    const diagnostics=$('metric-diagnostics');diagnostics.hidden=!isLiveSource();
    if(isLiveSource())diagnostics.textContent=`Chẩn đoán từng xe: ${Object.entries(diagnosticLedger.reasonSummary()).map(([code,count])=>`${code}: ${count}`).join(' · ')||'chưa có kết quả ghép'}. Nhật ký JSON ghi box, ROI, ID và bước bị loại; không lưu hình.`;
    const seek=$<HTMLInputElement>('seek');if((source==='file'||source==='fixture')&&Number.isFinite(video.duration)&&video.duration>0){seek.max=String(video.duration);seek.value=String(video.currentTime);seek.style.setProperty('--seek-progress',`${Math.min(100,Math.max(0,video.currentTime/video.duration*100))}%`);}
    $('track-list').replaceChildren(...latest.map(a=>{const row=document.createElement('div');row.className='track';row.dataset.state=a.status;row.style.setProperty('--track-colour',trackColour(a.id));
      const label=document.createElement('span');label.textContent=`#${a.id} ${a.box.label==='car'?'Ô tô':a.box.label==='truck'?'Xe tải':'Xe buýt'} · ${a.range.distanceM===null?'Chưa đo khoảng cách':`≈${Math.round(a.range.distanceM)} m dọc phía trước`}`;
      const hazard=riskById.get(a.id),detail=document.createElement('small');detail.textContent=a.range.distanceM===null?a.range.reason:hazard?`${hazard.inPath?'Trong hành lang':'Ngoài hành lang'} · ${rangeSource(a)} · ${visibleRiskReason(hazard)}`:a.range.interval?`${a.range.provenance==='learned-unverified'?'AI chưa hiệu chuẩn':'Dải nhạy sai số'} · ${a.range.interval.map(x=>Math.round(x)).join('–')} m`:a.range.reason;row.dataset.state=hazard?.level??a.status;row.append(label,detail);return row;}));
  }
}

async function jsonFile(input:HTMLInputElement){const file=input.files?.[0];input.value='';if(!file)return null;if(file.size>10*1024*1024)throw Error('JSON vượt 10 MB.');return JSON.parse(await file.text()) as unknown;}
function download(name:string,value:unknown){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function safe(action:()=>void|Promise<void>){return ()=>{Promise.resolve().then(action).catch(e=>status(e instanceof Error?e.message:String(e)));};}

function toggleRange(enabled:boolean){
  rangeEnabled=enabled;
  if(!enabled){
    if(analysis||autoAnalyse)cancelFileAnalysis();
    else{cancelAnalysis();stopWorker();stopMetricWorker();if(source!=='file'||!replayReady)resetTimeline();}
    latest=[];latestRisk=assessRisk([],{speedKph:0,adverse:false});
    status(replayReady?'Đã tắt hiển thị khoảng cách; kết quả phân tích local vẫn được giữ để bật lại ngay.':'Đã tắt nhận diện xe và đo khoảng cách.');
  }else{
    if(road.enabled&&!replayReady)toggleRoad(false);
    if(source==='file'&&!replayReady)queueFileAnalysis();
    else if(isLiveSource()&&!worker)startWorker();
    else if(source==='demo')status('Đã bật khoảng cách trên mẫu dựng.');
    else if(source==='none')status('Đã bật Khoảng cách. Mở video hoặc camera để bắt đầu.');
    else status('Đã bật hiển thị nhận diện xe và khoảng cách.');
  }
  syncFeatureToggles();
}

function toggleRoad(enabled:boolean){
  // A completed replay is cheap and can coexist with lane inference. Live or
  // unfinished range work yields explicitly so two heavy pipelines never
  // contend without the UI showing which mode is active.
  if(enabled&&!replayReady&&rangeEnabled){rangeEnabled=false;if(analysis||autoAnalyse){cancelFileAnalysis();fileJob.reset();}else{stopWorker();stopMetricWorker();resetTimeline();}}
  else if(enabled&&replayReady){stopWorker();stopMetricWorker();}
  road.setEnabled(enabled);
  const button=$('road-toggle');button.setAttribute('aria-pressed',String(enabled));
  button.setAttribute('aria-label',enabled?'Tắt thử nghiệm làn đường':'Bật thử nghiệm làn đường');
  button.title=enabled?'Làn · đang bật':'Làn · đang tắt';
  if(enabled)status(replayReady&&rangeEnabled?'Làn đã bật cùng bản khoảng cách đã phân tích.':'Làn đã bật. Phát hoặc tua video để kiểm tra; Khoảng cách đang tắt để tránh tranh tài nguyên.');
  syncFeatureToggles();
}
$('range-toggle').onclick=()=>toggleRange(!rangeEnabled);
$('road-toggle').onclick=()=>toggleRoad(!road.enabled);
$<HTMLSelectElement>('road-speed').onchange=()=>{video.playbackRate=Number($<HTMLSelectElement>('road-speed').value);};
$('test-road').onclick=()=>{toggleRoad(true);$<HTMLInputElement>('file').click();};
$<HTMLInputElement>('road-surface').onchange=()=>{road.showSurface=$<HTMLInputElement>('road-surface').checked;};
$<HTMLInputElement>('road-debug').onchange=()=>{road.debug=$<HTMLInputElement>('road-debug').checked;};
$('road-report').onclick=()=>download('drivesense-lane-diagnostics.json',{source:sourceName,...road.report()});
if(!import.meta.env.DEV){$<HTMLButtonElement>('road-toggle').disabled=true;$('road-toggle').title='Test làn hiện chỉ có trên localhost';$('test-road').hidden=true;}

$('demo').onclick=()=>{stopSource();source='demo';sourceName='Synthetic analytical replay';profile=structuredClone(DEMO_PROFILE);demoStart=performance.now();lastDemo=-Infinity;$<HTMLInputElement>('ego-speed').value='80';$('ego-speed-value').textContent='80 km/h';$('empty').hidden=true;$('source-label').textContent='Mẫu toán học · không phải AI';profileToForm(profile);$('profile-status').textContent='Profile synthetic; tự hủy khi đổi sang video/camera.';status('Kiểm tra khoảng cách và policy shadow ở tốc độ giả định 80 km/h. Không dùng mẫu này để công bố chất lượng camera.');};
$<HTMLInputElement>('file').onchange=safe(async()=>{const input=$<HTMLInputElement>('file'),file=input.files?.[0];input.value='';if(!file)return;stopSource();currentFile=file;source='file';sourceName=file.name;fileJob.open(performance.now());objectUrl=URL.createObjectURL(file);video.src=objectUrl;video.load();$('source-label').textContent=file.name;$('empty').hidden=true;status('Đang đọc thông tin video. Chưa tải AI cho đến khi kiểm tra thời lượng hợp lệ.');});
$<HTMLInputElement>('fixture-file').onchange=safe(async()=>{
  const input=$<HTMLInputElement>('fixture-file'),file=input.files?.[0];input.value='';if(!file)return;
  stopSource();stopWorker();stopMetricWorker();if(road.enabled)toggleRoad(false);
  source='fixture';sourceName='Local realtime fixture';rangeEnabled=true;const ticket=sourceTicket;
  // One preflight digest, never inside capture/render. Large files remain usable
  // with an explicit unavailable fingerprint rather than an invented identity.
  const digest=file.size<=100*1024*1024?await crypto.subtle.digest('SHA-256',await file.arrayBuffer()):null;
  if(ticket!==sourceTicket)return;
  sourceLifecycle.begin(ticket,'fixture',document.hidden);
  fixtureIdentity={sha256:digest?[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join(''):null,
    bytes:file.size,mime:file.type.slice(0,80),rights:'User-selected local test input; no redistribution or dataset rights inferred.'};
  objectUrl=URL.createObjectURL(file);video.src=objectUrl;video.playbackRate=1;video.load();
  $('empty').hidden=true;$('source-label').textContent='TEST REALTIME · video local · không phải camera';
  status('Clip chạy qua pipeline camera theo thời gian thật, không phân tích trước. Kết quả là dữ liệu test, chưa phải kiểm chứng điện thoại.');
});
async function refreshCameraDevices(preferred=''){
  const select=$<HTMLSelectElement>('camera-select');
  if(!navigator.mediaDevices?.enumerateDevices){select.disabled=true;$('camera-status').textContent='Trình duyệt không hỗ trợ liệt kê camera.';return;}
  const ticket=sourceTicket,selected=preferred||select.value;
  let devices:MediaDeviceInfo[];
  try{devices=await navigator.mediaDevices.enumerateDevices();}
  catch{if(ticket===sourceTicket)$('camera-status').textContent='Không liệt kê được thiết bị; vẫn có thể mở camera mặc định.';return;}
  if(ticket!==sourceTicket)return;
  const choices=cameraChoices(devices);
  const fallback=document.createElement('option');fallback.value='';fallback.textContent='Tự chọn camera phù hợp';
  select.replaceChildren(fallback,...choices.map(choice=>{const option=document.createElement('option');option.value=choice.deviceId;option.textContent=choice.label;return option;}));
  if(choices.some(choice=>choice.deviceId===selected))select.value=selected;
  $('camera-status').textContent=choices.length?`${choices.length} camera local · chọn điện thoại nếu Continuity Camera/USB đã kết nối.`:'Chưa thấy camera. Cấp quyền rồi làm mới danh sách.';
}
async function openLocalCamera(){
  const requested=$<HTMLSelectElement>('camera-select').value;stopSource();const ticket=sourceTicket;status('Đang xin quyền camera local…');
  let next:MediaStream;
  try{
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera cần HTTPS và trình duyệt hỗ trợ.');
    next=await navigator.mediaDevices.getUserMedia(cameraConstraints(requested));
  }catch(error){
    if(ticket!==sourceTicket)return;
    const name=error instanceof Error?error.name:'';
    status(name==='NotAllowedError'?'Chưa có quyền camera. Cho phép camera trong cài đặt trang rồi bấm Camera để thử lại.':
      name==='NotFoundError'?'Không tìm thấy camera. Kết nối camera hoặc chọn video có sẵn.':
      name==='NotReadableError'?'Camera đang bận hoặc bị hệ điều hành ngắt. Đóng ứng dụng dùng camera rồi thử lại.':error instanceof Error?error.message:String(error));return;
  }
  if(ticket!==sourceTicket){next.getTracks().forEach(t=>t.stop());return;}
  const track=next.getVideoTracks()[0];
  if(!track||track.readyState==='ended'){next.getTracks().forEach(t=>t.stop());status('Nguồn camera không có video đang chạy.');return;}
  stream=next;source='camera';video.srcObject=stream;sourceName=track.label||'Camera local';sourceLifecycle.begin(ticket,'camera',document.hidden);
  // Device enumeration is optional and never gates capture/playback.
  void refreshCameraDevices(track.getSettings().deviceId??requested);
  next.getVideoTracks().forEach(track=>{
    track.addEventListener('ended',()=>{if(ticket===sourceTicket&&stream===next){stopSource();status('Camera đã ngắt; dữ liệu đo đã hủy.');}},{once:true});
    track.addEventListener('mute',()=>{if(ticket===sourceTicket&&stream===next)suspendLiveSource('muted');});
    track.addEventListener('unmute',()=>{if(ticket===sourceTicket&&stream===next){sourceLifecycle.available('muted');void resumeLiveSource();}});
  });
  if(track.muted)sourceLifecycle.suspend('muted',false);
  $('empty').hidden=true;$('source-label').textContent=`${sourceName} · local · không ghi hình`;status(road.enabled?'Camera đã mở để test làn local. Không phải cảnh báo lệch làn.':rangeEnabled?'Camera đã mở. Detector/depth ghép cùng frame với nhịp theo thời gian xử lý thực; tự loại kết quả cũ. Mét vẫn chưa hiệu chuẩn thực địa.':'Camera đã mở. Chọn Khoảng cách hoặc Làn ngay trên video.');
  await resumeLiveSource();
}
$('camera').onclick=safe(openLocalCamera);
$('open-selected-camera').onclick=safe(openLocalCamera);
$('refresh-cameras').onclick=safe(()=>refreshCameraDevices());
$('open-video').onclick=()=>$<HTMLInputElement>('file').click();
$('open-camera').onclick=()=>$('camera').click();
if(navigator.mediaDevices){void refreshCameraDevices();navigator.mediaDevices.addEventListener?.('devicechange',()=>void refreshCameraDevices());}
const analysisPanel=$<HTMLDetailsElement>('analysis-panel');
function closeAnalysis(){analysisPanel.open=false;analysisPanel.querySelector('summary')?.focus();}
$('close-analysis').onclick=closeAnalysis;
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&analysisPanel.open)closeAnalysis();});
$('play').onclick=safe(async()=>{if((source!=='file'&&source!=='fixture')||analysis)return;if(video.paused){if(source==='fixture')await resumeLiveSource(true);else await video.play();}else video.pause();});
function syncPlaybackControl(){const state=playbackControl(video.paused,video.ended),button=$('play');button.dataset.playing=String(state.playing);button.setAttribute('aria-label',state.label);button.title=state.label;}
for(const event of ['play','pause','ended','emptied'])video.addEventListener(event,syncPlaybackControl);
video.addEventListener('play',()=>{if(isLiveSource()){if(document.hidden){suspendLiveSource('hidden');return;}sourceLifecycle.playing(sourceTicket);screenAwake.setActive(sourceLifecycle.canCapture(sourceTicket));}});
video.addEventListener('pause',()=>{if(isLiveSource()&&video.paused){sourceLifecycle.paused(sourceTicket);screenAwake.setActive(false);if(sourceLifecycle.needsGesture()){resetTimeline(false);checkpointDiagnostics();}}});
syncPlaybackControl();
const fullscreenButton=$<HTMLButtonElement>('fullscreen');
fullscreenButton.disabled=!document.fullscreenEnabled;
if(fullscreenButton.disabled)fullscreenButton.title='Trình duyệt không hỗ trợ toàn màn hình';
fullscreenButton.onclick=safe(async()=>{if(!document.fullscreenEnabled)return;if(document.fullscreenElement===$('stage'))await document.exitFullscreen();else await $('stage').requestFullscreen();});
document.addEventListener('fullscreenchange',()=>{const active=document.fullscreenElement===$('stage'),label=active?'Thoát toàn màn hình':'Toàn màn hình';fullscreenButton.setAttribute('aria-pressed',String(active));fullscreenButton.setAttribute('aria-label',label);fullscreenButton.title=label;});
$('analyse').onclick=()=>{if(source!=='file')return;if(analysis)cancelFileAnalysis();else{rangeEnabled=true;if(road.enabled&&!replayReady)toggleRoad(false);video.pause();queueFileAnalysis();}};
$('job-action').onclick=()=>{if(isLiveSource()){if(sourceLifecycle.needsGesture()){void resumeLiveSource(true);return;}if(!ready)startWorker();else if(!metricReady)startMetricWorker();return;}const action=fileJob.view(performance.now()).action;if(action==='cancel')cancelFileAnalysis();else if(action==='retry')queueFileAnalysis();else if(action==='choose')$<HTMLInputElement>('file').click();else if(action==='play')$('play').click();};
$<HTMLInputElement>('seek').oninput=()=>{if(source==='file'||source==='fixture')video.currentTime=number('seek');};
video.addEventListener('seeking',()=>{if(analysis||replayReady)return;resetTimeline(true);status('Đã đổi vị trí video; chưa có bản phân tích hoàn chỉnh.');});
video.addEventListener('loadedmetadata',()=>{if(source==='none')return;video.playbackRate=source==='file'?Number($<HTMLSelectElement>('road-speed').value):1;const [w,h]=size();$<HTMLInputElement>('width').value=String(w);$<HTMLInputElement>('height').value=String(h);lastFrame=-1;if(source==='file'&&fileJob.phase==='reading'){if(rangeEnabled)queueFileAnalysis();else{fileJob.reset();status(road.enabled?'Video sẵn sàng test làn. Bấm Phát; bật Khoảng cách khi muốn phân tích xe.':'Video sẵn sàng. Chọn Khoảng cách hoặc Làn ngay trên video.');}}});
video.addEventListener('loadedmetadata',()=>{if(source==='fixture'){beginDiagnostics('fixture-live-replay',{width:video.videoWidth,height:video.videoHeight});startWorker();void resumeLiveSource(true);}});
video.addEventListener('ended',()=>{if(source!=='fixture')return;if($<HTMLInputElement>('fixture-loop').checked){resetTimeline(false);video.currentTime=0;void resumeLiveSource(true);}else{screenAwake.setActive(false);endDiagnostics();status('Test realtime đã hết clip. Checkpoint cuối được lưu local.');}});
video.addEventListener('error',()=>{if(source!=='none'&&video.error){const message='Không giải mã được video. Chọn MP4/H.264 hoặc định dạng trình duyệt hỗ trợ.';stopSource();stopWorker();stopMetricWorker();fileJob.fail(message,'choose');status(message);}});
$('stop').onclick=()=>{stopSource();stopWorker();stopMetricWorker();status('Đã dừng nguồn, camera và nhận diện.');};
$('model').onclick=()=>toggleRange(!rangeEnabled);
$('range-path-chip').onclick=()=>{$<HTMLDetailsElement>('analysis-panel').open=true;$('anchor-panel').scrollIntoView({behavior:'smooth',block:'start'});};
$<HTMLSelectElement>('drive-detector').onchange=()=>{cancelFileAnalysis();resetTimeline(false);if(rangeEnabled&&source!=='none'&&source!=='demo'){startWorker();if(source==='file')queueFileAnalysis();}};
$<HTMLSelectElement>('range-path').onchange=()=>{if(source==='file')cancelFileAnalysis();else{stopMetricWorker();resetTimeline(false);}metricBudgetBlocked=false;joinedBudget.reset();if(rangeEnabled&&source!=='none'&&source!=='demo'){if(!worker)startWorker();else startMetricWorker();if(source==='file')queueFileAnalysis();}refreshReplay();};
$<HTMLInputElement>('ego-speed').oninput=()=>{$('ego-speed-value').textContent=`${Math.round(number('ego-speed'))} km/h`;};
$('enable-alerts').onclick=safe(async()=>{if(!alertsEnabled){audioContext??=new AudioContext();await audioContext.resume();alertsEnabled=true;$('alert-status').textContent='Âm thanh bật; cảnh báo được giới hạn tần suất.';}else{alertsEnabled=false;$('alert-status').textContent='Âm thanh tắt. Khi lái thử, không thao tác màn hình.';}const button=$('enable-alerts'),label=alertsEnabled?'Tắt âm cảnh báo':'Bật âm cảnh báo';button.setAttribute('aria-pressed',String(alertsEnabled));button.setAttribute('aria-label',label);button.title=label;});
$<HTMLInputElement>('wasm').onchange=()=>{cancelAnalysis();const active=!!worker||!!metricWorker;stopWorker();stopMetricWorker();if(active){if(source==='file'&&!replayReady)queueFileAnalysis();else startWorker();}resetTimeline();};
$<HTMLSelectElement>('analysis-preset').onchange=()=>{
  const preset=selectedOfflinePreset(),preview=offlinePlan(1000,preset);
  $('analysis-preset-status').textContent=`${preview.disclosure} Áp dụng cho lần phân tích tiếp theo; luôn giữ đầu và cuối timeline.`;
  if(source==='file'&&replayReady)status('Đã đổi preset cho lần chạy tiếp theo. Bản replay hiện tại và báo cáo vẫn giữ nguyên cấu hình đã phân tích.');
};
$('clear-profile').onclick=clearProfile;
$<HTMLInputElement>('video-zoom').oninput=()=>{clearProfile();};
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
  const [sourceWidth,sourceHeight]=size();
  const values:Observation[]=recorded?replayFrames.flatMap((f,i)=>f.tracks.map(t=>({timeMs:f.timeMs,trackId:t.id,distanceM:t.range.distanceM,latencyMs:samples[i].latencyMs,reason:t.range.reason}))):observations;
  const latencies=recorded?samples.map(s=>s.latencyMs):frameLatencies;
  const rangeLatencies=recorded?samples.flatMap(s=>s.metricLatencyMs===null||s.metricLatencyMs===undefined?[]:[s.metricLatencyMs]):metricLatencies;
  const seekLatencies=recorded?samples.flatMap(s=>s.seekMs===undefined?[]:[s.seekMs]):[],sampleWall=recorded?samples.flatMap(s=>s.sampleWallMs===undefined?[]:[s.sampleWallMs]):[];
  const depthCounts=recorded?{depthAttempts:samples.filter(s=>s.metricState==='success'||s.metricState==='failed').length,depthSuccessfulRequests:rangeLatencies.length,depthSkippedFrames:samples.filter(s=>s.metricState==='skipped').length,depthFailedFrames:samples.filter(s=>s.metricState==='failed').length}:{};
  const evidencePlaneCandidate=recorded?exportCurrentDriveCandidate(samples,replayFrames,replayFrames.map(frame=>assessRisk(frame.tracks,riskConfig(),'analysed-replay').primary?.track.id??null),analysisBackend||backend):null;
  const report={
    version:DRIVE_REPORT_VERSION,createdAt:new Date().toISOString(),source:source==='camera'?'Local camera':sourceName,sourceKind:source,session:epoch,synthetic:source==='demo',mode:recorded?'analysed-replay':source==='fixture'?'fixture-live-replay':source==='file'?'unanalysed-video':'live-or-synthetic',
    diagnostics:diagnosticPayload(),
    runtime:{app:'RoboEye DriveSense',appVersion:__ROBOEYE_VERSION__,sourceDimensions:{width:sourceWidth,height:sourceHeight},devicePixelRatio,capabilities:{requestVideoFrameCallback:'requestVideoFrameCallback' in video,webgpu:'gpu' in navigator,offscreenCanvas:'OffscreenCanvas' in window,crossOriginIsolated},userAgent:navigator.userAgent},
    distanceKinds:['learned_optical_axis_z_m','ground_contact_forward_m'],distanceDefinition:'Forward Z from camera; NOT bumper clearance, lateral separation or inter-vehicle B-C gap',videoZoom:number('video-zoom'),rangePolicy:LEARNED_RANGE_POLICY,
    model:source!=='demo'&&backend?(activeDetector==='lite'?{name:'YOLOX-Nano',backend:recorded?analysisBackend:backend,artifact:DRIVE_LITE_DETECTOR,candidatePolicy:DRIVE_CANDIDATE_POLICY}:{name:'RT-DETRv2 R18',backend:recorded?analysisBackend:backend,gpuArtifact:(recorded?analysisBackend:backend)==='webgpu'?DRIVE_GPU_DETECTOR:null,wasmArtifact:(recorded?analysisBackend:backend)==='wasm'?DRIVE_WASM_DETECTOR:null,decoder:DRIVE_DECODER,candidatePolicy:DRIVE_CANDIDATE_POLICY}):null,
    rangeModel:(recorded||isLiveSource())&&metricReady?{...metricModel,artifactSource:metricArtifactSource,cacheHit:null,kernelPlacement:'not profiled; backend does not prove every kernel is on GPU',backend:recorded?analysisMetricBackend:metricBackend,validation:'learned-unverified'}:null,
    offlineAnalysis:recorded&&activeOfflinePlan?{preset:activeOfflinePlan.preset,stepMs:activeOfflinePlan.stepMs,samplesPerSecond:activeOfflinePlan.samplesPerSecond,cacheHit:analysisCacheHit,disclosure:activeOfflinePlan.disclosure}:null,
    liveMetric:isLiveSource()?{scheduler:liveMetricPlan(frameLatencies,backend,metricBackend,metricLatencies,joinedLatencies),attempts:liveMetricAttempts,accepted:liveMetricAccepted,droppedOrUnmatched:liveMetricDropped,rejectionReasons:liveMetricRejections,lastReason:liveMetricReason,detectorError,metricError,maxCaptureAgeMs:LIVE_METRIC_MAX_AGE_MS,policy:'parallel same-frame snapshot; immutable track binding; metres expire 1200 ms after capture; warnings use original capture age; never overrides a supplied camera profile'}:null,
    profile,anchorProfile,mobileRanging:{detector:activeDetector,budget:mobileBudget.report(),joinedBudget:joinedBudget.report(),metres:meterCoverage.report()},risk:{config:riskConfig(),policy:'shadow-risk-v1',events:riskEvents,latest:latestRisk},summary:evaluate(values,references),liveTiming:isLiveSource()?liveTelemetry.report():null,mobileSoak:isLiveSource()?mobileSoak.report(performance.now()):null,
    frameTiming:{count:latencies.length,detectorRequestP50Ms:percentile(latencies,.5),detectorRequestP95Ms:percentile(latencies,.95),metricInferenceP50Ms:percentile(rangeLatencies,.5),metricInferenceP95Ms:percentile(rangeLatencies,.95),seekP50Ms:percentile(seekLatencies,.5),seekP95Ms:percentile(seekLatencies,.95),sampleWallP50Ms:percentile(sampleWall,.5),sampleWallP95Ms:percentile(sampleWall,.95),...depthCounts,droppedResults,analysisElapsedMs:recorded?analysisElapsedMs:null,analysedFramesPerSecond:recorded&&!analysisCacheHit&&analysisElapsedMs>0?samples.length/(analysisElapsedMs/1000):null,mediaToProcessingRatio:recorded&&!analysisCacheHit&&analysisElapsedMs>0?video.duration*1000/analysisElapsedMs:null,scope:source==='camera'?'liveTiming measures camera callback to overlay/audio; live metric depth is same-frame, bounded and unverified.':'Offline detector/depth overlap with an explicit sampling preset; not realtime sensor-to-display latency.'},
    observations:values,references,samples:recorded?samples:[],evidencePlaneCandidate,limits:'PoC desktop shadow-mode. Absolute metres/zoom/near-side/far-vehicle accuracy remain ground-truth unvalidated; not for braking/steering.'
  };
  download('drivesense-report.json',source==='camera'?{...report,liveAcceptance:evaluateLiveEvidence(report)}:report);
};
$('saved-export').onclick=safe(async()=>{const id=$<HTMLSelectElement>('saved-session').value;if(!id)throw Error('Chưa có phiên đã lưu.');download(`drivesense-session-${id}.json`,await journal.load(id));});
$<HTMLInputElement>('journal-import').onchange=safe(async()=>{const value=await jsonFile($<HTMLInputElement>('journal-import'));if(value===null)return;await journal.import(value);await refreshSavedSessions();});
document.addEventListener('visibilitychange',()=>{
  if(isLiveSource()){
    mobileSoak.event(document.hidden?'visibilityHidden':'visibilityVisible');
    if(document.hidden)suspendLiveSource('hidden');else{sourceLifecycle.available('hidden');void resumeLiveSource();}
  }else if(document.hidden&&!analysis){cancelMetricRetry();video.pause();if(!replayReady)resetTimeline();checkpointDiagnostics();}
});
window.addEventListener('pagehide',()=>{cancelAnimationFrame(raf);raf=0;stopSource();stopWorker();stopMetricWorker();});
window.addEventListener('pageshow',event=>{if(event.persisted&&raf===0){raf=requestAnimationFrame(draw);status('Trang đã trở lại. Chọn Camera hoặc video để bắt đầu phiên mới.');}});
if(initialRoadOnly)toggleRoad(true);else syncFeatureToggles();
raf=requestAnimationFrame(draw);
