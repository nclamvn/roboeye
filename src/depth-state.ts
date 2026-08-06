import type { DepthErrorStage } from './types';

export interface DepthErrorRecovery {
  ready: boolean;
  busy: false;
  retry: boolean;
  status: string;
}

export function recoverDepthError(stage: DepthErrorStage): DepthErrorRecovery {
  if (stage === 'infer') {
    return {
      ready: true,
      busy: false,
      retry: false,
      status: 'Khung depth lỗi · đang thử frame tiếp theo'
    };
  }
  return {
    ready: false,
    busy: false,
    retry: true,
    status: 'Model depth chưa tải được'
  };
}
