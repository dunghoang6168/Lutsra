export interface FrequencyBand {
  readonly start: number;
  readonly end: number;
}

export function createLogFrequencyBands(
  binCount: number,
  barCount: number,
  sampleRate = 48_000,
  minimumFrequency = 40,
  maximumFrequency = 16_000,
): FrequencyBand[] {
  if (binCount <= 0 || barCount <= 0 || sampleRate <= 0) return [];
  const nyquist = sampleRate / 2;
  const minimum = Math.max(1, Math.min(minimumFrequency, nyquist));
  const maximum = Math.max(minimum, Math.min(maximumFrequency, nyquist));
  const ratio = maximum / minimum;

  return Array.from({ length: barCount }, (_, index) => {
    const lowHz = minimum * Math.pow(ratio, index / barCount);
    const highHz = minimum * Math.pow(ratio, (index + 1) / barCount);
    const start = Math.max(0, Math.min(binCount - 1, Math.floor(lowHz / nyquist * binCount)));
    const end = Math.max(start + 1, Math.min(binCount, Math.ceil(highHz / nyquist * binCount)));
    return { start, end };
  });
}

// ponytail: tuned by eye. FLOOR drops the quiet bed (~-66 dB) so hits stand out,
// CURVE adds contrast, RELEASE_S is the fall time constant.
export const SPECTRUM_FLOOR = 0.3;
const SPECTRUM_CURVE = 1.3;
const SPECTRUM_RELEASE_S = 0.08;

// Bars jump to a louder value at once and fall back on a frame-rate independent decay.
export function updateSpectrumLevels(
  frequencyData: Uint8Array,
  bands: readonly FrequencyBand[],
  levels: Float32Array,
  dtSeconds: number,
): void {
  const count = Math.min(bands.length, levels.length);
  const fall = Math.exp(-Math.max(0, dtSeconds) / SPECTRUM_RELEASE_S);
  for (let bandIndex = 0; bandIndex < count; bandIndex++) {
    const band = bands[bandIndex];
    let peak = 0;
    for (let index = band.start; index < band.end && index < frequencyData.length; index++) {
      peak = Math.max(peak, frequencyData[index]);
    }
    const next = Math.max(0, (peak / 255 - SPECTRUM_FLOOR) / (1 - SPECTRUM_FLOOR)) ** SPECTRUM_CURVE;
    levels[bandIndex] = Math.max(next, levels[bandIndex] * fall);
  }
}

export function decaySpectrumLevels(levels: Float32Array, factor: number): boolean {
  let active = false;
  for (let index = 0; index < levels.length; index++) {
    levels[index] *= factor;
    if (levels[index] > 0.01) active = true;
    else levels[index] = 0;
  }
  return active;
}
