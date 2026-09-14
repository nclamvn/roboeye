export const DRIVE_GPU_DETECTOR=Object.freeze({
  id:'onnx-community/rtdetr_v2_r18vd-ONNX',revision:'936f90b6a476c6da4dfe053fc521af55285976ba',
  sourceSha256:'583a236ac21c95a7fd94f284fc21485e42355bfef82c27011ba78fbc09ee87e2',
  sha256:'86171edeb435bd3f113e82d1c6720a576932e6deca962426bb1bc794e7000458',bytes:81033458,
  file:'rtdetr-r18-640-webgpu.onnx',width:640,height:640,dtype:'fp32',
  adapter:'rtdetr-r18-static-equivalent-averagepool-v1',license:'Apache-2.0',
} as const);
export const DRIVE_CLASS_LABELS:Readonly<Record<number,string>>=Object.freeze({2:'car',5:'bus',7:'truck'});

/** The pinned HF processor rescales RGB to [0,1], stretches to 640x640 and does
 * NOT apply ImageNet normalization. All channels/finite shape validated. */
export function detectorRgbPlanes(rgba:Uint8ClampedArray):Float32Array {
  const plane=DRIVE_GPU_DETECTOR.width*DRIVE_GPU_DETECTOR.height;
  if(rgba.length!==plane*4)throw Error('RT-DETR sai RGBA 640×640.');
  const rgb=new Float32Array(plane*3);
  for(let i=0,j=0;i<plane;i++,j+=4){rgb[i]=rgba[j]/255;rgb[plane+i]=rgba[j+1]/255;rgb[2*plane+i]=rgba[j+2]/255;}
  return rgb;
}
