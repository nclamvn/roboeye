import type {
  CorpusSplit,
  RoadArea,
  RoadClip,
  RoadLine,
  RoadLineClass,
  RoadLineRole,
  RoadPoint,
  RoadTruthFrame,
} from './road-benchmark';

export interface RoadAnnotationTaskFrame {
  timeMs: number;
  imageFile: string;
  imageSha256: string;
}

export interface RoadAnnotationTask {
  schemaVersion: 1;
  taskId: string;
  clipId: string;
  split: CorpusSplit;
  width: number;
  height: number;
  sourceSha256: string;
  rights: RoadClip['rights'];
  scenarioTags: string[];
  predictionBlind: true;
  frames: RoadAnnotationTaskFrame[];
}

export interface RoadAnnotationReview {
  decision: 'accepted';
  reviewedBy: string;
  reviewedAt: string;
  note: string;
}

export interface RoadAnnotationFrame extends RoadTruthFrame {
  imageSha256: string;
}

export interface RoadAnnotationSet {
  schemaVersion: 1;
  revision: number;
  taskId: string;
  taskSha256: string;
  status: 'draft' | 'reviewed';
  annotatedBy: string;
  review: RoadAnnotationReview | null;
  frames: RoadAnnotationFrame[];
}

const SPLITS: CorpusSplit[] = ['train', 'validation', 'test'];
const RIGHTS: RoadClip['rights']['basis'][] = ['owned', 'licensed', 'consented', 'synthetic'];
const LINE_CLASSES: RoadLineClass[] = ['lane-marking', 'curb', 'median', 'barrier', 'guardrail'];
const ROLES: RoadLineRole[] = ['ego-left', 'ego-right', 'adjacent', 'unknown'];
const SHA256 = /^[0-9a-f]{64}$/;
const IMAGE_FILE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.png$/;

function record(value: unknown, path: string, keys: string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw Error(`${path}: cần object`);
  const item = value as Record<string, unknown>;
  for (const key of Object.keys(item)) if (!keys.includes(key)) throw Error(`${path}.${key}: trường không được phép`);
  return item;
}

function list(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw Error(`${path}: cần array tối đa ${max} phần tử`);
  return value;
}

function text(value: unknown, path: string, max = 160): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw Error(`${path}: chuỗi không hợp lệ`);
  return value;
}

function finite(value: unknown, path: string, min: number, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw Error(`${path}: số ngoài giới hạn`);
  }
  return value;
}

function choice<T extends string>(value: unknown, path: string, options: readonly T[]): T {
  if (typeof value !== 'string' || !options.includes(value as T)) throw Error(`${path}: giá trị không hợp lệ`);
  return value as T;
}

function sha(value: unknown, path: string): string {
  const parsed = text(value, path, 64).toLowerCase();
  if (!SHA256.test(parsed)) throw Error(`${path}: cần SHA-256 hex`);
  return parsed;
}

function point(value: unknown, path: string): RoadPoint {
  const item = record(value, path, ['x', 'y']);
  return { x: finite(item.x, `${path}.x`, 0, 1), y: finite(item.y, `${path}.y`, 0, 1) };
}

function points(value: unknown, path: string, minimum: number): RoadPoint[] {
  const parsed = list(value, path, 300).map((item, index) => point(item, `${path}[${index}]`));
  if (parsed.length < minimum) throw Error(`${path}: cần ít nhất ${minimum} điểm`);
  return parsed;
}

function line(value: unknown, path: string): RoadLine {
  const item = record(value, path, ['id', 'class', 'role', 'points']);
  const parsed: RoadLine = {
    id: text(item.id, `${path}.id`),
    class: choice(item.class, `${path}.class`, LINE_CLASSES),
    role: choice(item.role, `${path}.role`, ROLES),
    points: points(item.points, `${path}.points`, 2),
  };
  if (parsed.class !== 'lane-marking' && parsed.role !== 'unknown') {
    throw Error(`${path}.role: biên vật lý phải dùng unknown`);
  }
  return parsed;
}

function area(value: unknown, path: string): RoadArea {
  const item = record(value, path, ['id', 'class', 'points']);
  if (item.class !== 'drivable') throw Error(`${path}.class: chỉ chấp nhận drivable`);
  return { id: text(item.id, `${path}.id`), class: 'drivable', points: points(item.points, `${path}.points`, 3) };
}

function parseRights(value: unknown, path: string): RoadClip['rights'] {
  const item = record(value, path, ['basis', 'reference']);
  return {
    basis: choice(item.basis, `${path}.basis`, RIGHTS),
    reference: text(item.reference, `${path}.reference`, 240),
  };
}

function parseGeometry(value: Record<string, unknown>, path: string): Pick<RoadTruthFrame, 'lines' | 'areas'> {
  const lines = list(value.lines, `${path}.lines`, 100).map((item, index) => line(item, `${path}.lines[${index}]`));
  const areas = list(value.areas, `${path}.areas`, 30).map((item, index) => area(item, `${path}.areas[${index}]`));
  const ids = [...lines, ...areas].map(item => item.id);
  if (new Set(ids).size !== ids.length) throw Error(`${path}: ID line/area trùng`);
  return { lines, areas };
}

export function parseRoadAnnotationTask(value: unknown): RoadAnnotationTask {
  const root = record(value, 'task', [
    'schemaVersion', 'taskId', 'clipId', 'split', 'width', 'height', 'sourceSha256', 'rights',
    'scenarioTags', 'predictionBlind', 'frames',
  ]);
  if (root.schemaVersion !== 1) throw Error('task.schemaVersion: phải là 1');
  if (root.predictionBlind !== true) throw Error('task.predictionBlind: phải là true');
  let previousTime = -1;
  const imageFiles = new Set<string>();
  const frames = list(root.frames, 'task.frames', 500).map((raw, index): RoadAnnotationTaskFrame => {
    const path = `task.frames[${index}]`;
    const item = record(raw, path, ['timeMs', 'imageFile', 'imageSha256']);
    const timeMs = finite(item.timeMs, `${path}.timeMs`, 0, 86_400_000);
    if (timeMs <= previousTime) throw Error(`${path}.timeMs: phải tăng nghiêm ngặt`);
    previousTime = timeMs;
    const imageFile = text(item.imageFile, `${path}.imageFile`, 200);
    if (!IMAGE_FILE.test(imageFile)) throw Error(`${path}.imageFile: tên PNG không hợp lệ`);
    if (imageFiles.has(imageFile)) throw Error(`${path}.imageFile: bị trùng`);
    imageFiles.add(imageFile);
    return { timeMs, imageFile, imageSha256: sha(item.imageSha256, `${path}.imageSha256`) };
  });
  if (!frames.length) throw Error('task.frames: cần ít nhất một frame');
  const scenarioTags = list(root.scenarioTags, 'task.scenarioTags', 30).map((item, index) => text(item, `task.scenarioTags[${index}]`, 60));
  if (new Set(scenarioTags).size !== scenarioTags.length) throw Error('task.scenarioTags: bị trùng');
  return {
    schemaVersion: 1,
    taskId: text(root.taskId, 'task.taskId'),
    clipId: text(root.clipId, 'task.clipId'),
    split: choice(root.split, 'task.split', SPLITS),
    width: finite(root.width, 'task.width', 160, 8192, true),
    height: finite(root.height, 'task.height', 120, 8192, true),
    sourceSha256: sha(root.sourceSha256, 'task.sourceSha256'),
    rights: parseRights(root.rights, 'task.rights'),
    scenarioTags,
    predictionBlind: true,
    frames,
  };
}

export function parseRoadAnnotationSet(value: unknown): RoadAnnotationSet {
  const root = record(value, 'annotations', ['schemaVersion', 'revision', 'taskId', 'taskSha256', 'status', 'annotatedBy', 'review', 'frames']);
  if (root.schemaVersion !== 1) throw Error('annotations.schemaVersion: phải là 1');
  const status = choice(root.status, 'annotations.status', ['draft', 'reviewed'] as const);
  const annotatedBy = text(root.annotatedBy, 'annotations.annotatedBy', 100);
  let review: RoadAnnotationReview | null = null;
  if (root.review !== null) {
    const raw = record(root.review, 'annotations.review', ['decision', 'reviewedBy', 'reviewedAt', 'note']);
    if (raw.decision !== 'accepted') throw Error('annotations.review.decision: phải là accepted');
    const reviewedBy = text(raw.reviewedBy, 'annotations.review.reviewedBy', 100);
    if (reviewedBy === annotatedBy) throw Error('annotations.review.reviewedBy: phải khác annotatedBy');
    const reviewedAt = text(raw.reviewedAt, 'annotations.review.reviewedAt', 40);
    if (!Number.isFinite(Date.parse(reviewedAt))) throw Error('annotations.review.reviewedAt: thời gian ISO không hợp lệ');
    review = { decision: 'accepted', reviewedBy, reviewedAt, note: text(raw.note, 'annotations.review.note', 400) };
  }
  if (status === 'reviewed' && review === null) throw Error('annotations.review: bắt buộc khi status=reviewed');
  if (status === 'draft' && review !== null) throw Error('annotations.review: draft không được có review');
  let previousTime = -1;
  const frames = list(root.frames, 'annotations.frames', 500).map((raw, index): RoadAnnotationFrame => {
    const path = `annotations.frames[${index}]`;
    const item = record(raw, path, ['timeMs', 'imageSha256', 'lines', 'areas']);
    const timeMs = finite(item.timeMs, `${path}.timeMs`, 0, 86_400_000);
    if (timeMs <= previousTime) throw Error(`${path}.timeMs: phải tăng nghiêm ngặt`);
    previousTime = timeMs;
    return { timeMs, imageSha256: sha(item.imageSha256, `${path}.imageSha256`), ...parseGeometry(item, path) };
  });
  if (!frames.length) throw Error('annotations.frames: cần ít nhất một frame');
  return {
    schemaVersion: 1,
    revision: root.revision === undefined ? 0 : finite(root.revision, 'annotations.revision', 0, 1_000_000, true),
    taskId: text(root.taskId, 'annotations.taskId'),
    taskSha256: sha(root.taskSha256, 'annotations.taskSha256'),
    status,
    annotatedBy,
    review,
    frames,
  };
}

export function validateRoadAnnotationsAgainstTask(
  task: RoadAnnotationTask,
  taskSha256: string,
  annotations: RoadAnnotationSet,
): void {
  if (!SHA256.test(taskSha256)) throw Error('taskSha256: cần SHA-256 hex');
  if (annotations.taskId !== task.taskId) throw Error('annotations.taskId: không khớp task');
  if (annotations.taskSha256 !== taskSha256) throw Error('annotations.taskSha256: task đã thay đổi');
  if (annotations.frames.length !== task.frames.length) throw Error('annotations.frames: số frame không khớp task');
  for (const [index, frame] of annotations.frames.entries()) {
    const source = task.frames[index];
    if (frame.timeMs !== source.timeMs) throw Error(`annotations.frames[${index}].timeMs: không khớp task`);
    if (frame.imageSha256 !== source.imageSha256) throw Error(`annotations.frames[${index}].imageSha256: không khớp ảnh thô`);
  }
}

export function createDraftRoadAnnotations(task: RoadAnnotationTask, taskSha256: string): RoadAnnotationSet {
  if (!SHA256.test(taskSha256)) throw Error('taskSha256: cần SHA-256 hex');
  return {
    schemaVersion: 1,
    revision: 0,
    taskId: task.taskId,
    taskSha256,
    status: 'draft',
    annotatedBy: 'local-annotator',
    review: null,
    frames: task.frames.map(frame => ({ timeMs: frame.timeMs, imageSha256: frame.imageSha256, lines: [], areas: [] })),
  };
}

export function roadAnnotationsToTruthFrames(annotations: RoadAnnotationSet): RoadTruthFrame[] {
  if (annotations.status !== 'reviewed' || annotations.review?.decision !== 'accepted') {
    throw Error('Chỉ nhãn đã review mới được đưa vào benchmark');
  }
  return annotations.frames.map(({ timeMs, lines, areas }) => ({ timeMs, lines, areas }));
}
