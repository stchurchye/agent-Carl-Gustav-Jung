import * as FileSystem from 'expo-file-system/legacy';

type LogEntry = {
  ts: string;
  event: string;
  meta?: Record<string, unknown>;
};

const buffer: LogEntry[] = [];
const MAX = 500;
const LOG_FILE = `${FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? ''}client-log.json`;
let persistQueue: Promise<void> = Promise.resolve();
let hydrated = false;

async function hydrate(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const info = await FileSystem.getInfoAsync(LOG_FILE);
    if (!info.exists) return;
    const raw = await FileSystem.readAsStringAsync(LOG_FILE);
    const parsed = JSON.parse(raw) as LogEntry[];
    if (Array.isArray(parsed)) {
      buffer.length = 0;
      buffer.push(...parsed.slice(-MAX));
    }
  } catch {
    /* ignore corrupt file */
  }
}

function schedulePersist(): void {
  persistQueue = persistQueue.then(async () => {
    try {
      await FileSystem.writeAsStringAsync(LOG_FILE, JSON.stringify(buffer));
    } catch {
      /* ignore disk errors */
    }
  });
}

export function clientLog(event: string, meta?: Record<string, unknown>) {
  const entry: LogEntry = { ts: new Date().toISOString(), event, meta };
  buffer.push(entry);
  if (buffer.length > MAX) buffer.splice(0, buffer.length - MAX);
  void hydrate().then(() => schedulePersist());
}

export async function ensureClientLogsLoaded(): Promise<void> {
  await hydrate();
}

export function getClientLogEntries(count = 200): LogEntry[] {
  return buffer.slice(-count);
}

export function getRecentLogs(count = 50): string {
  return JSON.stringify(buffer.slice(-count), null, 2);
}

export async function clearClientLogs(): Promise<void> {
  buffer.length = 0;
  try {
    await FileSystem.deleteAsync(LOG_FILE, { idempotent: true });
  } catch {
    /* ignore */
  }
}
