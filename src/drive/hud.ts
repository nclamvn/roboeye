import type {RangeEstimate} from './geometry';
import type {RiskTrack,ThreatLevel} from './risk';

/** Display a real range estimate only; optical TTC must never fill this slot. */
export function hudDistance(range:Pick<RangeEstimate,'distanceM'|'provenance'>):string {
  const distance=range.distanceM;
  if(distance===null||!Number.isFinite(distance)||distance<=0)return 'Chưa đo';
  return `≈${Math.max(1,Math.round(distance))} m${range.provenance==='learned-unverified'?'*':''}`;
}

export function highlightThreat(id:number,primaryId:number|null,level:ThreatLevel):boolean {
  return id===primaryId&&(level==='caution'||level==='critical');
}

/** Reuse the risk engine's red gate, never promote proximity from box size. */
export function redThreat(threat:RiskTrack|null|undefined):boolean {
  return !!threat&&threat.inPath&&threat.level==='critical'&&
    Number.isFinite(threat.confidence)&&threat.confidence>=.52&&
    Number.isFinite(threat.track.ageMs)&&threat.track.ageMs>=0&&threat.track.ageMs<500&&
    threat.ttcAgreement!=='conflict';
}

export function hudWarning(threat:RiskTrack|null,active:boolean):string|null {
  if(!active||!threat||!redThreat(threat))return null;
  const distance=threat.track.range.distanceM;
  const measured=distance!==null&&Number.isFinite(distance)&&distance>0;
  const close=measured&&((threat.headwayS!==null&&threat.headwayS<=.8)||
    (threat.referenceDistanceM!==null&&distance<.45*threat.referenceDistanceM));
  return close?'Quá gần':'Nguy cơ cao';
}

export function playbackControl(paused:boolean,ended:boolean):{label:string;playing:boolean} {
  const playing=!paused&&!ended;
  return {label:playing?'Tạm dừng video':'Phát video',playing};
}

export interface HudState {
  source:'none'|'file'|'camera'|'demo';
  loading:boolean;analysing:boolean;replayReady:boolean;hasRange:boolean;
}

export function hudMode(state:HudState):string {
  if(state.source==='none')return 'Chọn nguồn';
  if(state.source==='demo')return 'Mẫu dựng · không phải AI';
  if(state.analysing)return 'Đang phân tích';
  if(state.source==='file'&&state.replayReady)return 'Phát lại đã phân tích';
  if(state.loading)return 'Đang tải AI';
  if(state.source==='camera')return state.hasRange?'Camera · PoC':'Camera · chưa đo mét';
  return 'Video · chưa có kết quả';
}
