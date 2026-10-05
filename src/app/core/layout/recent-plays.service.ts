import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { orderAlbumTracks, type Album, type Track } from '../models';
import { PlayerService } from '../player/player.service';

export interface RecentPlay {
  trackId: string;
  playedAt: number;
}

export const RECENT_PLAYS_KEY = 'lutsra.recentPlays';
const RECENT_PLAYS_LIMIT = 20;

export function parseRecentPlays(raw: string | null): RecentPlay[] {
  try {
    const value: unknown = raw === null ? [] : JSON.parse(raw);
    if (!Array.isArray(value) || !value.every((entry) =>
      entry !== null && typeof entry === 'object' &&
      typeof entry.trackId === 'string' && entry.trackId.trim().length > 0 &&
      typeof entry.playedAt === 'number' && Number.isFinite(entry.playedAt) && entry.playedAt >= 0,
    )) return [];
    const seen = new Set<string>();
    return [...value].sort((a, b) => b.playedAt - a.playedAt)
      .filter((entry) => {
        if (seen.has(entry.trackId)) return false;
        seen.add(entry.trackId);
        return true;
      }).slice(0, RECENT_PLAYS_LIMIT)
      .map(({ trackId, playedAt }) => ({ trackId, playedAt }));
  } catch {
    return [];
  }
}

export function recordRecentPlay(entries: readonly RecentPlay[], trackId: string, playedAt: number): RecentPlay[] {
  return [{ trackId, playedAt }, ...entries.filter((entry) => entry.trackId !== trackId)]
    .slice(0, RECENT_PLAYS_LIMIT);
}

export function findRecentPlayableTrack(entries: readonly RecentPlay[], tracks: ReadonlyMap<string, Track>): Track | null {
  for (const entry of entries) {
    const track = tracks.get(entry.trackId);
    if (track?.isAvailable) return track;
  }
  return null;
}

export function recentlyPlayedAlbums(entries: readonly RecentPlay[], albums: readonly Album[], heroAlbumId: string | null): Album[] {
  const seen = new Set<string>();
  if (heroAlbumId) seen.add(heroAlbumId);
  const result: Album[] = [];
  for (const entry of entries) {
    const album = albums.find((item) => item.trackIds.includes(entry.trackId));
    if (!album || seen.has(album.id)) continue;
    seen.add(album.id);
    result.push(album);
  }
  return result;
}

export function recentTrackCollection(track: Track, album: Album | null, tracks: ReadonlyMap<string, Track>): { tracks: Track[]; startIndex: number } {
  const available = album ? orderAlbumTracks(album.trackIds
    .map((id) => tracks.get(id)).filter((item): item is Track => item?.isAvailable === true)) : [];
  const startIndex = available.findIndex((item) => item.id === track.id);
  return startIndex >= 0 ? { tracks: available, startIndex } : { tracks: track.isAvailable ? [track] : [], startIndex: 0 };
}

@Injectable({ providedIn: 'root' })
export class RecentPlaysService {
  private readonly player = inject(PlayerService);
  private readonly entriesState = signal<RecentPlay[]>(this.read());
  readonly entries = this.entriesState.asReadonly();

  constructor() {
    let previousTrackId: string | null = null;
    effect(() => {
      const trackId = this.player.currentTrack()?.id ?? null;
      if (trackId === previousTrackId) return;
      previousTrackId = trackId;
      if (trackId === null) return;
      untracked(() => {
        const entries = recordRecentPlay(this.entriesState(), trackId, Date.now());
        this.entriesState.set(entries);
        try {
          localStorage.setItem(RECENT_PLAYS_KEY, JSON.stringify(entries));
        } catch {
          // Listening history remains usable in memory when storage is unavailable.
        }
      });
    });
  }

  private read(): RecentPlay[] {
    try {
      return parseRecentPlays(localStorage.getItem(RECENT_PLAYS_KEY));
    } catch {
      return [];
    }
  }
}
