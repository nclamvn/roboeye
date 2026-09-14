import type {MetricMap} from './metric-contract';

/** Variable-projection least squares, matching MoGe's focal/shift objective.
 * Equations: https://github.com/microsoft/MoGe/blob/main/moge/utils/geometry_numpy.py
 * This implementation uses deterministic strided samples, not upstream masked resize.
 * Never interpret raw ONNX affine Z as metres. */
export function recoverMetric(points:Float32Array,mask:Float32Array,width:number,height:number,scale:number):MetricMap {
  const n=width*height;
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<2||height<2||n>4000000
    ||points.length!==n*3||mask.length!==n||!Number.isFinite(scale)||scale<=0)throw Error('Sai hợp đồng MoGe points/mask/scale.');
  const samples:Array<[number,number,number,number,number]>=[],diagonal=Math.hypot(width,height);
  const stride=Math.max(1,Math.ceil(n/4096));
  for(let k=0;k<n;k+=stride){
    const x=points[3*k],y=points[3*k+1],z=points[3*k+2];
    if(mask[k]>.5&&[x,y,z].every(Number.isFinite))samples.push([x,y,z,(2*(k%width)+1-width)/diagonal,(2*Math.floor(k/width)+1-height)/diagonal]);
  }
  if(samples.length<32)throw Error('Không đủ điểm hợp lệ để phục hồi camera.');
  function objective(s:number) {
    let a=0,b=0,ap=0,bp=0;
    for(const [x,y,z,u,v] of samples){const d=z+s;if(Math.abs(d)<1e-8)return null;const q=x*u+y*v,t=x*x+y*y;
      a+=q/d;b+=t/(d*d);ap-=q/(d*d);bp-=2*t/(d*d*d);}
    if(b<1e-12)return null;
    const f=a/b,fp=(ap*b-a*bp)/(b*b);if(!Number.isFinite(f)||f<=0)return null;
    let cost=0,jj=0,jr=0;
    for(const [x,y,z,u,v] of samples){const d=z+s;
      for(const [xy,uv] of [[x,u],[y,v]]){const r=f*xy/d-uv,j=fp*xy/d-f*xy/(d*d);cost+=r*r;jj+=j*j;jr+=j*r;}}
    return {f,cost,jj,jr};
  }
  // Linear projection provides an additional initialization, not the final estimator.
  let aa=0,ab=0,bb=0,ac=0,bc=0;
  for(const [x,y,z,u,v] of samples){aa+=x*x+y*y;ab-=x*u+y*v;bb+=u*u+v*v;ac+=(x*u+y*v)*z;bc-=(u*u+v*v)*z;}
  const det=aa*bb-ab*ab;
  if(Math.abs(det)<1e-12*Math.max(1,aa*bb))throw Error('Hình học suy biến: không xác định được focal/shift.');
  const seed=(aa*bc-ab*ac)/det;
  let best:{s:number;f:number;cost:number}|null=null;
  for(const initial of [0,seed]){
    let s=initial,o=objective(s),lambda=1e-3;if(!o)continue;
    for(let iteration=0;iteration<60;iteration++){
      const step=-o.jr/(o.jj*(1+lambda)+1e-12),candidate=objective(s+step);
      if(candidate&&candidate.cost<o.cost){s+=step;o=candidate;lambda=Math.max(1e-9,lambda/3);if(Math.abs(step)<1e-7*(1+Math.abs(s)))break;}
      else {lambda*=10;if(lambda>1e12)break;}
    }
    if(!best||o.cost<best.cost)best={s,f:o.f,cost:o.cost};
  }
  if(!best||!Number.isFinite(best.s)||best.f<.05||best.f>20)throw Error('Phục hồi camera không hợp lệ.');
  const rmse=Math.sqrt(best.cost/(2*samples.length));
  if(rmse>.1)throw Error('Điểm 3D không khớp phép chiếu camera.');
  const depth=new Float32Array(n);depth.fill(NaN);
  for(let k=0;k<n;k++){const z=(points[3*k+2]+best.s)*scale;if(mask[k]>.5&&Number.isFinite(points[3*k])&&Number.isFinite(points[3*k+1])&&Number.isFinite(z)&&z>0)depth[k]=z;}
  return {width,height,depth,unit:'metres',distanceKind:'optical-axis-z',provenance:'learned-unverified',focal:best.f,shift:best.s,reprojectionRmse:rmse};
}
