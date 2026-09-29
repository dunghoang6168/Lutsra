const WINDOW_SECONDS = 0.05;

/** Preserve sustained loudness while retaining a small amount of transient detail. */
export function aggregateWaveformLevels(values: ArrayLike<number>, count: number): Float32Array {
  const levels = new Float32Array(count);
  if (!values.length) return levels;
  for (let index = 0; index < count; index++) {
    const start = Math.floor(index * values.length / count);
    const end = Math.max(start + 1, Math.floor((index + 1) * values.length / count));
    let sumSquares = 0;
    let maximum = 0;
    let samples = 0;
    for (let sample = start; sample < end && sample < values.length; sample++) {
      const value = values[sample];
      sumSquares += value * value;
      maximum = Math.max(maximum, value);
      samples++;
    }
    levels[index] = 0.85 * Math.sqrt(sumSquares / samples) + 0.15 * maximum;
  }
  return levels;
}

/** Keeps one RMS value per 50 ms of audio instead of retaining decoded PCM. */
export class WaveformAccumulator {
  private sampleRate = 0;
  private framesPerWindow = 0;
  private sumSquares = 0;
  private frameCount = 0;
  private totalFrames = 0;
  private readonly windows: number[] = [];
  private previewDuration = 0;
  private previewSumSquares: Float64Array | null = null;
  private previewMaximum: Float32Array | null = null;
  private previewCounts: Uint32Array | null = null;

  enablePreview(durationSeconds: number, peakCount: number): void {
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return;
    this.previewDuration = durationSeconds;
    this.previewSumSquares = new Float64Array(peakCount);
    this.previewMaximum = new Float32Array(peakCount);
    this.previewCounts = new Uint32Array(peakCount);
  }

  /** Preview values use a fixed full-scale mapping, so existing bars never rescale. */
  preview(): { peaks: Float32Array; coverage: number } | null {
    if (!this.previewSumSquares || !this.previewMaximum || !this.previewCounts || !this.sampleRate) return null;
    const peaks = new Float32Array(this.previewCounts.length);
    const stableCount = Math.max(0, Math.min(peaks.length - 1,
      Math.floor(this.totalFrames / (this.previewDuration * this.sampleRate) * peaks.length)));
    for (let index = 0; index < stableCount; index++) {
      const count = this.previewCounts[index];
      if (!count) continue;
      const rms = Math.sqrt(this.previewSumSquares[index] / count);
      const level = 0.85 * rms + 0.15 * this.previewMaximum[index];
      peaks[index] = Math.sqrt(Math.min(1, level));
    }
    const coverage = stableCount / peaks.length;
    return { peaks, coverage };
  }

  append(channelData: readonly Float32Array[], samplesDecoded: number, sampleRate: number): void {
    if (samplesDecoded === 0) return;
    if (!channelData.length || !Number.isFinite(sampleRate) || sampleRate <= 0) {
      throw new Error('Invalid decoded FLAC audio');
    }
    if (this.sampleRate && this.sampleRate !== sampleRate) throw new Error('FLAC sample rate changed during decoding');
    if (!this.sampleRate) {
      this.sampleRate = sampleRate;
      this.framesPerWindow = Math.max(1, Math.round(sampleRate * WINDOW_SECONDS));
    }
    for (let frame = 0; frame < samplesDecoded; frame++) {
      let framePower = 0;
      for (const channel of channelData) {
        const value = channel[frame];
        if (value === undefined) throw new Error('Incomplete decoded FLAC audio');
        framePower += value * value;
      }
      this.sumSquares += framePower / channelData.length;
      this.frameCount++;
      this.totalFrames++;
      if (this.frameCount === this.framesPerWindow) this.finishWindow();
    }
  }

  finish(peakCount: number): Float32Array {
    if (this.frameCount) this.finishWindow();
    if (!this.totalFrames) throw new Error('FLAC decoder produced no audio samples');
    const peaks = aggregateWaveformLevels(this.windows, peakCount);
    let maximum = 0;
    for (let index = 0; index < peakCount; index++) {
      maximum = Math.max(maximum, peaks[index]);
    }
    if (maximum > 0) {
      for (let index = 0; index < peakCount; index++) peaks[index] /= maximum;
    }
    return peaks;
  }

  private finishWindow(): void {
    const rms = Math.sqrt(this.sumSquares / this.frameCount);
    this.windows.push(rms);
    if (this.previewCounts && this.previewSumSquares && this.previewMaximum) {
      const expectedFrames = this.previewDuration * this.sampleRate;
      const middleFrame = this.totalFrames - this.frameCount / 2;
      const index = Math.max(0, Math.min(this.previewCounts.length - 1,
        Math.floor(middleFrame / expectedFrames * this.previewCounts.length)));
      this.previewSumSquares[index] += rms * rms;
      this.previewMaximum[index] = Math.max(this.previewMaximum[index], rms);
      this.previewCounts[index]++;
    }
    this.sumSquares = 0;
    this.frameCount = 0;
  }
}
