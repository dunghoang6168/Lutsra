import { aggregateWaveformLevels, WaveformAccumulator } from './waveform-aggregation';

describe('aggregateWaveformLevels', () => {
  it('does not let one brief peak make a whole interval look continuously loud', () => {
    const levels = aggregateWaveformLevels(new Float32Array([0, 0, 1, 0, 0.5, 0.5, 0.5, 0.5]), 2);
    expect(levels[0]).toBeCloseTo(0.575, 5);
    expect(levels[1]).toBeCloseTo(0.5, 5);
  });

  it('keeps silence at zero and preserves time order', () => {
    expect(Array.from(aggregateWaveformLevels(new Float32Array([0, 0.25, 1]), 3))).toEqual([0, 0.25, 1]);
  });
});

describe('WaveformAccumulator', () => {
  it('keeps completed preview columns at fixed positions and amplitudes', () => {
    const accumulator = new WaveformAccumulator();
    accumulator.enablePreview(0.2, 4);
    accumulator.append([new Float32Array(50).fill(0.25)], 50, 1000);
    const first = accumulator.preview()!;
    expect(first.coverage).toBe(0.25);
    expect(Array.from(first.peaks)).toEqual([0.5, 0, 0, 0]);
    accumulator.append([new Float32Array(50).fill(1)], 50, 1000);
    const second = accumulator.preview()!;
    expect(second.coverage).toBe(0.5);
    expect(Array.from(second.peaks)).toEqual([0.5, 1, 0, 0]);
    expect(Array.from(accumulator.finish(4))).toEqual([0.25, 0.25, 1, 1]);
  });

  it('waits for the final waveform when duration metadata is invalid', () => {
    const accumulator = new WaveformAccumulator();
    accumulator.enablePreview(Number.NaN, 4);
    accumulator.append([new Float32Array(50).fill(0.5)], 50, 1000);
    expect(accumulator.preview()).toBeNull();
    expect(accumulator.finish(4).length).toBe(4);
  });

  it('keeps quiet and loud sections in playback order across decoder chunks', () => {
    const accumulator = new WaveformAccumulator();
    accumulator.append([new Float32Array(50), new Float32Array(50)], 50, 1000);
    accumulator.append([new Float32Array(50).fill(0.25), new Float32Array(50).fill(-0.25)], 50, 1000);
    accumulator.append([new Float32Array(50).fill(1), new Float32Array(50).fill(-1)], 50, 1000);

    expect(Array.from(accumulator.finish(3))).toEqual([0, 0.25, 1]);
  });

  it('finishes a partial window and rejects a file with no decoded samples', () => {
    const accumulator = new WaveformAccumulator();
    expect(() => accumulator.finish(2)).toThrowError(/no audio samples/);
    accumulator.append([new Float32Array(25).fill(0.5)], 25, 1000);
    expect(Array.from(accumulator.finish(2))).toEqual([1, 1]);
  });
});
