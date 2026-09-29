import { Track } from '../models';

const DATABASE_NAME = 'lutsra-waveform';
const STORE_NAME = 'peaks';
const DATABASE_VERSION = 1;
const ALGORITHM_VERSION = 2;
const PEAK_COUNT = 1024;
const MAX_ENTRIES = 2048;

interface StoredWaveform {
  key: string;
  trackId: string;
  version: number;
  peaks: ArrayBuffer;
  lastAccess: number;
}

/** Optional disk cache: storage failures must never interrupt waveform analysis. */
export class WaveformPersistentCache {
  private database: Promise<IDBDatabase | null> | null = null;

  async get(track: Track): Promise<Float32Array | null> {
    const key = cacheKey(track);
    if (!key) return null;
    try {
      const database = await this.open();
      if (!database) return null;
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const record = await requestResult<StoredWaveform | undefined>(transaction.objectStore(STORE_NAME).get(key));
      if (!record) return null;
      if (record.version !== ALGORITHM_VERSION || !(record.peaks instanceof ArrayBuffer)
        || record.peaks.byteLength !== PEAK_COUNT * Float32Array.BYTES_PER_ELEMENT) {
        void this.remove(key);
        return null;
      }
      const peaks = new Float32Array(record.peaks);
      if (peaks.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
        void this.remove(key);
        return null;
      }
      void this.touch(database, { ...record, lastAccess: Date.now() });
      return peaks;
    } catch {
      return null;
    }
  }

  async put(track: Track, peaks: Float32Array): Promise<void> {
    const key = cacheKey(track);
    if (!key || peaks.length !== PEAK_COUNT) return;
    try {
      const database = await this.open();
      if (!database) return;
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const done = transactionDone(transaction);
      transaction.objectStore(STORE_NAME).put({
        key, trackId: track.id, version: ALGORITHM_VERSION,
        peaks: peaks.slice().buffer, lastAccess: Date.now(),
      } satisfies StoredWaveform);
      await done;
      await this.prune(database);
    } catch { /* The in-memory cache remains available. */ }
  }

  private open(): Promise<IDBDatabase | null> {
    if (this.database) return this.database;
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    this.database = new Promise((resolve) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: 'key' }).createIndex('lastAccess', 'lastAccess');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
    return this.database;
  }

  private async touch(database: IDBDatabase, record: StoredWaveform): Promise<void> {
    try {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const done = transactionDone(transaction);
      transaction.objectStore(STORE_NAME).put(record);
      await done;
    } catch { /* A failed touch is only an eviction-order issue. */ }
  }

  private async remove(key: string): Promise<void> {
    try {
      const database = await this.open();
      if (!database) return;
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const done = transactionDone(transaction);
      transaction.objectStore(STORE_NAME).delete(key);
      await done;
    } catch { /* Reanalysis still proceeds. */ }
  }

  private async prune(database: IDBDatabase): Promise<void> {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore(STORE_NAME);
    const countRequest = store.count();
    countRequest.onsuccess = () => {
      let excess = countRequest.result - MAX_ENTRIES;
      if (excess <= 0) return;
      const cursorRequest = store.index('lastAccess').openKeyCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor || excess <= 0) return;
        store.delete(cursor.primaryKey);
        excess--;
        if (excess > 0) cursor.continue();
      };
    };
    await done;
  }
}

function cacheKey(track: Track): string | null {
  if (!Number.isFinite(track.fileSize) || !Number.isFinite(track.lastModified)
    || track.fileSize === null || track.lastModified === null) return null;
  return `v${ALGORITHM_VERSION}:${track.id}:${track.fileSize}:${track.lastModified}`;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
