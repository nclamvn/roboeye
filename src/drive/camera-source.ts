export interface CameraChoice { deviceId: string; label: string }

export function cameraChoices(devices:ReadonlyArray<Pick<MediaDeviceInfo,'kind'|'deviceId'|'label'>>):CameraChoice[]{
  const seen=new Set<string>(),out:CameraChoice[]=[];
  for(const device of devices){
    if(device.kind!=='videoinput'||!device.deviceId||seen.has(device.deviceId))continue;
    seen.add(device.deviceId);out.push({deviceId:device.deviceId,label:device.label.trim()||`Camera ${out.length+1}`});
  }
  return out;
}

export function cameraConstraints(deviceId:string):MediaStreamConstraints {
  const common={width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30,max:60}};
  return {video:deviceId?{...common,deviceId:{exact:deviceId}}:{...common,facingMode:{ideal:'environment'}},audio:false};
}
