export type RoadTask = 'lane-marking' | 'drivable-area' | 'physical-boundary' | 'vehicle-detection';
export type RightsState = 'verified-commercial' | 'commercial-license-required' | 'research-only' | 'unknown';
export type WebReadiness = 'verified-local-onnx' | 'documented-onnx-export' | 'native-only' | 'unverified';

export interface RoadEvidenceRef {
  id: string;
  url: string;
  capturedAt: string;
  tier: 'A' | 'B' | 'C';
  claim: string;
}

export interface RightsEvidence {
  state: RightsState;
  label: string;
  evidenceRefId: string | null;
}

export interface TrainingDatasetEvidence extends RightsEvidence {
  name: string;
}

export interface RoadModelCandidate {
  id: string;
  name: string;
  repository: string;
  tasks: RoadTask[];
  codeRights: RightsEvidence;
  weightsRights: RightsEvidence;
  trainingDatasets: TrainingDatasetEvidence[];
  pinnedRevision: string | null;
  weightsSha256: string | null;
  webReadiness: WebReadiness;
  evidenceRefIds: string[];
  sourceReportedProfile: string;
}

export const ROAD_EVIDENCE_REFS: readonly RoadEvidenceRef[] = Object.freeze([
  { id: 'yolopv2-repo', url: 'https://github.com/CAIC-AD/YOLOPv2', capturedAt: '2026-09-17', tier: 'A', claim: 'Official repository: MIT code, BDD100K, detection + drivable area + lane heads.' },
  { id: 'ufldv2-repo', url: 'https://github.com/cfzd/Ultra-Fast-Lane-Detection-v2', capturedAt: '2026-09-17', tier: 'A', claim: 'Official repository: MIT code, CULane/Tusimple/CurveLanes weights and ONNX export route.' },
  { id: 'clrernet-repo', url: 'https://github.com/hirotomusiker/CLRerNet', capturedAt: '2026-09-17', tier: 'A', claim: 'Official repository: Apache-2.0 code, CULane weights and source-reported F1/GFLOPs.' },
  { id: 'pidnet-repo', url: 'https://github.com/XuJiacong/PIDNet', capturedAt: '2026-09-17', tier: 'A', claim: 'Official repository: MIT code, Cityscapes/CamVid road-scene segmentation weights and RTX 3090 speed context.' },
  { id: 'bdd100k-license', url: 'https://github.com/bdd100k/bdd100k/blob/master/doc/source/license.rst', capturedAt: '2026-09-17', tier: 'A', claim: 'Official data terms limit general use to education/research/non-profit; commercial rights require membership or licensing.' },
  { id: 'ort-web', url: 'https://onnxruntime.ai/docs/tutorials/web/', capturedAt: '2026-09-17', tier: 'A', claim: 'Official ORT Web docs: browser ONNX inference; WASM supports all operators while GPU providers support subsets.' },
  { id: 'openvino-road-readme', url: 'https://github.com/openvinotoolkit/open_model_zoo/blob/6697dead54ed1cdd664b0313189c2cb52ee6335e/models/intel/road-segmentation-adas-0001/README.md', capturedAt: '2026-09-17', tier: 'A', claim: 'Pinned official model card: four-class BG/road/curb/mark segmentation, fixed tensor shapes and source-reported profile.' },
  { id: 'openvino-road-model', url: 'https://github.com/openvinotoolkit/open_model_zoo/blob/6697dead54ed1cdd664b0313189c2cb52ee6335e/models/intel/road-segmentation-adas-0001/model.yml', capturedAt: '2026-09-17', tier: 'A', claim: 'Pinned official manifest: source files, byte sizes, SHA-384 checksums and Apache-2.0 licence pointer.' },
  { id: 'openvino-license', url: 'https://github.com/openvinotoolkit/open_model_zoo/blob/6697dead54ed1cdd664b0313189c2cb52ee6335e/LICENSE', capturedAt: '2026-09-17', tier: 'A', claim: 'Pinned official Apache License 2.0 text for Open Model Zoo work.' },
]);

const permissive = (label: string, evidenceRefId: string): RightsEvidence => ({ state: 'verified-commercial', label, evidenceRefId });
const unknown = (label: string): RightsEvidence => ({ state: 'unknown', label, evidenceRefId: null });

export const ROAD_MODEL_CANDIDATES: readonly RoadModelCandidate[] = Object.freeze([
  {
    id: 'yolopv2-bdd100k', name: 'YOLOPv2', repository: 'https://github.com/CAIC-AD/YOLOPv2',
    tasks: ['vehicle-detection', 'drivable-area', 'lane-marking'], codeRights: permissive('MIT', 'yolopv2-repo'),
    weightsRights: unknown('Repository publishes trained weights, but commercial weight rights are not separately verified.'),
    trainingDatasets: [{ name: 'BDD100K', state: 'commercial-license-required', label: 'Commercial use requires BDD/BAIR Commons membership or a separate licence.', evidenceRefId: 'bdd100k-license' }],
    pinnedRevision: null, weightsSha256: null, webReadiness: 'unverified', evidenceRefIds: ['yolopv2-repo', 'bdd100k-license'],
    sourceReportedProfile: '640 input, 38.9M parameters, 91 FPS on Tesla V100; source-reported and not comparable to browser hardware.',
  },
  {
    id: 'ufldv2-r18', name: 'Ultra-Fast-Lane-Detection-v2 ResNet18', repository: 'https://github.com/cfzd/Ultra-Fast-Lane-Detection-v2',
    tasks: ['lane-marking'], codeRights: permissive('MIT', 'ufldv2-repo'), weightsRights: unknown('Published weights have no separately verified commercial grant in the captured evidence.'),
    trainingDatasets: [{ name: 'CULane', ...unknown('Dataset commercial rights not verified.') }], pinnedRevision: null, weightsSha256: null,
    webReadiness: 'documented-onnx-export', evidenceRefIds: ['ufldv2-repo', 'ort-web'],
    sourceReportedProfile: 'CULane ResNet18 F1 75.0; repository documents PyTorch→ONNX→TensorRT, not ORT Web performance.',
  },
  {
    id: 'clrernet-dla34', name: 'CLRerNet DLA34', repository: 'https://github.com/hirotomusiker/CLRerNet',
    tasks: ['lane-marking'], codeRights: permissive('Apache-2.0', 'clrernet-repo'), weightsRights: unknown('GitHub release weights are available, but commercial weight rights are not separately verified.'),
    trainingDatasets: [{ name: 'CULane', ...unknown('Dataset commercial rights not verified.') }], pinnedRevision: null, weightsSha256: null,
    webReadiness: 'native-only', evidenceRefIds: ['clrernet-repo'],
    sourceReportedProfile: 'Source reports F1 81.12±0.04 and 18.4 GFLOPs; browser export and latency are unverified.',
  },
  {
    id: 'pidnet-s-cityscapes', name: 'PIDNet-S', repository: 'https://github.com/XuJiacong/PIDNet',
    tasks: ['drivable-area', 'physical-boundary'], codeRights: permissive('MIT', 'pidnet-repo'), weightsRights: unknown('Published weights have no separately verified commercial grant in the captured evidence.'),
    trainingDatasets: [{ name: 'Cityscapes', ...unknown('Dataset commercial rights not verified.') }], pinnedRevision: null, weightsSha256: null,
    webReadiness: 'native-only', evidenceRefIds: ['pidnet-repo'],
    sourceReportedProfile: 'PIDNet-S Cityscapes test 78.6 mIoU and 93.2 FPS on RTX 3090; not a browser measurement.',
  },
  {
    id: 'openvino-road-segmentation-adas-0001-fp16', name: 'Open Model Zoo road-segmentation-adas-0001 FP16', repository: 'https://github.com/openvinotoolkit/open_model_zoo',
    tasks: ['lane-marking', 'drivable-area', 'physical-boundary'], codeRights: permissive('Apache-2.0', 'openvino-license'),
    weightsRights: permissive('Apache-2.0 via pinned official model manifest', 'openvino-road-model'),
    trainingDatasets: [{ name: 'Mighty AI (converted four-class subset)', state: 'unknown', label: 'Training-data provenance is named, but commercial data terms are not established by the captured model card.', evidenceRefId: 'openvino-road-readme' }],
    pinnedRevision: '6697dead54ed1cdd664b0313189c2cb52ee6335e', weightsSha256: '58c57ee0a9b72ee9c76b0fd898ee6608bcc299c5d8d0af90a5d59d4df9e79317',
    webReadiness: 'verified-local-onnx', evidenceRefIds: ['openvino-road-readme', 'openvino-road-model', 'openvino-license', 'ort-web'],
    sourceReportedProfile: '896×512, 4.770 GFLOPs, 0.184M parameters; reported mean IoU 0.844 on 500 Mighty AI images. Local browser latency is tracked separately.',
  },
]);

export interface CandidateGate {
  id: string;
  commercialEligible: boolean;
  benchmarkReady: boolean;
  blockers: string[];
}

export interface RoadRegistryAudit {
  valid: boolean;
  errors: string[];
  gates: CandidateGate[];
}

/** Code, weights and training data are separate legal artifacts. Missing evidence blocks promotion. */
export function auditRoadModelRegistry(
  candidates: readonly RoadModelCandidate[] = ROAD_MODEL_CANDIDATES,
  evidence: readonly RoadEvidenceRef[] = ROAD_EVIDENCE_REFS,
): RoadRegistryAudit {
  const errors: string[] = [];
  const evidenceIds = new Set<string>();
  for (const ref of evidence) {
    if (evidenceIds.has(ref.id)) errors.push(`evidence trùng ID: ${ref.id}`);
    evidenceIds.add(ref.id);
    if (!/^https:\/\//.test(ref.url) || !ref.claim.trim()) errors.push(`evidence thiếu URL/claim: ${ref.id}`);
  }
  const candidateIds = new Set<string>();
  const gates = candidates.map((candidate): CandidateGate => {
    if (candidateIds.has(candidate.id)) errors.push(`candidate trùng ID: ${candidate.id}`);
    candidateIds.add(candidate.id);
    for (const refId of candidate.evidenceRefIds) if (!evidenceIds.has(refId)) errors.push(`${candidate.id}: thiếu evidence ${refId}`);
    const rights = [candidate.codeRights, candidate.weightsRights, ...candidate.trainingDatasets];
    for (const item of rights) {
      if (item.state !== 'unknown' && (!item.evidenceRefId || !evidenceIds.has(item.evidenceRefId))) {
        errors.push(`${candidate.id}: quyền ${item.label} thiếu evidence hợp lệ`);
      }
    }
    const blockers: string[] = [];
    if (candidate.codeRights.state !== 'verified-commercial') blockers.push(`code: ${candidate.codeRights.state}`);
    if (candidate.weightsRights.state !== 'verified-commercial') blockers.push(`weights: ${candidate.weightsRights.state}`);
    for (const dataset of candidate.trainingDatasets) if (dataset.state !== 'verified-commercial') blockers.push(`dataset ${dataset.name}: ${dataset.state}`);
    if (!candidate.pinnedRevision) blockers.push('chưa pin revision');
    if (!candidate.weightsSha256) blockers.push('chưa khóa SHA-256 weights');
    if (candidate.webReadiness === 'unverified') blockers.push('chưa chứng minh export/runtime web');
    const benchmarkReady = Boolean(candidate.pinnedRevision && candidate.weightsSha256 && candidate.webReadiness !== 'unverified');
    return { id: candidate.id, commercialEligible: blockers.length === 0, benchmarkReady, blockers };
  });
  return { valid: errors.length === 0, errors, gates };
}
