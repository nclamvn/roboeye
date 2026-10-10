import {unknownRange,type RangeEstimate} from './geometry';
import type {DetBox} from '../detection-types';
export interface RangeAnchor {u:number;v:number;zM:number;split:'fit'|'check'}
export interface AnchorProfile {
  schema:'drivesense-ground-anchors-v1';width:number;height:number;zoom:number;
  points:RangeAnchor[];coefficients:[number,number,number];rollFitted:boolean;
  minM:number;maxM:number;xDomain:[number,number];yDomain:[number,number];
  checkMAEM:number;checkMaxM:number;fitRMSEM:number;
  definition:'planar-ground-camera-forward';
}
/** Pinhole/planar-ground inverse depth is affine in image coordinates.
 * Measured forward reference metres provide scale; no guessed focal length,
 * vehicle width or phone model. This is a bounded approximation for ground
 * forward distance, not an empirically calibrated confidence distribution. */
function solve(matrix:number[][],rhs:number[]):number[]{
  const n=rhs.length,a=matrix.map((r,i)=>[...r,rhs[i]]);
  for(let k=0;k<n;k++){
    let pivot=k;for(let j=k+1;j<n;j++)if(Math.abs(a[j][k])>Math.abs(a[pivot][k]))pivot=j;
    if(Math.abs(a[pivot][k])<1e-10)throw Error('Các mốc không đủ độc lập để fit mặt đường.');
    [a[k],a[pivot]]=[a[pivot],a[k]];const d=a[k][k];for(let j=k;j<=n;j++)a[k][j]/=d;
    for(let i=0;i<n;i++)if(i!==k){const f=a[i][k];for(let j=k;j<=n;j++)a[i][j]-=f*a[k][j];}
  }return a.map(r=>r[n]);
}
export function fitAnchorProfile(width:number,height:number,zoom:number,points:RangeAnchor[]):AnchorProfile{
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<160||height<120||width>8192||height>8192||!Number.isFinite(zoom)||zoom<1||zoom>4)throw Error('Nguồn/zoom hiệu chuẩn không hợp lệ.');
  if(!Array.isArray(points)||points.length>64)throw Error('Tối đa 64 mốc.');
  for(const p of points)if(!p||![p.u,p.v,p.zM].every(Number.isFinite)||p.u<0||p.u>width||p.v<0||p.v>height||p.zM<2||p.zM>80||!['fit','check'].includes(p.split)||Object.keys(p).some(k=>!['u','v','zM','split'].includes(k)))throw Error('Mốc phải có u,v pixel và 2–80 m dọc phía trước đã đo.');
  const fit=points.filter(p=>p.split==='fit'),check=points.filter(p=>p.split==='check');
  if(fit.length<6||check.length<2)throw Error('Cần ít nhất 6 mốc fit và 2 mốc kiểm độc lập.');
  for(let i=0;i<points.length;i++)for(let j=0;j<i;j++)if(Math.hypot(points[i].u-points[j].u,points[i].v-points[j].v)<2)throw Error('Không dùng lại cùng điểm làm mốc fit/kiểm.');
  const minM=Math.min(...fit.map(p=>p.zM)),maxM=Math.max(...fit.map(p=>p.zM));
  if(maxM-minM<8||new Set(fit.map(p=>Math.round(p.zM))).size<3)throw Error('Mốc fit phải trải ≥8 m và ít nhất 3 khoảng cách.');
  const xs=fit.map(p=>p.u/width),ys=fit.map(p=>p.v/height);
  if(Math.max(...ys)-Math.min(...ys)<.035)throw Error('Các mốc quá sát cùng hàng ảnh; phép đo sẽ quá nhạy.');
  const rollFitted=Math.max(...xs)-Math.min(...xs)>=.12,n=rollFitted?3:2;
  const matrix=Array.from({length:n},()=>new Array(n).fill(0)),rhs=new Array(n).fill(0);
  // Weighted inverse-depth least squares approximates a metre-space fit. No
  // trimming references to hide bad calibration; every holdout must pass.
  for(const p of fit){const row=rollFitted?[p.u/width-.5,p.v/height,1]:[p.v/height,1],w=(p.zM/maxM)**4,target=1/p.zM;
    for(let i=0;i<n;i++){rhs[i]+=w*row[i]*target;for(let j=0;j<n;j++)matrix[i][j]+=w*row[i]*row[j];}}
  const solved=solve(matrix,rhs),coefficients:[number,number,number]=rollFitted?[solved[0],solved[1],solved[2]]:[0,solved[0],solved[1]];
  const [ax,ay,b]=coefficients;
  if(!coefficients.every(Number.isFinite)||ay<=0||Math.abs(ax/ay*height/width)>Math.tan(15*Math.PI/180))throw Error('Mặt đường/độ nghiêng không phù hợp mô hình pinhole phẳng.');
  const predict=(p:RangeAnchor)=>1/(ax*(p.u/width-.5)+ay*p.v/height+b);
  const fitErrors=fit.map(p=>predict(p)-p.zM),errors=check.map(p=>Math.abs(predict(p)-p.zM));
  if(points.some(p=>!Number.isFinite(predict(p))||predict(p)<=0)||check.some((p,i)=>errors[i]>Math.max(1,.15*p.zM)))throw Error('Mốc kiểm không đạt; không áp dụng hoặc công bố mét.');
  const fitRMSEM=Math.sqrt(fitErrors.reduce((s,e)=>s+e*e,0)/fit.length);
  if(fit.some((p,i)=>Math.abs(fitErrors[i])>Math.max(1,.15*p.zM)))throw Error('Mốc fit mâu thuẫn; kiểm tra khoảng cách và vị trí chân xe.');
  return {schema:'drivesense-ground-anchors-v1',width,height,zoom,points:structuredClone(points),coefficients,rollFitted,minM,maxM,
    xDomain:[Math.min(...xs),Math.max(...xs)],yDomain:[Math.min(...ys),Math.max(...ys)],
    checkMAEM:errors.reduce((s,e)=>s+e,0)/errors.length,checkMaxM:Math.max(...errors),fitRMSEM,definition:'planar-ground-camera-forward'};
}
/** Imported coefficients/error claims are never trusted: re-fit the references. */
export function parseAnchorProfile(value:unknown):AnchorProfile{
  if(!value||typeof value!=='object'||(value as AnchorProfile).schema!=='drivesense-ground-anchors-v1')throw Error('Sai schema mốc khoảng cách.');
  const p=value as AnchorProfile;return fitAnchorProfile(p.width,p.height,p.zoom,p.points);
}
export function estimateAnchorRange(box:DetBox,p:AnchorProfile,width:number,height:number,zoom:number):RangeEstimate{
  const fail=(reason:string)=>unknownRange(reason);
  if(width!==p.width||height!==p.height||zoom!==p.zoom)return fail('Mốc không đúng kích thước/zoom; hiệu chuẩn lại.');
  if(![box.x0,box.x1,box.y0,box.y1,box.score].every(Number.isFinite)||box.x0<=.01||box.x1>=.99||box.y0<=.01||box.y1>=.99||box.x1<=box.x0||box.y1<=box.y0)return fail('Xe bị cắt/box không hợp lệ; chưa đo theo mốc.');
  if((box.y1-box.y0)*height<18)return fail('Xe quá nhỏ để xác định chân xe.');
  const x=(box.x0+box.x1)/2,y=box.y1;
  if(x<p.xDomain[0]-.06||x>p.xDomain[1]+.06||y<p.yDomain[0]-.005||y>p.yDomain[1]+.005)return fail('Ngoài vùng mốc đã kiểm; thêm mốc tại vùng này.');
  const [ax,ay,b]=p.coefficients,inverse=ax*(x-.5)+ay*y+b,z=1/inverse;
  if(!Number.isFinite(z)||z<p.minM||z>p.maxM)return fail('Ngoài dải mét đã hiệu chuẩn theo mốc.');
  // Three model pixels expressed in the active (unpadded) content dimension.
  // Using 3/416 for both axes underestimates landscape vertical uncertainty.
  const ratio=Math.min(416/width,416/height),pixelY=Math.max(2/height,3/(height*ratio)),pixelX=Math.max(2/width,3/(width*ratio)),sigma=Math.hypot(.1*z,p.checkMAEM,p.fitRMSEM,z*z*Math.hypot(ax*pixelX,ay*pixelY));
  if(2*sigma/z>.5)return fail('Chân xe/mốc quá nhạy; chưa công bố mét.');
  return {kind:'ground_contact_forward_m',provenance:'ground-anchor-geometry',distanceM:z,lateralM:null,sigmaM:sigma,
    interval:[Math.max(0,z-2*sigma),z+2*sigma],intervalCalibrated:false,
    reason:'Theo mốc đã đo · giả định camera cố định/đường phẳng · chưa nghiệm thu thực địa'};
}
