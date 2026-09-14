import {parseProfile,type CameraProfile} from './geometry';

export interface ImageCrop {x:number;y:number;width:number;height:number;outputWidth:number;outputHeight:number}
/** K' = S * T_crop * K. Same physical lens, resize/crop only; optical zoom or
 * stabilization changing the principal point requires a fresh calibration. */
export function cropCameraProfile(profile:CameraProfile,crop:ImageCrop):CameraProfile {
  const p=parseProfile(profile),{x,y,width,height,outputWidth,outputHeight}=crop;
  if(![x,y,width,height,outputWidth,outputHeight].every(Number.isFinite)||x<0||y<0||width<=0||height<=0||
    x+width>p.width||y+height>p.height||!Number.isInteger(outputWidth)||!Number.isInteger(outputHeight)||outputWidth<=0||outputHeight<=0)throw Error('Crop/profile không hợp lệ.');
  const sx=outputWidth/width,sy=outputHeight/height;
  return parseProfile({...p,name:`${p.name} · crop`,width:outputWidth,height:outputHeight,
    fx:p.fx*sx,fy:p.fy*sy,cx:(p.cx-x)*sx,cy:(p.cy-y)*sy,pixelSigma:p.pixelSigma*Math.max(sx,sy)});
}

/** Pinhole square-pixel, centred crop helper. User must provide the actual
 * unzoomed horizontal field of view; this does not calibrate lens distortion. */
export function focalFromHorizontalFov(width:number,fovDeg:number,zoom:number):number {
  if(!Number.isInteger(width)||width<160||width>8192||!Number.isFinite(fovDeg)||fovDeg<15||fovDeg>=150||
    !Number.isFinite(zoom)||zoom<1||zoom>4)throw Error('Cần chiều rộng hợp lệ, góc nhìn ngang 15–149° và zoom 1–4×.');
  return width*zoom/(2*Math.tan(fovDeg*Math.PI/360));
}
