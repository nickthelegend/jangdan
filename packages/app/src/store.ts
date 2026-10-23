/** Best togetherness scores and the last take per piece, in IndexedDB (falls back to memory). */
import type { TakeRecord, TogethernessScore } from '@jangdan/core';

const DB = 'jangdan';
const memory = new Map<string, unknown>();
let dbp: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('best');
        req.result.createObjectStore('takes');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbp;
}

async function get<T>(store: string, key: string): Promise<T | undefined> {
  const db = await open();
  if (!db) return memory.get(`${store}:${key}`) as T | undefined;
  return new Promise((resolve) => {
    const r = db.transaction(store).objectStore(store).get(key);
    r.onsuccess = () => resolve(r.result as T | undefined);
    r.onerror = () => resolve(undefined);
  });
}

async function put(store: string, key: string, value: unknown): Promise<void> {
  const db = await open();
  if (!db) {
    memory.set(`${store}:${key}`, value);
    return;
  }
  await new Promise<void>((resolve) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export interface BestRecord {
  total: number;
  score: TogethernessScore;
  date: string;
}

export const store = {
  best: (pieceId: string) => get<BestRecord>('best', pieceId),
  lastTake: (pieceId: string) => get<TakeRecord>('takes', pieceId),
  /** Save a take; returns the previous best and whether this one beat it. */
  async saveTake(take: TakeRecord, score: TogethernessScore): Promise<{ previous: BestRecord | undefined; isBest: boolean }> {
    await put('takes', take.pieceId, take);
    const previous = await get<BestRecord>('best', take.pieceId);
    const isBest = !previous || score.total > previous.total;
    if (isBest) await put('best', take.pieceId, { total: score.total, score, date: take.date });
    return { previous, isBest };
  },
};
