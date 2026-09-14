import type {DetBox} from '../detection-types';
import {VehicleTracker, type DriveTrack} from './tracking';
import type {CameraProfile} from './geometry';
import type {RangeEstimate} from './geometry';
import {validateLearnedRanges} from './learned-range';

export const REPLAY_STEP_MS=200;
// 5 Hz, at most 1,501 samples; cache boxes/ranges, never decoded video frames.
export const MAX_REPLAY_MS=300000;
export interface ReplaySample {
  timeMs:number;boxes:DetBox[];latencyMs:number;width:number;height:number;
  learnedRanges?:Array<RangeEstimate|null>;metricLatencyMs?:number|null;
  metricState?:'success'|'skipped'|'failed';
  seekMs?:number;sampleWallMs?:number;
}
export interface ReplayFrame {timeMs:number;tracks:DriveTrack[]}
export interface ReplayView {tracks:DriveTrack[];interpolated:boolean;sampleTimeMs:number|null}

export function sampleTimes(durationMs:number):number[] {
  if(!Number.isFinite(durationMs)||durationMs<100)throw Error('Không đọc được thời lượng hợp lệ. Chọn video MP4/H.264 từ 0,1 giây.');
  if(durationMs>MAX_REPLAY_MS)throw Error('Video dài hơn 5 phút. Hãy cắt clip hoặc chọn video ngắn hơn.');
  const last=Math.max(0,durationMs-50),times:number[]=[];
  for(let t=0;t<=last;t+=REPLAY_STEP_MS)times.push(t);
  if(last-times[times.length-1]>1)times.push(last);
  return times;
}

export function buildReplay(samples:ReplaySample[],profile:CameraProfile|null,zoom=1):ReplayFrame[] {
  const tracker=new VehicleTracker();
  return samples.map(s=>{
    const learned=new Map<DetBox,RangeEstimate>();
    const validated=validateLearnedRanges(s.boxes,s.learnedRanges??[],zoom);
    s.boxes.forEach((box,index)=>{const range=validated[index];if(range)learned.set(box,range);});
    tracker.observe(s.boxes,s.timeMs,s.timeMs,profile,s.width,s.height,learned);
    // Do not cache predicted unmatched tracks as if they were real observations.
    return {timeMs:s.timeMs,tracks:tracker.snapshot(s.timeMs,s.timeMs,true).filter(t=>t.ageMs<1)};
  });
}

/** Offline display interpolation only; never invent a track through a missed detection. */
export function replayAt(frames:ReplayFrame[],t:number):ReplayView {
  const empty:ReplayView={tracks:[],interpolated:false,sampleTimeMs:null};
  if(!frames.length||!Number.isFinite(t)||t<frames[0].timeMs)return empty;
  let lo=0,hi=frames.length;
  while(lo<hi){const m=(lo+hi)>>>1;if(frames[m].timeMs<=t)lo=m+1;else hi=m;}
  const a=frames[Math.max(0,lo-1)],b=frames[lo],dt=t-a.timeMs;
  if(dt===0)return {tracks:structuredClone(a.tracks),interpolated:false,sampleTimeMs:a.timeMs};
  if(!b){
    if(dt>80)return empty;
    const tracks=structuredClone(a.tracks);
    tracks.forEach(track=>track.ageMs+=dt);
    return {tracks,interpolated:false,sampleTimeMs:a.timeMs};
  }
  if(b.timeMs-a.timeMs>REPLAY_STEP_MS+5)return empty;
  const alpha=dt/(b.timeMs-a.timeMs),next=new Map(b.tracks.map(track=>[track.id,track]));
  const tracks=a.tracks.flatMap(track=>{
    const target=next.get(track.id);if(!target||target.box.label!==track.box.label)return [];
    const out=structuredClone(track);
    for(const k of ['x0','x1','y0','y1'] as const)out.box[k]+=alpha*(target.box[k]-out.box[k]);
    // The rectangle joins two observations, so its evidence cannot be stronger
    // than either endpoint. Do not lend old motion to a known weak/reset sample
    // or borrow a newly acquired signal from the future endpoint.
    out.box.score=Math.min(track.box.score,target.box.score);
    out.motionConfidence=Math.min(track.motionConfidence,target.motionConfidence);
    if(target.opticalTtcS===null){out.opticalTtcS=null;out.motionConfidence=0;}
    if(target.rangeTtcS===null)out.rangeTtcS=null;
    if(target.closingSpeed===null)out.closingSpeed=null;
    // Range is the preceding measured sample, not a newly inferred distance.
    out.ageMs=dt;
    if(target.range.distanceM===null){
      out.range=structuredClone(target.range);out.status='unknown';
      out.closingSpeed=null;out.rangeTtcS=null;
    }
    return [out];
  });
  return {tracks,interpolated:true,sampleTimeMs:a.timeMs};
}

/** Wait for decoded seek completion. Aborts remove listeners and cannot advance a new source. */
export function seekDecoded(video:HTMLVideoElement,timeMs:number,signal:AbortSignal):Promise<void> {
  return new Promise((resolve,reject)=>{
    const finish=(error?:Error)=>{clearTimeout(timer);video.removeEventListener('seeked',check);video.removeEventListener('loadeddata',check);video.removeEventListener('error',failed);signal.removeEventListener('abort',aborted);error?reject(error):resolve();};
    const check=()=>{if(!video.seeking&&video.readyState>=2&&Math.abs(video.currentTime*1000-timeMs)<5)finish();};
    const aborted=()=>finish(new DOMException('Đã hủy phân tích','AbortError'));
    const failed=()=>finish(Error('Không giải mã được frame video.'));
    const timer=setTimeout(()=>finish(Error('Chờ frame video quá 10 giây.')),10000);
    video.addEventListener('seeked',check);video.addEventListener('loadeddata',check);video.addEventListener('error',failed);signal.addEventListener('abort',aborted,{once:true});
    if(signal.aborted){aborted();return;}
    try{video.currentTime=timeMs/1000;check();}catch(e){finish(e instanceof Error?e:Error(String(e)));}
  });
}
