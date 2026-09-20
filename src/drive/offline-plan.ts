import {sampleTimes} from './replay';

export type OfflinePreset='quality'|'balanced'|'fast';
export const OFFLINE_PRESETS={
  quality:{stepMs:200,label:'Chi tiết · 5 mẫu/giây'},
  balanced:{stepMs:400,label:'Cân bằng · 2,5 mẫu/giây'},
  fast:{stepMs:1000,label:'Nhanh · 1 mẫu/giây'}
} as const;

export function offlinePlan(durationMs:number,preset:OfflinePreset){
  const config=OFFLINE_PRESETS[preset];if(!config)throw Error('Chế độ phân tích không hợp lệ.');
  const times=sampleTimes(durationMs,config.stepMs);
  return {preset,stepMs:config.stepMs,samplesPerSecond:1000/config.stepMs,times,
    disclosure:preset==='quality'?'Giữ mật độ cũ; chậm nhất.':preset==='balanced'?'Giảm một nửa số inference so với chế độ Chi tiết.':'Ưu tiên tốc độ; có thể bỏ lỡ sự kiện ngắn.'};
}
