import type { DetectionEngine } from './detection-types';

export interface DetectionEngineConfig {
  model: string;
  revision: string;
  wasmDtype: 'q8';
  threshold: number;
}

export const DETECTION_CONFIG: Record<DetectionEngine, DetectionEngineConfig> = {
  rtdetr: {
    model: 'onnx-community/rtdetr_v2_r18vd-ONNX',
    revision: '936f90b6a476c6da4dfe053fc521af55285976ba',
    wasmDtype: 'q8',
    // Nâng 0.45 → 0.55: chặn dương tính giả (giơ tay lóe thành "person" thứ hai).
    threshold: 0.55
  },
  owlvit: {
    model: 'Xenova/owlvit-base-patch32',
    revision: 'b75f4e52949639c3bb0b96546ea4149482f6e7ef',
    wasmDtype: 'q8',
    // Nâng 0.08 → 0.20: 0.08 quá thấp, vật mờ/tay cũng lọt thành box rác.
    threshold: 0.20
  }
};
