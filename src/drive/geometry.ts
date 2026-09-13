import type { DetBox } from '../detection-types';

export interface CameraProfile {
  version: 1;
  name: string;
  width: number; height: number;
  fx: number; fy: number; cx: number; cy: number;
  distortion: [number, number, number, number, number]; // k1,k2,p1,p2,k3
  heightM: number; pitchDeg: number; rollDeg: number;
  pixelSigma: number; heightSigmaM: number; pitchSigmaDeg: number; focalSigmaFraction: number;
  minM: number; maxM: number;
}
export interface RangeEstimate {
  kind: 'ground_contact_forward_m';
  distanceM: number | null;
  lateralM: number | null;
  sigmaM: number | null;
  interval: [number, number] | null;
  intervalCalibrated: false;
  reason: string;
}
export const unknownRange = (reason: string): RangeEstimate => ({ kind: 'ground_contact_forward_m',
  distanceM: null, lateralM: null, sigmaM: null, interval: null, intervalCalibrated: false, reason });

export function parseProfile(value: unknown): CameraProfile {
  if (!value || typeof value !== 'object') throw Error('Profile phải là JSON object.');
  const p = value as CameraProfile;
  if (p.version !== 1 || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 120) throw Error('Profile thiếu version/name hợp lệ.');
  const limits: Array<[keyof CameraProfile, number, number]> = [
    ['width',160,8192],['height',120,8192],['fx',50,20000],['fy',50,20000],
    ['cx',0,p.width],['cy',0,p.height],['heightM',.4,4],['pitchDeg',-20,30],['rollDeg',-15,15],
    ['pixelSigma',1,30],['heightSigmaM',.005,.5],['pitchSigmaDeg',.05,5],
    ['focalSigmaFraction',.001,.2],['minM',2,20],['maxM',10,100]
  ];
  for (const [key,min,max] of limits) if (typeof p[key] !== 'number' || !Number.isFinite(p[key]) || Number(p[key])<min || Number(p[key])>max) throw Error(`Profile: ${key} ngoài giới hạn.`);
  if (!Number.isInteger(p.width) || !Number.isInteger(p.height) || p.maxM<=p.minM) throw Error('Kích thước/range profile không hợp lệ.');
  if (!Array.isArray(p.distortion) || p.distortion.length!==5 || !p.distortion.every(x=>Number.isFinite(x)&&Math.abs(x)<=2)) throw Error('Distortion cần 5 hệ số k1,k2,p1,p2,k3. Fisheye chưa hỗ trợ.');
  return structuredClone(p);
}

export function distort(x:number,y:number,d:CameraProfile['distortion']): [number,number] {
  const [k1,k2,p1,p2,k3]=d, r2=x*x+y*y, radial=1+k1*r2+k2*r2*r2+k3*r2*r2*r2;
  return [x*radial+2*p1*x*y+p2*(r2+2*x*x),y*radial+p1*(r2+2*y*y)+2*p2*x*y];
}

/** Invert Brown–Conrady with Newton steps, rejecting non-convergence/folded local maps. */
export function undistort(u:number,v:number,p:CameraProfile): [number,number] | null {
  const tx=(u-p.cx)/p.fx, ty=(v-p.cy)/p.fy;
  let x=tx,y=ty;
  for(let i=0;i<15;i++) {
    const [a,b]=distort(x,y,p.distortion), ex=a-tx, ey=b-ty;
    const eps=1e-5, dx=distort(x+eps,y,p.distortion), dy=distort(x,y+eps,p.distortion);
    const j00=(dx[0]-a)/eps,j01=(dy[0]-a)/eps,j10=(dx[1]-b)/eps,j11=(dy[1]-b)/eps;
    const det=j00*j11-j01*j10;
    if(!Number.isFinite(det)||det<=1e-8) return null;
    if(Math.hypot(ex,ey)<1e-8) return [x,y];
    x-=(j11*ex-j01*ey)/det; y-=(-j10*ex+j00*ey)/det;
    if(!Number.isFinite(x+y)||Math.hypot(x,y)>4) return null;
  }
  return null;
}

/** Camera x-right/y-down/z-forward. Positive pitch looks down; ground plane y=height. */
export function groundPoint(u:number,v:number,p:CameraProfile): {x:number;z:number} | null {
  const uv=undistort(u,v,p); if(!uv) return null;
  const roll=p.rollDeg*Math.PI/180,pitch=p.pitchDeg*Math.PI/180;
  const x=Math.cos(roll)*uv[0]-Math.sin(roll)*uv[1];
  const y0=Math.sin(roll)*uv[0]+Math.cos(roll)*uv[1];
  const y=Math.cos(pitch)*y0+Math.sin(pitch),z=Math.cos(pitch)-Math.sin(pitch)*y0;
  if(y<=.005||z<=0) return null;
  return {x:p.heightM*x/y,z:p.heightM*z/y};
}

export function estimateGroundRange(box:DetBox,p:CameraProfile|null,width:number,height:number): RangeEstimate {
  if(!p) return unknownRange('Chưa hiệu chuẩn');
  if(width!==p.width||height!==p.height) return unknownRange('Sai kích thước calibration');
  if(![box.x0,box.y0,box.x1,box.y1,box.score].every(Number.isFinite)||box.x1<=box.x0||box.y1<=box.y0) return unknownRange('Box không hợp lệ');
  if(box.x0<.01||box.x1>.99||box.y0<.01||box.y1>.99) return unknownRange('Xe bị cắt ở biên');
  if((box.y1-box.y0)*height<18) return unknownRange('Xe quá nhỏ để đo');
  const u=(box.x0+box.x1)*width/2,v=box.y1*height;
  const hit=groundPoint(u,v,p);
  if(!hit) return unknownRange('Không thấy giao điểm mặt đường');
  if(hit.z<p.minM||hit.z>p.maxM) return unknownRange('Ngoài phạm vi thử nghiệm');
  // First-order finite differences, with bbox contact-model error floor. These are
  // sensitivity bounds, NOT an empirically calibrated probability interval.
  const offsets:Array<[CameraProfile,number,number]> = [
    [p,u+p.pixelSigma,v],[p,u,v+Math.max(p.pixelSigma,.02*(box.y1-box.y0)*height)],
    [{...p,heightM:p.heightM+p.heightSigmaM},u,v],
    [{...p,pitchDeg:p.pitchDeg+p.pitchSigmaDeg},u,v],
    [{...p,fx:p.fx*(1+p.focalSigmaFraction),fy:p.fy*(1+p.focalSigmaFraction)},u,v]
  ];
  let variance=(.1*hit.z)**2; // bbox bottom is only a proxy, often not a tyre contact.
  for(const [profile,pu,pv] of offsets) {
    const q=groundPoint(pu,pv,profile);
    if(!q) return unknownRange('Quá nhạy với sai số calibration');
    variance+=(q.z-hit.z)**2;
  }
  const sigma=Math.sqrt(variance);
  if(2*sigma/hit.z>.5) return unknownRange('Độ bất định quá lớn');
  return {kind:'ground_contact_forward_m',distanceM:hit.z,lateralM:hit.x,sigmaM:sigma,
    interval:[Math.max(0,hit.z-2*sigma),hit.z+2*sigma],intervalCalibrated:false,
    reason:'Ước lượng chân xe; giả định đường phẳng, không phải khoảng hở cản xe'};
}

export interface GroundControl { u:number; v:number; zM:number; split:'fit'|'check' }
export interface Refinement { profile:CameraProfile; fitCount:number; checkCount:number; checkMAE:number; checkMax:number }
/** Huber IRLS/Gauss–Newton for mount height/pitch, not a replacement for lens calibration. */
export function refineMount(profile:CameraProfile,points:GroundControl[]): Refinement {
  parseProfile(profile);
  if(!Array.isArray(points)||points.length>200) throw Error('Cần danh sách điểm đo (tối đa 200).');
  for(const q of points) if(!q||![q.u,q.v,q.zM].every(Number.isFinite)||q.u<0||q.u>profile.width||q.v<0||q.v>profile.height||q.zM<2||q.zM>100||!['fit','check'].includes(q.split)) throw Error('Điểm đối chứng không hợp lệ.');
  const fit=points.filter(p=>p.split==='fit'),check=points.filter(p=>p.split==='check');
  if(fit.length<6||check.length<2) throw Error('Cần ít nhất 6 điểm fit và 2 điểm check độc lập.');
  if(Math.max(...fit.map(p=>p.zM))-Math.min(...fit.map(p=>p.zM))<8) throw Error('Điểm fit phải trải ít nhất 8 m, không cùng một khoảng cách.');
  if(check.some(a=>fit.some(b=>Math.hypot(a.u-b.u,a.v-b.v)<1))) throw Error('Không dùng lại điểm fit làm holdout.');
  let p=structuredClone(profile);
  for(let iter=0;iter<30;iter++) {
    let aa=1e-5,ab=0,bb=1e-5,ar=0,br=0,n=0;
    for(const q of fit) {
      const z=groundPoint(q.u,q.v,p)?.z;
      const zh=groundPoint(q.u,q.v,{...p,heightM:p.heightM+.001})?.z;
      const zp=groundPoint(q.u,q.v,{...p,pitchDeg:p.pitchDeg+.001})?.z;
      if(z===undefined||zh===undefined||zp===undefined) continue;
      const residual=q.zM-z,w=Math.min(1,1/Math.max(Math.abs(residual),1e-8));
      const a=(zh-z)/.001,b=(zp-z)/.001;
      aa+=w*a*a;ab+=w*a*b;bb+=w*b*b;ar+=w*a*residual;br+=w*b*residual;n++;
    }
    const det=aa*bb-ab*ab;
    if(n<6||det<1e-8) throw Error('Không đủ hình học để fit; kiểm tra pitch ban đầu.');
    const dh=Math.max(-.1,Math.min(.1,(ar*bb-br*ab)/det));
    const dp=Math.max(-.5,Math.min(.5,(br*aa-ar*ab)/det));
    p.heightM=Math.max(.4,Math.min(4,p.heightM+dh));p.pitchDeg=Math.max(-20,Math.min(30,p.pitchDeg+dp));
    if(Math.abs(dh)+Math.abs(dp)<1e-6) break;
  }
  const errors=check.map(q=>Math.abs((groundPoint(q.u,q.v,p)?.z??Infinity)-q.zM));
  if(errors.some((e,i)=>!Number.isFinite(e)||e>Math.max(2,.2*check[i].zM))) throw Error('Holdout không đạt: không áp dụng calibration.');
  return {profile:parseProfile(p),fitCount:fit.length,checkCount:check.length,
    checkMAE:errors.reduce((a,b)=>a+b,0)/errors.length,checkMax:Math.max(...errors)};
}
