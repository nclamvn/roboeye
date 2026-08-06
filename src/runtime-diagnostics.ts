export interface DiagnosticEvent {
  at: string;
  name: string;
  detail?: Record<string, string | number | boolean | null>;
}

export interface DiagnosticSnapshot {
  schemaVersion: 1;
  localOnly: true;
  app: { version: string; commit: string };
  environment: { userAgent: string; online: boolean };
  events: DiagnosticEvent[];
}

interface DiagnosticsOptions {
  version: string;
  commit: string;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  now?: () => Date;
  userAgent?: () => string;
  online?: () => boolean;
  maxEvents?: number;
}

const KEY = 'roboeye.runtime-diagnostics.v1';

function cleanDetail(detail?: Record<string, unknown>): DiagnosticEvent['detail'] {
  if (!detail) return undefined;
  const clean: NonNullable<DiagnosticEvent['detail']> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (['string', 'number', 'boolean'].includes(typeof value) || value === null) {
      clean[key] = value as string | number | boolean | null;
    }
  }
  return clean;
}

export function createRuntimeDiagnostics(options: DiagnosticsOptions) {
  const maxEvents = Math.max(1, Math.min(100, options.maxEvents ?? 80));
  const now = options.now ?? (() => new Date());

  function read(): DiagnosticEvent[] {
    if (!options.storage) return [];
    try {
      const parsed = JSON.parse(options.storage.getItem(KEY) ?? '[]');
      return Array.isArray(parsed) ? parsed.slice(-maxEvents) : [];
    } catch {
      return [];
    }
  }

  let events = read();

  function persist() {
    try {
      options.storage?.setItem(KEY, JSON.stringify(events));
    } catch {
      // Storage can be unavailable in private/locked-down contexts; memory still works.
    }
  }

  return {
    record(name: string, detail?: Record<string, unknown>) {
      const cleaned = cleanDetail(detail);
      events.push({ at: now().toISOString(), name, ...(cleaned ? { detail: cleaned } : {}) });
      events = events.slice(-maxEvents);
      persist();
    },
    snapshot(): DiagnosticSnapshot {
      return {
        schemaVersion: 1,
        localOnly: true,
        app: { version: options.version, commit: options.commit },
        environment: {
          userAgent: options.userAgent?.() ?? '',
          online: options.online?.() ?? true
        },
        events: [...events]
      };
    }
  };
}
