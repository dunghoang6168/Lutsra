import { Track } from '../models';
import { WaveformPersistentCache } from './waveform-persistent-cache';

describe('WaveformPersistentCache', () => {
  const track = {
    id: `cache-test-${Math.random()}`,
    fileSize: 123456,
    lastModified: 789,
  } as Track;

  it('restores complete peaks across cache instances and invalidates changed files', async () => {
    const first = new WaveformPersistentCache();
    const peaks = new Float32Array(1024);
    peaks[17] = 0.42;
    await first.put(track, peaks);
    const second = new WaveformPersistentCache();
    expect((await second.get(track))?.[17]).toBeCloseTo(0.42, 5);
    expect(await second.get({ ...track, fileSize: track.fileSize! + 1 })).toBeNull();
    expect(await second.get({ ...track, lastModified: track.lastModified! + 1 })).toBeNull();
  });

  it('rejects malformed stored peaks and continues when storage is unavailable', async () => {
    const cache = new WaveformPersistentCache();
    const bad = new Float32Array(1024);
    bad[0] = Number.NaN;
    await cache.put(track, bad);
    expect(await new WaveformPersistentCache().get(track)).toBeNull();
    const unavailable = new WaveformPersistentCache();
    spyOnProperty(globalThis, 'indexedDB', 'get').and.returnValue(undefined as unknown as IDBFactory);
    expect(await unavailable.get(track)).toBeNull();
    await expectAsync(unavailable.put(track, new Float32Array(1024))).toBeResolved();
  });

  it('rejects an entry with an obsolete algorithm version', async () => {
    const cache = new WaveformPersistentCache();
    await cache.put(track, new Float32Array(1024).fill(0.5));
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('lutsra-waveform', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('peaks', 'readwrite');
      transaction.objectStore('peaks').put({
        key: `v2:${track.id}:${track.fileSize}:${track.lastModified}`,
        trackId: track.id, version: 1, peaks: new Float32Array(1024).fill(0.5).buffer,
        lastAccess: Date.now(),
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
    expect(await new WaveformPersistentCache().get(track)).toBeNull();
  });
});
