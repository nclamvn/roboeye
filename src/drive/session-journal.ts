import type { DiagnosticSource } from './diagnostic-ledger';

export const JOURNAL_LIMITS = Object.freeze({ sessions: 10, days: 7, bytes: 10 * 1024 * 1024, checkpointMs: 2000 });
export interface SessionManifest {
  sessionId: string; source: DiagnosticSource; execution: 'actual-workers' | 'mock-workers';
  startedUtc: string; timeOrigin: number; build: { version: string; commit: string; sourceFingerprint: string };
  userAgent: string; capabilities: { webgpuPresent: boolean; crossOriginIsolated: boolean; videoFrameCallback: boolean };
  models: { detectorGpuSha256: string; detectorWasmSha256: string; metricSha256: string;metricLandscapeSha256?:string;metricPortraitSha256?:string;detectorLiteSha256?:string };
  metricMaxAgeMs: number; wasmThreads: number;
  policies?: { range: string; detector: string; metricAdapter: string; processorRevision: string; processorSha256: string };
  fixture?: { sha256: string | null; bytes: number; mime: string; rights: string };
}
export interface DiagnosticPayload {
  manifest: SessionManifest; status: 'active' | 'ended'; epoch: number; elapsedMs: number;
  ledger: object; mobileSoak: object;
  backends: { detector: string | null; metric: string | null };
  metricLifecycle?: object;
  sourceLifecycle?: object;
  mobileRanging?: object;
}
export interface JournalRecord {
  schema: 'drivesense-session-journal-v1'; sessionId: string; sequence: number; updatedUtc: string;
  payload: DiagnosticPayload; sha256: string;
}
export interface JournalBackend {
  list(): Promise<JournalRecord[]>;
  put(record: JournalRecord, limits: typeof JOURNAL_LIMITS): Promise<void>;
}
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
async function checksum(value: unknown) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
  return [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
}
const fields = (value: object, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
/** Import is checksum validation, not authentication or ground-truth validation. */
export async function validateJournalRecord(input: unknown): Promise<JournalRecord> {
  if (!input || typeof input !== 'object' || bytes(input) > JOURNAL_LIMITS.bytes) throw Error('Báo cáo không hợp lệ hoặc vượt 10 MiB.');
  const r = input as JournalRecord;
  if (r.schema !== 'drivesense-session-journal-v1') throw Error('Schema báo cáo chưa được hỗ trợ; dữ liệu cũ không bị xóa.');
  const p = r.payload, m = p?.manifest;
  if (!fields(r, ['schema','sessionId','sequence','updatedUtc','payload','sha256']) || !p || !m ||
      !fields(p, ['manifest','status','epoch','elapsedMs','ledger','mobileSoak','backends','metricLifecycle','sourceLifecycle','mobileRanging']) ||
      !fields(m, ['sessionId','source','execution','startedUtc','timeOrigin','build','userAgent','capabilities','models','metricMaxAgeMs','wasmThreads','fixture','policies']) ||
      !/^[a-zA-Z0-9-]{1,80}$/.test(r.sessionId) || m.sessionId !== r.sessionId ||
      !Number.isInteger(r.sequence) || r.sequence < 1 || !Number.isFinite(Date.parse(r.updatedUtc)) ||
      !['live-camera','fixture-live-replay'].includes(m.source) || !['actual-workers','mock-workers'].includes(m.execution) ||
      !['active','ended'].includes(p.status) || !Number.isInteger(p.epoch) || !Number.isFinite(p.elapsedMs) || p.elapsedMs < 0 ||
      !m.build?.sourceFingerprint || typeof m.userAgent !== 'string' || m.userAgent.length > 512 ||
      !p.ledger || !p.mobileSoak || !p.backends) throw Error('Hợp đồng báo cáo sai.');
  // Never ingest pixel, video, location or hardware identifiers into this store.
  const inspect = (value: unknown, depth = 0) => {
    if (depth > 20) throw Error('Báo cáo lồng quá sâu.');
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
      if (/^(pixels|rgba|video|gps|deviceId|groupId|localPath|sourceName)$/i.test(key)) throw Error('Báo cáo chứa dữ liệu ngoài allowlist riêng tư.');
      inspect(child, depth + 1);
    }
  };
  inspect(r);
  const { sha256, ...content } = r;
  if (typeof sha256 !== 'string' || await checksum(content) !== sha256) throw Error('Checksum sai; báo cáo có thể bị hỏng hoặc đã sửa.');
  return structuredClone(r);
}
/** Select bounded oldest sessions for pruning, always protecting the active checkpoint. */
export function retainedRecords(records: JournalRecord[], activeId: string, nowUtc: string) {
  const cutoff = Date.parse(nowUtc) - JOURNAL_LIMITS.days * 86400_000;
  const kept = records.filter(r => r.sessionId === activeId || Date.parse(r.updatedUtc) >= cutoff)
    .sort((a, b) => Date.parse(b.updatedUtc) - Date.parse(a.updatedUtc));
  while (kept.length > JOURNAL_LIMITS.sessions || bytes(kept) > JOURNAL_LIMITS.bytes) {
    let index = kept.length - 1;
    while (index >= 0 && kept[index].sessionId === activeId) index--;
    if (index < 0) throw Error('Phiên đang chạy vượt ngân sách lưu trữ.');
    kept.splice(index, 1);
  }
  return kept;
}
export class IndexedDbJournalBackend implements JournalBackend {
  private connection: Promise<IDBDatabase> | null = null;
  private open() {
    return this.connection ??= new Promise<IDBDatabase>((resolve, reject) => {
      if (!globalThis.indexedDB) { reject(Error('IndexedDB không khả dụng.')); return; }
      const request = indexedDB.open('roboeye-drivesense-diagnostics', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('sessions', { keyPath: 'sessionId' });
      request.onerror = () => { this.connection = null; reject(request.error ?? Error('Không mở được IndexedDB.')); };
      request.onblocked = () => { this.connection = null; reject(Error('IndexedDB đang bị khóa bởi tab khác.')); };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); this.connection = null; };
        resolve(db);
      };
    });
  }
  async list() {
    const db = await this.open();
    return new Promise<JournalRecord[]>((resolve, reject) => {
      const tx = db.transaction('sessions', 'readonly'), request = tx.objectStore('sessions').getAll();
      tx.oncomplete = () => resolve(request.result as JournalRecord[]);
      tx.onabort = () => reject(tx.error ?? Error('Không đọc được báo cáo local.'));
    });
  }
  async put(record: JournalRecord) {
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction('sessions', 'readwrite'), store = tx.objectStore('sessions'), request = store.getAll();
      request.onsuccess = () => {
        try {
          const existing = request.result as JournalRecord[];
          const prior = existing.find(r => r.sessionId === record.sessionId);
          if (prior && prior.sequence >= record.sequence) return;
          const all = existing.filter(r => r.sessionId !== record.sessionId).concat(record);
          const kept = retainedRecords(all, record.sessionId, record.updatedUtc), ids = new Set(kept.map(r => r.sessionId));
          for (const r of all) if (!ids.has(r.sessionId)) store.delete(r.sessionId);
          store.put(record);
        } catch { tx.abort(); }
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? Error('Không ghi được checkpoint (quota hoặc storage bị chặn).'));
    });
  }
}

export class SessionJournal {
  private sequence = new Map<string, number>();
  private latest = new Map<string, DiagnosticPayload>();
  private writing: Promise<void> | null = null;
  health: { state: 'idle' | 'saved' | 'error'; savedUtc: string | null; error: string | null } = { state: 'idle', savedUtc: null, error: null };
  constructor(private backend: JournalBackend = new IndexedDbJournalBackend()) {}
  /** One write plus one latest checkpoint per retained session (max 10).
   * Switching source cannot replace another session's final summary. */
  checkpoint(payload: DiagnosticPayload): Promise<void> {
    this.latest.set(payload.manifest.sessionId, structuredClone(payload));
    if(this.latest.size>JOURNAL_LIMITS.sessions)this.latest.delete(this.latest.keys().next().value!);
    if (this.writing) return this.writing;
    this.writing = this.drain().finally(() => { this.writing = null; }); return this.writing;
  }
  private async drain() {
    while (this.latest.size) {
      const id=this.latest.keys().next().value!,payload=this.latest.get(id)!;this.latest.delete(id);
      try {
        const sequence = (this.sequence.get(payload.manifest.sessionId) ?? 0) + 1;
        const content = { schema: 'drivesense-session-journal-v1' as const, sessionId: payload.manifest.sessionId,
          sequence, updatedUtc: new Date().toISOString(), payload };
        const record = await validateJournalRecord({ ...content, sha256: await checksum(content) });
        await this.backend.put(record, JOURNAL_LIMITS); this.sequence.set(record.sessionId, sequence);
        this.health = { state: 'saved', savedUtc: record.updatedUtc, error: null };
      } catch (error) {
        this.health = { state: 'error', savedUtc: this.health.savedUtc,
          error: error instanceof Error ? error.message.slice(0, 180) : 'Lưu báo cáo local thất bại.' };
      }
    }
  }
  async list() {
    const records = await this.backend.list();
    for (const r of records) this.sequence.set(r.sessionId, Math.max(this.sequence.get(r.sessionId) ?? 0, r.sequence));
    return records.sort((a,b) => Date.parse(b.updatedUtc) - Date.parse(a.updatedUtc));
  }
  async load(id: string) {
    const record = (await this.list()).find(r => r.sessionId === id);
    if (!record) throw Error('Không tìm thấy phiên local.');
    return validateJournalRecord(record);
  }
  async import(input: unknown) {
    const record = await validateJournalRecord(input);
    await this.backend.put(record, JOURNAL_LIMITS);
    this.sequence.set(record.sessionId, Math.max(this.sequence.get(record.sessionId) ?? 0, record.sequence));
    return record;
  }
}
