import type { DetectionErrorStage } from './detection-types';

export interface DetectionErrorRecovery {
  ready: boolean;
  busy: false;
  status: string;
}

export function recoverDetectionError(stage: DetectionErrorStage): DetectionErrorRecovery {
  if (stage === 'infer') {
    return { ready: true, busy: false, status: 'lỗi frame · đang thử lại' };
  }
  return { ready: false, busy: false, status: 'lỗi tải model' };
}
