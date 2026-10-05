import type { Track } from '../../core/models';

// music-metadata reports WAV/AIFF as "PCM" and APE as "Monkey's Audio", so match by substring.
const LOSSLESS_CODEC = /flac|alac|pcm|wav|aif|monkey|wavpack|tta|dsd/i;
export const formatCount = new Intl.NumberFormat('en-US');

export type TrackQuality = 'hires' | 'lossless' | 'lossy';
export const QUALITY_FILTERS = ['lossless', 'hires', 'lossy'] as const;

export interface QualityStats {
  total: number;
  lossless: number;
  hires: number;
  lossy: number;
  missing: number;
}

/** Hi-Res is lossless at 24-bit or above 48 kHz; null when the codec is unknown. */
export function trackQuality(track: Track): TrackQuality | null {
  if (!track.codec) return null;
  if (!LOSSLESS_CODEC.test(track.codec)) return 'lossy';
  return (track.bitDepth ?? 0) >= 24 || (track.sampleRate ?? 0) > 48000 ? 'hires' : 'lossless';
}

/** `quality=lossless` includes Hi-Res files, matching the Home counts. */
export function matchesQualityFilter(track: Track, filter: string): boolean {
  const quality = trackQuality(track);
  if (filter === 'lossless') return quality === 'lossless' || quality === 'hires';
  return quality === filter;
}

export function summarizeQuality(tracks: Track[]): QualityStats {
  const stats: QualityStats = { total: tracks.length, lossless: 0, hires: 0, lossy: 0, missing: 0 };
  for (const track of tracks) {
    if (!track.isAvailable) stats.missing++;
    const quality = trackQuality(track);
    if (quality === 'lossy') stats.lossy++;
    else if (quality) {
      stats.lossless++;
      if (quality === 'hires') stats.hires++;
    }
  }
  return stats;
}

export function formatQualityLine(stats: QualityStats): string {
  const parts = [`${formatCount.format(stats.lossless)} lossless`, `${formatCount.format(stats.hires)} hi-res`];
  if (stats.missing > 0) parts.push(`${formatCount.format(stats.missing)} missing`);
  return parts.join(' · ');
}

export interface FormatLabel {
  label: string;
  hires: boolean;
}

/** Compact measurement such as "FLAC 24/96" or "MP3 320k" for one track. */
export function formatTrackFormat(track: Track): FormatLabel | null {
  if (!track.codec) return null;
  const codec = track.codec.toUpperCase();
  const quality = trackQuality(track);
  if (quality === 'lossy') {
    const kbps = track.bitrate ? Math.round(track.bitrate / 1000) : 0;
    return { label: kbps ? `${codec} ${kbps}k` : codec, hires: false };
  }
  const khz = track.sampleRate ? formatKhz(track.sampleRate) : '';
  const resolution = track.bitDepth && khz ? `${track.bitDepth}/${khz}` : khz;
  return { label: resolution ? `${codec} ${resolution}` : codec, hires: quality === 'hires' };
}

/** Resolution for the Songs measurement column; lossy files never show bit depth. */
export function formatResolution(track: Track): string {
  const lossy = trackQuality(track) === 'lossy';
  if (lossy && track.bitrate) return `${Math.round(track.bitrate / 1000)}k`;
  if (!track.sampleRate) return '—';
  const khz = formatKhz(track.sampleRate);
  return !lossy && track.bitDepth ? `${track.bitDepth}/${khz}` : `${khz} kHz`;
}

/** The best format an album carries; "Mixed" when its tracks use more than one codec. */
export function formatAlbumFormat(tracks: Track[]): FormatLabel | null {
  const known = tracks.filter((track) => track.codec);
  if (!known.length) return null;
  const codecs = new Set(known.map((track) => track.codec!.toUpperCase()));
  const best = known.reduce((a, b) => score(b) > score(a) ? b : a);
  const label = formatTrackFormat(best);
  if (!label || codecs.size === 1) return label;
  return { label: `Mixed · up to ${label.label}`, hires: label.hires };
}

export function formatKhz(sampleRate: number): string {
  const khz = sampleRate / 1000;
  return Number.isInteger(khz) ? `${khz}` : khz.toFixed(1);
}

function score(track: Track): number {
  const lossless = trackQuality(track) !== 'lossy' ? 1e9 : 0;
  return lossless + (track.bitDepth ?? 0) * 1e6 + (track.sampleRate ?? 0) + (track.bitrate ?? 0) / 1e3;
}

/** Album id → its best format, for album grids. */
export function albumFormatMap(albums: { id: string; trackIds: string[] }[], tracks: Track[]): Map<string, FormatLabel | null> {
  const byId = new Map(tracks.map((track) => [track.id, track] as const));
  return new Map(albums.map((album) => [
    album.id,
    formatAlbumFormat(album.trackIds.map((id) => byId.get(id)).filter((track): track is Track => !!track)),
  ] as const));
}
