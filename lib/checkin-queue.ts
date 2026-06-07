'use client';

// Browser-side offline check-in queue, backed by IndexedDB so it survives a
// tab close / reload (unlike in-memory or sessionStorage for binary-safe,
// larger payloads). Pairs with sanitizeOccurredAt on the server, which gates
// the replayed timestamp.
//
// Flow: when a self check-in can't reach the server (offline), we enqueue
// { slug, occurredAt }. On the next `online` event (or app load) we flush —
// replaying each via the provided server-action wrapper and deleting rows
// that succeed. Rows whose server result is a hard rejection (e.g. expired
// membership) are also dropped, so a permanently-failing entry can't wedge
// the queue forever.

const DB_NAME = 'gymflow';
const STORE = 'checkin_queue';
const DB_VERSION = 1;

export type QueuedCheckin = { id: string; slug: string; occurredAt: string };

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Add a check-in to the offline queue. No-op (returns false) where
 *  IndexedDB is unavailable, so callers can branch on the result. */
export async function enqueueCheckin(slug: string, occurredAt: string): Promise<boolean> {
  if (!hasIndexedDb()) return false;
  try {
    const db = await openDb();
    const id = (crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await tx(db, 'readwrite', (s) => s.put({ id, slug, occurredAt } satisfies QueuedCheckin));
    db.close();
    return true;
  } catch {
    return false;
  }
}

export async function countQueued(): Promise<number> {
  if (!hasIndexedDb()) return 0;
  try {
    const db = await openDb();
    const n = await tx<number>(db, 'readonly', (s) => s.count());
    db.close();
    return n;
  } catch {
    return 0;
  }
}

async function listQueued(): Promise<QueuedCheckin[]> {
  if (!hasIndexedDb()) return [];
  const db = await openDb();
  const all = await tx<QueuedCheckin[]>(db, 'readonly', (s) => s.getAll() as IDBRequest<QueuedCheckin[]>);
  db.close();
  return all ?? [];
}

async function removeQueued(id: string): Promise<void> {
  if (!hasIndexedDb()) return;
  const db = await openDb();
  await tx(db, 'readwrite', (s) => s.delete(id));
  db.close();
}

export type FlushOutcome = { synced: number; remaining: number };

/**
 * Replay every queued check-in via `replay`. An entry is removed when the
 * server confirms success OR returns a definitive rejection (a result with
 * ok:false that ISN'T a transient network error) — so a permanently-invalid
 * entry can't block the queue. A thrown error (offline again mid-flush)
 * leaves the entry in place for the next attempt.
 */
export async function flushCheckins(
  replay: (q: QueuedCheckin) => Promise<{ ok: boolean }>,
): Promise<FlushOutcome> {
  const items = await listQueued();
  let synced = 0;
  for (const item of items) {
    try {
      const res = await replay(item);
      // Both a success and a hard server rejection retire the entry; only a
      // thrown (network) error keeps it for retry.
      await removeQueued(item.id);
      if (res.ok) synced += 1;
    } catch {
      // still offline / server unreachable — stop; keep the rest queued.
      break;
    }
  }
  const remaining = await countQueued();
  return { synced, remaining };
}
