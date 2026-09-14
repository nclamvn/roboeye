export const MOGE_SMALL = Object.freeze({
  id: 'Ruicheng/moge-2-vits-normal-onnx',
  revision: 'e50ffda41565591092adea54c6ac83d6212e1e23',
  sha256: '24eacb5dc7a2c54c7bc98f7de085ffbed79ad006ea5b664c2c2cdc02ff3a52f0',
  bytes: 140852051,
  weightsLicense: 'MIT (source MoGe-2 ViT-S Normal model card)',
  adapter: 'moge-affine-recovery-v1',
  unit: 'metres', distanceKind: 'optical-axis-z',
} as const);

export const DA2_METRIC = Object.freeze({
  id:'depth-anything/Depth-Anything-V2-Metric-Outdoor-Small-hf',
  revision:'fd2c22027eaf20374204f14099b8341e1925ad39',
  sourceWeightsSha256:'ad065c77a7421ca55159a1f0db9433397a607690f2d76bb8a6fc54b1be7a3124',
  sha256:'d5a9b987d5f71653827b02452675fa3bd781c9ac1a74bac84cfdc0870e55390b',bytes:99159817,
  adapter:'da2-metric-fixed-fixture-v1',width:224,height:280,
  unit:'metres',distanceKind:'optical-axis-z',scope:'fixed-shape-lab-only',
} as const);

export const DA2_DRIVE = Object.freeze({
  id:'depth-anything/Depth-Anything-V2-Metric-Outdoor-Small-hf',
  revision:'fd2c22027eaf20374204f14099b8341e1925ad39',
  sourceWeightsSha256:'ad065c77a7421ca55159a1f0db9433397a607690f2d76bb8a6fc54b1be7a3124',
  sha256:'dc868d88c5b97570f59863641092f7a517b85ef567de883a988d7df0e8b7250f',bytes:99159817,
  file:'da2-outdoor-392x224.onnx',adapter:'da2-outdoor-letterbox-roi-v1',width:392,height:224,maxDepthM:80,
  unit:'metres',distanceKind:'optical-axis-z',scope:'desktop-analysed-video-poc',
} as const);

export interface MetricMap {
  width: number; height: number; depth: Float32Array;
  unit: 'metres'; distanceKind: 'optical-axis-z';
  provenance: 'learned-unverified'; focal: number|null; shift: number|null; reprojectionRmse: number|null;
}

export function decodeDa2Metric(depth:Float32Array,width:number,height:number):MetricMap {
  if(!(depth instanceof Float32Array)||width!==DA2_METRIC.width||height!==DA2_METRIC.height||depth.length!==width*height)
    throw Error('DA2 metric chỉ được kiểm chứng ở shape fixture đã khóa.');
  if(depth.some(z=>!Number.isFinite(z)||z<=0||z>80.001))throw Error('DA2 metric ngoài hợp đồng (0,80 m].');
  return {depth:depth.slice(),width,height,unit:'metres',distanceKind:'optical-axis-z',provenance:'learned-unverified',focal:null,shift:null,reprojectionRmse:null};
}

export function decodeDa2DriveMetric(depth:Float32Array,width:number,height:number):MetricMap {
  if(!(depth instanceof Float32Array)||width!==DA2_DRIVE.width||height!==DA2_DRIVE.height||depth.length!==width*height)
    throw Error('DA2 Drive sai shape landscape đã khóa.');
  if(depth.some(z=>!Number.isFinite(z)||z<=0||z>DA2_DRIVE.maxDepthM+.001))throw Error('DA2 Drive ngoài hợp đồng (0,80 m].');
  return {depth:depth.slice(),width,height,unit:'metres',distanceKind:'optical-axis-z',provenance:'learned-unverified',focal:null,shift:null,reprojectionRmse:null};
}

export function assertMetricMap(map: MetricMap): void {
  if (map.unit !== 'metres' || map.distanceKind !== 'optical-axis-z' || !(map.depth instanceof Float32Array)
    || !Number.isInteger(map.width) || !Number.isInteger(map.height) || map.width < 1 || map.height < 1
    || map.width * map.height !== map.depth.length) throw Error('Không phải tensor metric Z hợp lệ.');
}

/** Lab point probe only. Not a vehicle distance estimator or confidence interval. */
export function probeMetric(map: MetricMap, u: number, v: number): number | null {
  assertMetricMap(map);
  if (![u,v].every(Number.isFinite) || u<0 || u>1 || v<0 || v>1) return null;
  const x=Math.min(map.width-1,Math.floor(u*map.width)),y=Math.min(map.height-1,Math.floor(v*map.height));
  const values:number[]=[];
  for(let j=Math.max(0,y-2);j<=Math.min(map.height-1,y+2);j++)
    for(let i=Math.max(0,x-2);i<=Math.min(map.width-1,x+2);i++) {
      const d=map.depth[j*map.width+i]; if(Number.isFinite(d)&&d>0)values.push(d);
    }
  return values.length>=5 ? values.sort((a,b)=>a-b)[Math.floor(values.length/2)] : null;
}

/** One in-flight request. Resets invalidate results without opening a second slot. */
export class MetricFrameGate {
  private epoch=0; private sequence=0;
  private pending: {id:number;epoch:number;capturedAt:number;mediaMs:number}|null=null;
  private lastMedia=-Infinity;
  begin(mediaMs:number,capturedAt:number) {
    if(this.pending||!Number.isFinite(mediaMs)||!Number.isFinite(capturedAt)||mediaMs===this.lastMedia)return null;
    this.lastMedia=mediaMs;
    return this.pending={id:++this.sequence,epoch:this.epoch,capturedAt,mediaMs};
  }
  reset(){this.epoch++;this.lastMedia=-Infinity;}
  cancel(){this.reset();this.pending=null;}
  finish(id:number,now:number,maxAgeMs:number) {
    const p=this.pending;if(!p||id!==p.id)return null;this.pending=null;
    if(p.epoch!==this.epoch||!Number.isFinite(now)||now<p.capturedAt||Number.isNaN(maxAgeMs)||maxAgeMs<0||now-p.capturedAt>maxAgeMs)return null;
    return {...p,ageMs:now-p.capturedAt};
  }
}
