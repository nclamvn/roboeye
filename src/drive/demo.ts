import type { DetBox } from '../detection-types';
import type { CameraProfile } from './geometry';

// Independent ideal pinhole projection. Synthetic is never a camera quality claim.
export const DEMO_PROFILE:CameraProfile={version:1,name:'Synthetic pinhole only',width:1280,height:720,
  fx:900,fy:900,cx:640,cy:360,distortion:[0,0,0,0,0],heightM:1.4,pitchDeg:0,rollDeg:0,
  pixelSigma:3,heightSigmaM:.02,pitchSigmaDeg:.1,focalSigmaFraction:.01,minM:5,maxM:50};
export function demoFrame(timeMs:number):{boxes:DetBox[];truth:number[]} {
  const z=24+10*Math.cos(timeMs/4500),sideZ=34-4*Math.sin(timeMs/6000);
  const truth=[z,sideZ];
  const boxes=truth.map((d,i)=>{
    const x=i===0?.3:3.8;
    return {label:i===0?'car':'truck',score:.97,x0:(640+900*(x-.95)/d)/1280,
      x1:(640+900*(x+.95)/d)/1280,y0:(360+900*(1.4-(i===0?1.5:2.4))/d)/720,
      y1:(360+900*1.4/d)/720};
  });
  return {boxes,truth};
}
