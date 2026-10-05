import { describe, expect, it, vi } from 'vitest';

describe('contrast script pure exports', () => {
  it('imports without running the CLI', async () => {
    const output = vi.spyOn(console, 'log');
    try {
      await import('../scripts/check-accent-contrast.mjs');
      expect(output).not.toHaveBeenCalled();
    } finally { output.mockRestore(); }
  });
  it('computes black–white CIE76 ΔE approximately 100', async () => {
    const { cie76DeltaE } = await import('../scripts/check-accent-contrast.mjs');
    expect(cie76DeltaE('#000000', '#ffffff')).toBeCloseTo(100, 4);
  });
  it('computes zero for identical colours', async () => {
    const { cie76DeltaE } = await import('../scripts/check-accent-contrast.mjs');
    expect(cie76DeltaE('#c2410c', '#c2410c')).toBe(0);
  });
  it('is symmetric for distinct colours', async () => {
    const { cie76DeltaE } = await import('../scripts/check-accent-contrast.mjs');
    expect(cie76DeltaE('#f97316', '#f59e0b')).toBeCloseTo(cie76DeltaE('#f59e0b', '#f97316'), 10);
  });
  it('uses the D65 white point', async () => {
    const { srgbToLab } = await import('../scripts/check-accent-contrast.mjs');
    const [l, a, b] = srgbToLab('#ffffff');
    expect(l).toBeCloseTo(100, 4);
    expect(a).toBeCloseTo(0, 4);
    expect(b).toBeCloseTo(0, 4);
  });
});
