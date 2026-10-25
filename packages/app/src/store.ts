/** Best togetherness scores and the last take per piece, in IndexedDB (falls back to memory). */
import type { TakeRecord, TogethernessScore } from '@jangdan/core';

const DB = 'jangdan';
const memory = new Map<string, unknown>();
let dbp: Promise<IDBDatabase | null> | null = null;

function memKey(store: string, key: string): string {
  return `${store}:${key}`;
}

function remember(store: string, key: string, value: unknown): void {
  memory.set(memKey(store, key), value);
}

function recall<T>(store: string, key: string): T | undefined {
  return memory.get(memKey(store, key)) as T | undefined;
}

function open(): Promise<IDBDatabase | null> {
  if (dbp) return dbp;
  const attempt = new Promise<IDBDatabase | null>((resolve) => {
    let settled = false;
    const done = (db: IDBDatabase | null) => {
      if (settled) return;
      settled = true;
      resolve(db);
    };
    try {
      const req = indexedDB.open(DB, 1);
      const timer = setTimeout(() => done(null), 1500);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('best')) db.createObjectStore('best');
        if (!db.objectStoreNames.contains('takes')) db.createObjectStore('takes');
      };
      req.onsuccess = () => {
        clearTimeout(timer);
        done(req.result);
      };
      req.onerror = () => {
        clearTimeout(timer);
        done(null);
      };
      req.onblocked = () => {
        clearTimeout(timer);
        done(null);
      };
    } catch {
      done(null);
    }
  });
  dbp = attempt.then((db) => {
    if (!db) dbp = null;
    return db;
  });
  return dbp;
}

function idbGet<T>(db: IDBDatabase, store: string, key: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    const r = db.transaction(store).objectStore(store).get(key);
    r.onsuccess = () => resolve(r.result as T | undefined);
    r.onerror = () => resolve(undefined);
  });
}

function idbPut(db: IDBDatabase, store: string, key: string, value: unknown): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

async function get<T>(store: string, key: string): Promise<T | undefined> {
  const db = await open();
  if (!db) return recall<T>(store, key);
  return (await idbGet<T>(db, store, key)) ?? recall<T>(store, key);
}

export interface BestRecord {
  total: number;
  score: TogethernessScore;
  date: string;
}

export const store = {
  best: (pieceId: string) => get<BestRecord>('best', pieceId),
  lastTake: (pieceId: string) => get<TakeRecord>('takes', pieceId),
  /**
   * Remember the take in this session before IndexedDB answers. The HUD and the e2e log can
   * show the score on the same frame as the cut-off; persistTake writes the database after.
   */
  stageTake(take: TakeRecord, score: TogethernessScore): { previous: BestRecord | undefined; isBest: boolean } {
    const previous = recall<BestRecord>('best', take.pieceId);
    remember('takes', take.pieceId, take);
    const isBest = !previous || score.total > previous.total;
    if (isBest) remember('best', take.pieceId, { total: score.total, score, date: take.date });
    return { previous, isBest };
  },
  /** Write the staged take to IndexedDB. If that store already holds a higher best, keep it. */
  async persistTake(
    take: TakeRecord,
    score: TogethernessScore,
  ): Promise<{ previous: BestRecord | undefined; isBest: boolean; where: 'idb' | 'memory' }> {
    const db = await open();
    if (!db) return { previous: recall<BestRecord>('best', take.pieceId), isBest: true, where: 'memory' };
    const previous = await idbGet<BestRecord>(db, 'best', take.pieceId);
    const isBest = !previous || score.total > previous.total;
    const takeOk = await idbPut(db, 'takes', take.pieceId, take);
    const bestOk = !isBest || (await idbPut(db, 'best', take.pieceId, { total: score.total, score, date: take.date }));
    if (!isBest && previous) remember('best', take.pieceId, previous);
    if (!takeOk || !bestOk) return { previous, isBest, where: 'memory' };
    return { previous, isBest, where: 'idb' };
  },
  /** Save a take; returns the previous best and whether this one beat it. */
  async saveTake(take: TakeRecord, score: TogethernessScore): Promise<{ previous: BestRecord | undefined; isBest: boolean }> {
    this.stageTake(take, score);
    const saved = await this.persistTake(take, score);
    return { previous: saved.previous, isBest: saved.isBest };
  },
};
