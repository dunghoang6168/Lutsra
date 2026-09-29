import { Injectable } from '@angular/core';
import { Track } from '../models';
import { WaveformPersistentCache } from './waveform-persistent-cache';

const PEAK_COUNT = 1024;
const MAX_FILE_BYTES = 192 * 1024 * 1024;
const MAX_DECODED_BYTES = 384 * 1024 * 1024;
const CACHE_LIMIT = 8;

export interface WaveformPreview { peaks: Float32Array; coverage: number; }

@Injectable({ providedIn: 'root' })
export class WaveformPeaksService {
  private readonly cache = new Map<string, Float32Array>();
  private readonly persistentCache = new WaveformPersistentCache();

  async getPeaks(track: Track, signal: AbortSignal, onProgress?: (preview: WaveformPreview) => void): Promise<Float32Array> {
    if (signal.aborted) throw new DOMException('Analysis cancelled', 'AbortError');
    const key = `${track.id}:${track.fileSize ?? ''}:${track.lastModified ?? ''}`;
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    const stored = await this.persistentCache.get(track);
    if (signal.aborted) throw new DOMException('Analysis cancelled', 'AbortError');
    if (stored) {
      this.remember(key, stored);
      return stored;
    }
    const peaks = isFlac(track)
      ? await this.decodeFlac(track, signal, onProgress)
      : await this.decodeWholeFile(track, signal);
    if (signal.aborted) throw new DOMException('Analysis cancelled', 'AbortError');
    this.remember(key, peaks);
    void this.persistentCache.put(track, peaks);
    return peaks;
  }

  private remember(key: string, peaks: Float32Array): void {
    this.cache.set(key, peaks);
    if (this.cache.size > CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value!);
  }

  private decodeFlac(track: Track, signal: AbortSignal, onProgress?: (preview: WaveformPreview) => void): Promise<Float32Array> {
    return new Promise((resolve, reject) => {
      let worker: Worker;
      try {
        worker = new Worker(new URL('./waveform-peaks.worker', import.meta.url), { type: 'module' });
      } catch (error) {
        reject(new Error(`FLAC worker start failed: ${error instanceof Error ? error.message : String(error)}`));
        return;
      }
      let settled = false;
      const finish = (result: Float32Array | Error): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        worker.terminate();
        if (result instanceof Error) reject(result);
        else resolve(result);
      };
      const onAbort = (): void => finish(new DOMException('Analysis cancelled', 'AbortError'));
      signal.addEventListener('abort', onAbort, { once: true });
      worker.onmessage = (event: MessageEvent<{ type: 'done' | 'progress'; peaks: ArrayBuffer; coverage?: number } | { type: 'error'; stage: string; message: string }>) => {
        const result = event.data;
        if (result.type === 'error') finish(new Error(`FLAC ${result.stage} failed: ${result.message}`));
        else if (result.type === 'progress') {
          if (!signal.aborted && !settled && onProgress && Number.isFinite(result.coverage)) {
            onProgress({ peaks: new Float32Array(result.peaks), coverage: Math.max(0, Math.min(1, result.coverage!)) });
          }
        } else finish(new Float32Array(result.peaks));
      };
      worker.onerror = (event) => finish(new Error(`FLAC worker failed: ${event.message}`));
      if (signal.aborted) onAbort();
      else worker.postMessage({ trackId: track.id, duration: track.duration });
    });
  }

  private async decodeWholeFile(track: Track, signal: AbortSignal): Promise<Float32Array> {
    if (track.fileSize !== null && track.fileSize > MAX_FILE_BYTES) throw new Error('Audio file is too large to analyze');
    const estimatedBytes = track.duration * (track.sampleRate || 48_000) * (track.channels || 2) * 4;
    if (estimatedBytes > MAX_DECODED_BYTES) throw new Error('Decoded audio is too large to analyze');

    const response = await fetch(`music://track/${encodeURIComponent(track.id)}`, { signal });
    if (!response.ok) throw new Error('Audio could not be loaded for waveform analysis');
    const size = Number(response.headers.get('content-length'));
    if (size > MAX_FILE_BYTES) {
      await response.body?.cancel();
      throw new Error('Audio file is too large to analyze');
    }
    const encoded = await response.arrayBuffer();
    if (signal.aborted) throw new DOMException('Analysis cancelled', 'AbortError');
    if (encoded.byteLength > MAX_FILE_BYTES) throw new Error('Audio file is too large to analyze');

    const decoder = new OfflineAudioContext(1, 1, 44_100);
    const audio = await decoder.decodeAudioData(encoded);
    if (signal.aborted) throw new DOMException('Analysis cancelled', 'AbortError');
    if (audio.length * audio.numberOfChannels * 4 > MAX_DECODED_BYTES) throw new Error('Decoded audio is too large to analyze');
    return extractWaveformPeaks(audio, PEAK_COUNT);
  }
}

function isFlac(track: Track): boolean {
  return track.codec?.toLowerCase().includes('flac') === true || /\.flac$/i.test(track.fileName);
}

export function extractWaveformPeaks(audio: AudioBuffer, count: number): Float32Array {
  const peaks = new Float32Array(count);
  const channels = Array.from({ length: audio.numberOfChannels }, (_, index) => audio.getChannelData(index));
  if (!channels.length || !audio.length) return peaks;
  let maximum = 0;
  for (let index = 0; index < count; index++) {
    const start = Math.floor(index * audio.length / count);
    const end = Math.max(start + 1, Math.floor((index + 1) * audio.length / count));
    const stride = Math.max(1, Math.floor((end - start) / 512));
    let sum = 0;
    let peak = 0;
    let samples = 0;
    for (let frame = start; frame < end && frame < audio.length; frame += stride) {
      let framePower = 0;
      for (const channel of channels) framePower += channel[frame] * channel[frame] / channels.length;
      sum += framePower;
      peak = Math.max(peak, Math.sqrt(framePower));
      samples++;
    }
    const rms = Math.sqrt(sum / Math.max(1, samples));
    peaks[index] = 0.85 * rms + 0.15 * peak;
    maximum = Math.max(maximum, peaks[index]);
  }
  if (maximum > 0) {
    for (let index = 0; index < count; index++) peaks[index] = Math.min(1, peaks[index] / maximum);
  }
  return peaks;
}
