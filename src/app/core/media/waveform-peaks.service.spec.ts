import { extractWaveformPeaks } from './waveform-peaks.service';
import { WaveformPeaksService } from './waveform-peaks.service';
import { Track } from '../models';
import { WaveformPersistentCache } from './waveform-persistent-cache';

describe('extractWaveformPeaks', () => {
  it('represents quiet and loud parts of a whole track in playback order', () => {
    const left = new Float32Array([0, 0, 0, 0, 0.25, 0.25, 0.25, 0.25, 1, 1, 1, 1]);
    const right = new Float32Array(left);
    const audio = {
      length: left.length,
      numberOfChannels: 2,
      getChannelData: (index: number) => index === 0 ? left : right,
    } as AudioBuffer;

    const peaks = extractWaveformPeaks(audio, 3);

    expect(Array.from(peaks)).toEqual([0, 0.25, 1]);
  });

  it('does not cancel opposite-phase stereo channels', () => {
    const audio = {
      length: 4,
      numberOfChannels: 2,
      getChannelData: (index: number) => new Float32Array(4).fill(index === 0 ? 0.5 : -0.5),
    } as AudioBuffer;

    expect(Array.from(extractWaveformPeaks(audio, 2))).toEqual([1, 1]);
  });

  it('keeps sustained loudness visible next to a brief transient in non-FLAC audio', () => {
    const samples = new Float32Array([0, 0, 1, 0, 0.5, 0.5, 0.5, 0.5]);
    const audio = {
      length: samples.length,
      numberOfChannels: 1,
      getChannelData: () => samples,
    } as unknown as AudioBuffer;

    const levels = extractWaveformPeaks(audio, 2);
    expect(levels[0]).toBe(1);
    expect(levels[1]).toBeGreaterThan(0.8);
    expect(levels[1]).toBeLessThan(1);
  });
});

describe('WaveformPeaksService FLAC worker', () => {
  const track = {
    id: `track-${'a'.repeat(64)}`,
    fileName: 'large.flac',
    codec: 'FLAC',
    fileSize: 500 * 1024 * 1024,
    lastModified: 123,
  } as Track;
  let originalWorker: PropertyDescriptor | undefined;
  let workers: FakeWorker[];

  class FakeWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    terminated = false;
    postedTrackId: string | null = null;
    constructor() { workers.push(this); }
    postMessage(message: { trackId: string }): void { this.postedTrackId = message.trackId; }
    terminate(): void { this.terminated = true; }
    complete(peaks: Float32Array): void {
      this.onmessage?.({ data: { type: 'done', peaks: peaks.buffer } } as MessageEvent);
    }
    fail(stage: string): void {
      this.onmessage?.({ data: { type: 'error', stage, message: 'broken file' } } as MessageEvent);
    }
  }

  beforeEach(() => {
    workers = [];
    spyOn(WaveformPersistentCache.prototype, 'get').and.resolveTo(null);
    spyOn(WaveformPersistentCache.prototype, 'put').and.resolveTo();
    originalWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
    Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: FakeWorker });
  });

  afterEach(() => {
    if (originalWorker) Object.defineProperty(globalThis, 'Worker', originalWorker);
    else Reflect.deleteProperty(globalThis, 'Worker');
  });

  it('analyzes FLAC beyond the old size limits and reuses cached peaks', async () => {
    const service = new WaveformPeaksService();
    const pending = service.getPeaks(track, new AbortController().signal);
    await Promise.resolve();
    expect(workers.length).toBe(1);
    expect(workers[0].postedTrackId).toBe(track.id);
    const peaks = new Float32Array([0, 0.4, 1]);
    workers[0].complete(peaks);
    expect(Array.from(await pending)).toEqual(Array.from(peaks));
    expect(workers[0].terminated).toBeTrue();
    expect(await service.getPeaks(track, new AbortController().signal)).toBe(await pending);
    expect(workers.length).toBe(1);
  });

  it('terminates analysis when the track changes and reports decoder errors', async () => {
    const service = new WaveformPeaksService();
    const controller = new AbortController();
    const cancelled = service.getPeaks(track, controller.signal);
    await Promise.resolve();
    controller.abort();
    await expectAsync(cancelled).toBeRejectedWith(jasmine.objectContaining({ name: 'AbortError' }));
    expect(workers[0].terminated).toBeTrue();

    const failed = service.getPeaks(track, new AbortController().signal);
    await Promise.resolve();
    workers[1].fail('decode');
    await expectAsync(failed).toBeRejectedWithError(/FLAC decode failed: broken file/);
    expect(workers[1].terminated).toBeTrue();
  });

  it('forwards preview callbacks before the final result and ignores late messages after cancellation', async () => {
    const service = new WaveformPeaksService();
    const controller = new AbortController();
    const progress = jasmine.createSpy('progress');
    const pending = service.getPeaks(track, controller.signal, progress);
    await Promise.resolve();
    workers[0].onmessage?.({ data: { type: 'progress', peaks: new Float32Array(1024).fill(0.5).buffer, coverage: 0.25 } } as MessageEvent);
    expect(progress).toHaveBeenCalledOnceWith(jasmine.objectContaining({ coverage: 0.25 }));
    controller.abort();
    workers[0].onmessage?.({ data: { type: 'progress', peaks: new Float32Array(1024).buffer, coverage: 0.5 } } as MessageEvent);
    await expectAsync(pending).toBeRejectedWith(jasmine.objectContaining({ name: 'AbortError' }));
    expect(progress).toHaveBeenCalledTimes(1);
  });

  it('uses a complete disk-cache hit without starting the FLAC worker', async () => {
    const cached = new Float32Array(1024).fill(0.3);
    (WaveformPersistentCache.prototype.get as jasmine.Spy).and.resolveTo(cached);
    const service = new WaveformPeaksService();
    expect(await service.getPeaks(track, new AbortController().signal)).toBe(cached);
    expect(workers.length).toBe(0);
  });

  it('does not start decoding when a request is cancelled during the disk lookup', async () => {
    let resolveLookup!: (peaks: Float32Array | null) => void;
    (WaveformPersistentCache.prototype.get as jasmine.Spy).and.returnValue(
      new Promise<Float32Array | null>((resolve) => { resolveLookup = resolve; }));
    const service = new WaveformPeaksService();
    const controller = new AbortController();
    const pending = service.getPeaks(track, controller.signal);
    controller.abort();
    resolveLookup(null);
    await expectAsync(pending).toBeRejectedWith(jasmine.objectContaining({ name: 'AbortError' }));
    expect(workers.length).toBe(0);
  });
});
