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
    // Threshold được chốt bằng T14 benchmark. Track-level confirmation bên dưới
    // xử lý nhiễu theo thời gian mà không hy sinh recall của vật đang chuyển động.
    threshold: 0.45
  },
  owlvit: {
    model: 'Xenova/owlvit-base-patch32',
    revision: 'b75f4e52949639c3bb0b96546ea4149482f6e7ef',
    wasmDtype: 'q8',
    // OWL-ViT cần threshold thấp hơn RT-DETR; NMS + xác nhận theo thời gian
    // loại kết quả chớp nhoáng sau khi nhận model output.
    threshold: 0.08
  }
};
