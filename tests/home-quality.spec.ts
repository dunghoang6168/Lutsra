import { describe, expect, it } from 'vitest';
import { summarizeQuality, formatQualityLine, formatTrackFormat, formatAlbumFormat, matchesQualityFilter, formatResolution, trackQuality } from '../src/app/features/home/library-quality';
import type { Track } from '../src/app/core/models';

const t = (codec: string | null, bitDepth: number | null, sampleRate: number | null, isAvailable = true) =>
  ({ codec, bitDepth, sampleRate, isAvailable }) as Track;

describe('summarizeQuality', () => {
  it('counts PCM/ALAC/Monkey as lossless, 24-bit or >48k as hi-res, lossy, and missing files', () => {
    const tracks = [
      t('FLAC', 16, 44100),
      t('PCM', 24, 96000),
      t('ALAC', 16, 44100),
      t("Monkey's Audio", 16, 44100, false),
      t('MPEG 1 Layer 3', null, 44100),
    ];
    const stats = summarizeQuality(tracks);
    expect(stats.total).toBe(5);
    expect(stats.lossless).toBe(4);
    expect(stats.hires).toBe(1);
    expect(stats.lossy).toBe(1);
    expect(stats.missing).toBe(1);
    
    expect(formatQualityLine(stats)).toBe('4 lossless · 1 hi-res · 1 missing');
  });
});

describe('format labels and quality filters', () => {
  const f = (codec: string | null, bitDepth: number | null, sampleRate: number | null, bitrate: number | null = null) =>
    ({ id: codec + String(bitDepth) + String(sampleRate), codec, bitDepth, sampleRate, bitrate, isAvailable: true }) as Track;

  it('labels lossless with depth/rate and lossy with bitrate; only hi-res is flagged', () => {
    expect(formatTrackFormat(f('FLAC', 24, 96000))).toEqual({ label: 'FLAC 24/96', hires: true });
    expect(formatTrackFormat(f('flac', 16, 44100))).toEqual({ label: 'FLAC 16/44.1', hires: false });
    expect(formatTrackFormat(f('MP3', null, 44100, 320000))).toEqual({ label: 'MP3 320k', hires: false });
    expect(formatTrackFormat(f(null, null, null))).toBeNull();
  });

  it('picks the best track for an album and marks mixed codecs', () => {
    expect(formatAlbumFormat([f('FLAC', 16, 44100), f('FLAC', 24, 192000)])?.label).toBe('FLAC 24/192');
    expect(formatAlbumFormat([f('MP3', null, 44100, 320000), f('FLAC', 16, 44100)])?.label).toBe('Mixed · up to FLAC 16/44.1');
  });

  it('lossless filter includes hi-res; hires and lossy are exact', () => {
    const hires = f('FLAC', 24, 96000);
    expect(matchesQualityFilter(hires, 'lossless')).toBe(true);
    expect(matchesQualityFilter(hires, 'hires')).toBe(true);
    expect(matchesQualityFilter(f('FLAC', 16, 44100), 'hires')).toBe(false);
    expect(matchesQualityFilter(f('AAC', null, 44100, 256000), 'lossy')).toBe(true);
  });
});

describe('formatResolution', () => {
  const track = (codec: string | null, bitDepth: number | null, sampleRate: number | null, bitrate: number | null = null) =>
    ({ codec, bitDepth, sampleRate, bitrate }) as Track;

  it('formats 24-bit 96 kHz without units', () => {
    expect(formatResolution(track('FLAC', 24, 96000))).toBe('24/96');
  });
  it('keeps the fractional rate for CD resolution', () => {
    expect(formatResolution(track('FLAC', 16, 44100))).toBe('16/44.1');
  });
  it('includes units when only the sample rate is known', () => {
    expect(formatResolution(track('FLAC', null, 44100))).toBe('44.1 kHz');
  });
  it('prioritizes lossy bitrate over decoded depth and rate', () => {
    expect(formatResolution(track('M4A', 16, 44100, 256000))).toBe('256k');
  });
  it('uses an em dash when resolution is unavailable', () => {
    expect(formatResolution(track(null, null, null))).toBe('—');
  });
  it('omits decoded bit depth for lossy files without bitrate', () => {
    expect(formatResolution(track('MP3', 24, 96000))).toBe('96 kHz');
  });
});

describe('lossy file truth', () => {
  it('classifies MP3 at 96 kHz as lossy, regardless of decoded bit depth', () => {
    expect(trackQuality({ codec: 'MP3', bitDepth: 24, sampleRate: 96000 } as Track)).toBe('lossy');
  });
  it('never includes bit depth in lossy format labels', () => {
    expect(formatTrackFormat({ codec: 'M4A', bitDepth: 16, sampleRate: 44100, bitrate: 256000 } as Track))
      .toEqual({ label: 'M4A 256k', hires: false });
  });
});
