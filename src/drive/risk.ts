import type {DriveTrack} from './tracking';

export type ThreatLevel='clear'|'monitor'|'caution'|'critical';
export type RiskEvidenceMode='live'|'analysed-replay'|'synthetic';

export interface RiskConfig {
  speedKph:number;
  adverse:boolean;
}

export interface RiskTrack {
  track:DriveTrack;
  inPath:boolean;
  pathScore:number;
  ttcS:number|null;
  ttcAgreement:'none'|'single'|'agree'|'conflict';
  headwayS:number|null;
  referenceDistanceM:number|null;
  confidence:number;
  level:ThreatLevel;
  reason:string;
  score:number;
}

export interface RiskSnapshot {
  evidenceMode:RiskEvidenceMode;
  tracks:RiskTrack[];
  primary:RiskTrack|null;
  referenceDistanceM:number|null;
  referenceLabel:string;
}

const clamp=(value:number,min=0,max=1)=>Math.max(min,Math.min(max,value));

/** Statutory dry/good-condition distance table from Vietnam TT 38/2024.
 * Below 60 km/h the regulation requires a suitable distance but does not give
 * one fixed value, so this function deliberately abstains.
 */
export function statutoryDistanceM(speedKph:number):number|null {
  if(!Number.isFinite(speedKph)||speedKph<60||speedKph>120)return null;
  if(speedKph===60)return 35;
  if(speedKph<=80)return 55;
  if(speedKph<=100)return 70;
  return 100;
}

export function corridorHalfWidth(y:number):number {
  const progress=clamp((y-.42)/.58);
  return .055+.39*progress;
}

export function pathEvidence(track:DriveTrack):{inPath:boolean;score:number} {
  const center=(track.box.x0+track.box.x1)/2,bottom=track.box.y1,half=corridorHalfWidth(bottom);
  const overlap=Math.max(0,Math.min(track.box.x1,.5+half)-Math.max(track.box.x0,.5-half));
  const overlapRatio=overlap/Math.max(1e-6,track.box.x1-track.box.x0);
  const centerScore=clamp(1-Math.abs(center-.5)/(half+.08));
  const score=clamp(.65*centerScore+.35*overlapRatio);
  return {inPath:overlapRatio>=.18&&score>=.35,score};
}

function fuseTtc(track:DriveTrack):{ttcS:number|null;agreement:RiskTrack['ttcAgreement'];confidence:number} {
  const candidates=[track.opticalTtcS,track.rangeTtcS].filter((value):value is number=>value!==null&&Number.isFinite(value)&&value>.2&&value<=30);
  if(!candidates.length)return {ttcS:null,agreement:'none',confidence:0};
  if(candidates.length===1)return {ttcS:candidates[0],agreement:'single',confidence:track.opticalTtcS!==null?track.motionConfidence:.62};
  const low=Math.min(...candidates),high=Math.max(...candidates),ratio=high/low;
  if(ratio>2.2)return {ttcS:low,agreement:'conflict',confidence:.32};
  return {ttcS:2/(1/candidates[0]+1/candidates[1]),agreement:'agree',confidence:clamp(.7+.2*track.motionConfidence)};
}

export function assessRisk(tracks:DriveTrack[],config:RiskConfig,evidenceMode:RiskEvidenceMode='live'):RiskSnapshot {
  const speed=Number.isFinite(config.speedKph)?clamp(config.speedKph,0,120):0;
  const statutory=statutoryDistanceM(speed);
  // The 25% adverse multiplier is an engineering presentation buffer, not a
  // legal value. TT38 only says the distance must be greater in bad conditions.
  const reference=statutory===null?null:statutory*(config.adverse?1.25:1);
  const speedMps=speed/3.6;
  const assessed=tracks.map(track=>{
    const path=pathEvidence(track),fused=fuseTtc(track),distance=track.range.distanceM;
    const headway=distance!==null&&speedMps>1?distance/speedMps:null;
    // Replay is already analysed at 200 ms intervals. Age here is an offset
    // inside that recorded interval, not live sensor delay. Decaying confidence
    // on each rendered frame makes a stable risk cross the red gate at 5 Hz.
    // Keep sampled evidence constant only within the bounded replay window;
    // missing/invalid tracks still disappear in replayAt, and live age decays.
    const sampleWindowMs=evidenceMode==='synthetic'?105:205;
    const sampledAgeValid=Number.isFinite(track.ageMs)&&track.ageMs>=0&&track.ageMs<=sampleWindowMs;
    const freshness=evidenceMode==='live'?clamp(1-track.ageMs/500):(sampledAgeValid?1:0);
    const rangeQuality=distance===null||track.range.sigmaM===null?0:clamp(1-track.range.sigmaM/Math.max(1,distance));
    let confidence=clamp(track.box.score*freshness*(.45+.35*fused.confidence+.2*rangeQuality));
    if(fused.agreement==='conflict')confidence=Math.min(confidence,.39);
    let level:ThreatLevel='monitor',reason='Đang bám trong hành lang ước lượng';
    if(!path.inPath){level='clear';reason='Ngoài hành lang chạy ước lượng';}
    else {
      const severeTtc=fused.ttcS!==null&&fused.ttcS<=1.5;
      const warningTtc=fused.ttcS!==null&&fused.ttcS<=3.5;
      const severeHeadway=headway!==null&&headway<=.8;
      const warningHeadway=headway!==null&&headway<=1.8;
      const severeGap=reference!==null&&distance!==null&&distance<.45*reference;
      const warningGap=reference!==null&&distance!==null&&distance<reference;
      if((severeTtc||severeHeadway||severeGap)&&confidence>=.52&&fused.agreement!=='conflict'){
        level='critical';reason=severeTtc?'TTC rất ngắn':severeHeadway?'Time-headway rất ngắn':'Dưới xa mốc khoảng cách theo tốc độ';
      }else if(warningTtc||warningHeadway||warningGap){
        level='caution';reason=fused.agreement==='conflict'?'Các tín hiệu TTC bất đồng — cần xác nhận':warningTtc?'TTC đang giảm':warningHeadway?'Time-headway thấp':'Dưới mốc tham chiếu theo tốc độ';
      }
      if(confidence<.28&&level==='critical'){level='caution';reason='Bằng chứng nguy cơ yếu — không nâng cảnh báo đỏ';}
    }
    const levelWeight={clear:0,monitor:1,caution:3,critical:6}[level];
    const urgency=fused.ttcS===null?0:clamp((6-fused.ttcS)/6);
    const score=levelWeight*10+path.score*4+urgency*6+(distance===null?0:clamp((80-distance)/80));
    return {track,inPath:path.inPath,pathScore:path.score,ttcS:fused.ttcS,ttcAgreement:fused.agreement,headwayS:headway,referenceDistanceM:reference,confidence,level,reason,score} satisfies RiskTrack;
  });
  const primary=assessed.filter(item=>item.inPath).sort((a,b)=>b.score-a.score||a.track.id-b.track.id)[0]??null;
  return {evidenceMode,tracks:assessed,primary,referenceDistanceM:reference,
    referenceLabel:statutory===null?'Chưa có mốc cố định':config.adverse?'TT38 + biên thử nghiệm 25%':'TT38 · điều kiện tốt'};
}
