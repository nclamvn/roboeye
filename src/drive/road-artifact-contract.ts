import {
  auditRoadModelRegistry,
  ROAD_EVIDENCE_REFS,
  ROAD_MODEL_CANDIDATES,
  type RoadEvidenceRef,
  type RoadModelCandidate,
  type RoadTask,
} from './road-model-registry';

export type RoadArtifactPurpose = 'research-benchmark' | 'commercial-product';
export type RoadTensorDType = 'float32' | 'int64' | 'uint8';
export type RoadExecutionProvider = 'webgpu' | 'wasm';

export interface RoadTensorSpec {
  name: string;
  dtype: RoadTensorDType;
  shape: number[];
}

export interface RoadArtifactManifest {
  schemaVersion: 1;
  artifactId: string;
  candidateId: string;
  purpose: RoadArtifactPurpose;
  source: {
    repository: string;
    revision: string;
    url: string;
    sha256: string;
  };
  export: {
    file: string;
    sha256: string;
    bytes: number;
    opset: number;
    tool: string;
    toolVersion: string;
  };
  tensors: {
    inputs: RoadTensorSpec[];
    outputs: RoadTensorSpec[];
  };
  runtime: {
    preferredProvider: RoadExecutionProvider;
    fallbackProviders: RoadExecutionProvider[];
    maxInputPixels: number;
    maxArtifactBytes: number;
    requiresOperatorAudit: boolean;
  };
  tasks: RoadTask[];
  evidenceRefIds: string[];
}

export interface RoadRuntimeProof {
  schemaVersion: 1;
  artifactSha256: string;
  operatorInventorySha256: string;
  testedAt: string;
  environment: {
    os: string;
    arch: string;
    hardware: string;
    browser: string;
    ortVersion: string;
  };
  results: Array<{
    provider: RoadExecutionProvider;
    status: 'passed' | 'failed';
    coldStartMs: number | null;
    inferenceP50Ms: number | null;
    inferenceP95Ms: number | null;
    peakMemoryMb: number | null;
    error: string | null;
  }>;
}

export interface RoadArtifactAssessment {
  manifestValid: boolean;
  researchEligible: boolean;
  commercialEligible: boolean;
  allowedForDeclaredPurpose: boolean;
  researchBlockers: string[];
  commercialBlockers: string[];
  blockers: string[];
}

const TASKS = new Set<RoadTask>(['lane-marking', 'drivable-area', 'physical-boundary', 'vehicle-detection']);
const DTYPES = new Set<RoadTensorDType>(['float32', 'int64', 'uint8']);
const PROVIDERS = new Set<RoadExecutionProvider>(['webgpu', 'wasm']);
const PURPOSES = new Set<RoadArtifactPurpose>(['research-benchmark', 'commercial-product']);
const PROOF_STATUSES = new Set(['passed', 'failed']);
const SHA256 = /^[a-f0-9]{64}$/;
const REVISION = /^[a-f0-9]{40}$/;
const SAFE_ONNX_FILE = /^[a-z0-9][a-z0-9._-]*\.onnx$/;
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{2,79}$/;

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} phải là object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${path}.${key} không thuộc schema`);
  for (const key of keys) if (!(key in value)) throw new Error(`${path}.${key} là bắt buộc`);
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${path} phải là chuỗi không rỗng`);
  return value;
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) throw new Error(`${path} phải là số nguyên dương`);
  return value as number;
}

function finiteNonNegativeOrNull(value: unknown, path: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${path} phải là số hữu hạn không âm hoặc null`);
  return value;
}

function uniqueStrings<T extends string>(value: unknown, path: string, allowed?: Set<T>): T[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${path} phải là mảng không rỗng`);
  const result = value.map((item, index) => string(item, `${path}[${index}]`) as T);
  if (new Set(result).size !== result.length) throw new Error(`${path} không được có phần tử trùng`);
  if (allowed) for (const item of result) if (!allowed.has(item)) throw new Error(`${path} có giá trị không hỗ trợ: ${item}`);
  return result;
}

function httpsUrl(value: unknown, path: string): string {
  const result = string(value, path);
  let parsed: URL;
  try { parsed = new URL(result); } catch { throw new Error(`${path} phải là URL hợp lệ`); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error(`${path} phải là HTTPS không chứa credentials`);
  return result;
}

function parseTensor(value: unknown, path: string): RoadTensorSpec {
  const raw = object(value, path);
  exactKeys(raw, ['name', 'dtype', 'shape'], path);
  const name = string(raw.name, `${path}.name`);
  const dtype = string(raw.dtype, `${path}.dtype`) as RoadTensorDType;
  if (!DTYPES.has(dtype)) throw new Error(`${path}.dtype không hỗ trợ: ${dtype}`);
  if (!Array.isArray(raw.shape) || raw.shape.length < 2 || raw.shape.length > 5) throw new Error(`${path}.shape phải có 2–5 chiều tĩnh`);
  const shape = raw.shape.map((dimension, index) => positiveInteger(dimension, `${path}.shape[${index}]`));
  return { name, dtype, shape };
}

function parseTensorList(value: unknown, path: string): RoadTensorSpec[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${path} phải là mảng không rỗng`);
  const tensors = value.map((tensor, index) => parseTensor(tensor, `${path}[${index}]`));
  if (new Set(tensors.map(tensor => tensor.name)).size !== tensors.length) throw new Error(`${path} trùng tên tensor`);
  return tensors;
}

/** Parse a closed manifest. Dynamic/unknown tensor dimensions are deliberately rejected. */
export function parseRoadArtifactManifest(value: unknown): RoadArtifactManifest {
  const raw = object(value, 'manifest');
  exactKeys(raw, ['schemaVersion', 'artifactId', 'candidateId', 'purpose', 'source', 'export', 'tensors', 'runtime', 'tasks', 'evidenceRefIds'], 'manifest');
  if (raw.schemaVersion !== 1) throw new Error('manifest.schemaVersion phải bằng 1');
  const artifactId = string(raw.artifactId, 'manifest.artifactId');
  const candidateId = string(raw.candidateId, 'manifest.candidateId');
  if (!SAFE_ID.test(artifactId) || !SAFE_ID.test(candidateId)) throw new Error('artifactId/candidateId không an toàn');
  const purpose = string(raw.purpose, 'manifest.purpose') as RoadArtifactPurpose;
  if (!PURPOSES.has(purpose)) throw new Error(`manifest.purpose không hỗ trợ: ${purpose}`);

  const sourceRaw = object(raw.source, 'manifest.source');
  exactKeys(sourceRaw, ['repository', 'revision', 'url', 'sha256'], 'manifest.source');
  const source = {
    repository: httpsUrl(sourceRaw.repository, 'manifest.source.repository'),
    revision: string(sourceRaw.revision, 'manifest.source.revision'),
    url: httpsUrl(sourceRaw.url, 'manifest.source.url'),
    sha256: string(sourceRaw.sha256, 'manifest.source.sha256'),
  };
  if (!REVISION.test(source.revision)) throw new Error('manifest.source.revision phải là commit SHA 40 ký tự');
  if (!SHA256.test(source.sha256)) throw new Error('manifest.source.sha256 phải là SHA-256 chữ thường');

  const exportRaw = object(raw.export, 'manifest.export');
  exactKeys(exportRaw, ['file', 'sha256', 'bytes', 'opset', 'tool', 'toolVersion'], 'manifest.export');
  const exported = {
    file: string(exportRaw.file, 'manifest.export.file'),
    sha256: string(exportRaw.sha256, 'manifest.export.sha256'),
    bytes: positiveInteger(exportRaw.bytes, 'manifest.export.bytes'),
    opset: positiveInteger(exportRaw.opset, 'manifest.export.opset'),
    tool: string(exportRaw.tool, 'manifest.export.tool'),
    toolVersion: string(exportRaw.toolVersion, 'manifest.export.toolVersion'),
  };
  if (!SAFE_ONNX_FILE.test(exported.file)) throw new Error('manifest.export.file phải là basename .onnx an toàn');
  if (!SHA256.test(exported.sha256)) throw new Error('manifest.export.sha256 phải là SHA-256 chữ thường');
  if (exported.opset < 11 || exported.opset > 23) throw new Error('manifest.export.opset phải trong khoảng 11–23');

  const tensorsRaw = object(raw.tensors, 'manifest.tensors');
  exactKeys(tensorsRaw, ['inputs', 'outputs'], 'manifest.tensors');
  const tensors = {
    inputs: parseTensorList(tensorsRaw.inputs, 'manifest.tensors.inputs'),
    outputs: parseTensorList(tensorsRaw.outputs, 'manifest.tensors.outputs'),
  };

  const runtimeRaw = object(raw.runtime, 'manifest.runtime');
  exactKeys(runtimeRaw, ['preferredProvider', 'fallbackProviders', 'maxInputPixels', 'maxArtifactBytes', 'requiresOperatorAudit'], 'manifest.runtime');
  const preferredProvider = string(runtimeRaw.preferredProvider, 'manifest.runtime.preferredProvider') as RoadExecutionProvider;
  if (!PROVIDERS.has(preferredProvider)) throw new Error(`manifest.runtime.preferredProvider không hỗ trợ: ${preferredProvider}`);
  const fallbackProviders = uniqueStrings<RoadExecutionProvider>(runtimeRaw.fallbackProviders, 'manifest.runtime.fallbackProviders', PROVIDERS);
  if (fallbackProviders.includes(preferredProvider)) throw new Error('fallbackProviders không được lặp preferredProvider');
  if (typeof runtimeRaw.requiresOperatorAudit !== 'boolean') throw new Error('manifest.runtime.requiresOperatorAudit phải là boolean');
  const runtime = {
    preferredProvider,
    fallbackProviders,
    maxInputPixels: positiveInteger(runtimeRaw.maxInputPixels, 'manifest.runtime.maxInputPixels'),
    maxArtifactBytes: positiveInteger(runtimeRaw.maxArtifactBytes, 'manifest.runtime.maxArtifactBytes'),
    requiresOperatorAudit: runtimeRaw.requiresOperatorAudit,
  };
  if (exported.bytes > runtime.maxArtifactBytes) throw new Error('artifact vượt runtime.maxArtifactBytes');

  const tasks = uniqueStrings<RoadTask>(raw.tasks, 'manifest.tasks', TASKS);
  const evidenceRefIds = uniqueStrings<string>(raw.evidenceRefIds, 'manifest.evidenceRefIds');
  return { schemaVersion: 1, artifactId, candidateId, purpose, source, export: exported, tensors, runtime, tasks, evidenceRefIds };
}

/** Runtime proof is a separate, hash-bound observation; it is not trusted from the artifact manifest. */
export function parseRoadRuntimeProof(value: unknown): RoadRuntimeProof {
  const raw = object(value, 'proof');
  exactKeys(raw, ['schemaVersion', 'artifactSha256', 'operatorInventorySha256', 'testedAt', 'environment', 'results'], 'proof');
  if (raw.schemaVersion !== 1) throw new Error('proof.schemaVersion phải bằng 1');
  const artifactSha256 = string(raw.artifactSha256, 'proof.artifactSha256');
  const operatorInventorySha256 = string(raw.operatorInventorySha256, 'proof.operatorInventorySha256');
  if (!SHA256.test(artifactSha256) || !SHA256.test(operatorInventorySha256)) throw new Error('proof hashes phải là SHA-256 chữ thường');
  const testedAt = string(raw.testedAt, 'proof.testedAt');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(testedAt) || !Number.isFinite(Date.parse(testedAt))) {
    throw new Error('proof.testedAt phải là ISO-8601 UTC');
  }
  const environmentRaw = object(raw.environment, 'proof.environment');
  exactKeys(environmentRaw, ['os', 'arch', 'hardware', 'browser', 'ortVersion'], 'proof.environment');
  const environment = {
    os: string(environmentRaw.os, 'proof.environment.os'),
    arch: string(environmentRaw.arch, 'proof.environment.arch'),
    hardware: string(environmentRaw.hardware, 'proof.environment.hardware'),
    browser: string(environmentRaw.browser, 'proof.environment.browser'),
    ortVersion: string(environmentRaw.ortVersion, 'proof.environment.ortVersion'),
  };
  if (!Array.isArray(raw.results) || raw.results.length === 0) throw new Error('proof.results phải là mảng không rỗng');
  const results = raw.results.map((entry, index) => {
    const path = `proof.results[${index}]`;
    const result = object(entry, path);
    exactKeys(result, ['provider', 'status', 'coldStartMs', 'inferenceP50Ms', 'inferenceP95Ms', 'peakMemoryMb', 'error'], path);
    const provider = string(result.provider, `${path}.provider`) as RoadExecutionProvider;
    if (!PROVIDERS.has(provider)) throw new Error(`${path}.provider không hỗ trợ: ${provider}`);
    const status = string(result.status, `${path}.status`) as 'passed' | 'failed';
    if (!PROOF_STATUSES.has(status)) throw new Error(`${path}.status không hỗ trợ: ${status}`);
    const coldStartMs = finiteNonNegativeOrNull(result.coldStartMs, `${path}.coldStartMs`);
    const inferenceP50Ms = finiteNonNegativeOrNull(result.inferenceP50Ms, `${path}.inferenceP50Ms`);
    const inferenceP95Ms = finiteNonNegativeOrNull(result.inferenceP95Ms, `${path}.inferenceP95Ms`);
    const peakMemoryMb = finiteNonNegativeOrNull(result.peakMemoryMb, `${path}.peakMemoryMb`);
    if (result.error !== null && typeof result.error !== 'string') throw new Error(`${path}.error phải là string hoặc null`);
    const error = result.error as string | null;
    if (status === 'passed' && (coldStartMs === null || inferenceP50Ms === null || inferenceP95Ms === null || error !== null)) {
      throw new Error(`${path} passed phải có timing và không có error`);
    }
    if (status === 'failed' && !error?.trim()) throw new Error(`${path} failed phải có error`);
    if (inferenceP50Ms !== null && inferenceP95Ms !== null && inferenceP95Ms < inferenceP50Ms) throw new Error(`${path} p95 không được nhỏ hơn p50`);
    return { provider, status, coldStartMs, inferenceP50Ms, inferenceP95Ms, peakMemoryMb, error };
  });
  if (new Set(results.map(result => result.provider)).size !== results.length) throw new Error('proof.results trùng provider');
  return { schemaVersion: 1, artifactSha256, operatorInventorySha256, testedAt, environment, results };
}

/** Registry and artifact must agree; a self-declared manifest cannot grant itself commercial rights. */
export function assessRoadArtifact(
  manifest: RoadArtifactManifest,
  candidates: readonly RoadModelCandidate[] = ROAD_MODEL_CANDIDATES,
  evidence: readonly RoadEvidenceRef[] = ROAD_EVIDENCE_REFS,
  runtimeProof?: RoadRuntimeProof,
): RoadArtifactAssessment {
  const blockers: string[] = [];
  const registryAudit = auditRoadModelRegistry(candidates, evidence);
  if (!registryAudit.valid) blockers.push(...registryAudit.errors.map(error => `registry: ${error}`));
  const candidate = candidates.find(item => item.id === manifest.candidateId);
  if (!candidate) blockers.push(`candidate không tồn tại: ${manifest.candidateId}`);
  const evidenceIds = new Set(evidence.map(item => item.id));
  for (const refId of manifest.evidenceRefIds) if (!evidenceIds.has(refId)) blockers.push(`evidence không tồn tại: ${refId}`);
  if (candidate) {
    if (manifest.source.repository !== candidate.repository) blockers.push('repository không khớp registry');
    if (manifest.source.revision !== candidate.pinnedRevision) blockers.push('revision không khớp revision đã pin');
    if (manifest.source.sha256 !== candidate.weightsSha256) blockers.push('source weights SHA-256 không khớp registry');
    for (const task of manifest.tasks) if (!candidate.tasks.includes(task)) blockers.push(`task ngoài candidate: ${task}`);
    if (candidate.webReadiness === 'unverified') blockers.push('runtime web chưa được chứng minh');
    if (candidate.weightsRights.state === 'unknown') blockers.push('quyền weights chưa rõ');
  }
  if (!manifest.runtime.requiresOperatorAudit) blockers.push('operator audit phải là bắt buộc');
  if (!runtimeProof) {
    blockers.push('thiếu runtime proof độc lập');
  } else {
    if (runtimeProof.artifactSha256 !== manifest.export.sha256) blockers.push('runtime proof không thuộc artifact SHA-256 này');
    const declaredProviders = [manifest.runtime.preferredProvider, ...manifest.runtime.fallbackProviders];
    for (const provider of declaredProviders) {
      if (!runtimeProof.results.some(result => result.provider === provider)) blockers.push(`runtime proof thiếu provider ${provider}`);
    }
    if (!runtimeProof.results.some(result => result.status === 'passed')) blockers.push('không execution provider nào smoke pass');
  }
  const researchEligible = blockers.length === 0;
  const gate = registryAudit.gates.find(item => item.id === manifest.candidateId);
  const commercialBlockers = [...blockers];
  if (!gate?.commercialEligible) commercialBlockers.push(...(gate?.blockers ?? ['candidate chưa đạt cổng thương mại']));
  const commercialEligible = commercialBlockers.length === 0;
  return {
    manifestValid: true,
    researchEligible,
    commercialEligible,
    allowedForDeclaredPurpose: manifest.purpose === 'commercial-product' ? commercialEligible : researchEligible,
    researchBlockers: [...new Set(blockers)],
    commercialBlockers: [...new Set(commercialBlockers)],
    blockers: [...new Set(manifest.purpose === 'commercial-product' ? commercialBlockers : blockers)],
  };
}
