import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';
import type { Album, Track } from '../src/app/core/models';
import { HomeComponent } from '../src/app/features/home/home.component';
import { findRecentPlayableTrack, parseRecentPlays, recentTrackCollection, recentlyPlayedAlbums, recordRecentPlay, type RecentPlay } from '../src/app/core/layout/recent-plays.service';

const track = (id: string, changes: Partial<Track> = {}): Track => ({
  id, path: `/music/${id}.flac`, fileName: `${id}.flac`, title: id,
  artist: null, albumArtist: null, album: null, genre: null, year: null,
  trackNumber: null, discNumber: null, duration: 180, codec: 'FLAC', bitrate: null,
  sampleRate: 44100, bitDepth: 16, channels: 2, artwork: null, fileSize: null,
  lastModified: null, isAvailable: true, ...changes,
});
const album = (id: string, trackIds: string[]): Album => ({ id, title: id, artist: null, year: null, artwork: null, trackIds });
const entries = (...ids: string[]): RecentPlay[] => ids.map((trackId, i) => ({ trackId, playedAt: 100 - i }));
const byId = (...tracks: Track[]) => new Map(tracks.map((item) => [item.id, item]));

describe('recent play history', () => {
  it('puts a new track first without modifying the previous history', () => {
    const previous = entries('old');
    expect(recordRecentPlay(previous, 'new', 200)).toEqual([{ trackId: 'new', playedAt: 200 }, ...previous]);
    expect(previous).toEqual(entries('old'));
  });
  it('moves a duplicate to the front and updates its timestamp', () => {
    expect(recordRecentPlay(entries('a', 'b', 'c'), 'b', 200)).toEqual([
      { trackId: 'b', playedAt: 200 }, { trackId: 'a', playedAt: 100 }, { trackId: 'c', playedAt: 98 },
    ]);
  });
  it('limits history to 20 entries and drops the oldest', () => {
    const previous = entries(...Array.from({ length: 20 }, (_, i) => `track-${i}`));
    const result = recordRecentPlay(previous, 'new', 200);
    expect(result).toHaveLength(20);
    expect(result[0].trackId).toBe('new');
    expect(result.at(-1)?.trackId).toBe('track-18');
  });
  it.each([null, 'rác', '{', 'null', '{}', '[null]', '[1]', '[{"trackId":"a"}]', '[{"trackId":"","playedAt":1}]', '[{"trackId":"a","playedAt":"1"}]', '[{"trackId":"a","playedAt":-1}]'])('treats invalid or absent storage %s as empty', (raw) => {
    expect(parseRecentPlays(raw)).toEqual([]);
  });
  it('rejects the entire list if any entry has the wrong shape', () => {
    expect(parseRecentPlays(JSON.stringify([{ trackId: 'a', playedAt: 1 }, { wrong: true }]))).toEqual([]);
  });
  it('normalizes loaded history to newest first, unique IDs and at most 20', () => {
    const stored = [...Array.from({ length: 25 }, (_, i) => ({ trackId: `track-${i}`, playedAt: i })), { trackId: 'track-24', playedAt: 100 }];
    const result = parseRecentPlays(JSON.stringify(stored));
    expect(result).toHaveLength(20);
    expect(result[0]).toEqual({ trackId: 'track-24', playedAt: 100 });
    expect(new Set(result.map((item) => item.trackId)).size).toBe(20);
  });
});

describe('history hero selection', () => {
  it('skips deleted and missing tracks and selects the next available track', () => {
    const available = track('available');
    expect(findRecentPlayableTrack(entries('deleted', 'missing', 'available', 'older'), byId(track('missing', { isAvailable: false }), available, track('older')))).toBe(available);
  });
  it('returns null when history is empty or has no playable track', () => {
    expect(findRecentPlayableTrack([], byId(track('a')))).toBeNull();
    expect(findRecentPlayableTrack(entries('deleted', 'missing'), byId(track('missing', { isAvailable: false })))).toBeNull();
  });
});

describe('recently played albums', () => {
  it('keeps history order, deduplicates albums and excludes the hero album', () => {
    const hero = album('hero', ['h1', 'h2']);
    const first = album('first', ['a1', 'a2']);
    const second = album('second', ['b1']);
    expect(recentlyPlayedAlbums(entries('h1', 'a1', 'a2', 'deleted', 'b1', 'h2'), [hero, first, second], hero.id)).toEqual([first, second]);
  });
  it('is empty when only the hero album has history', () => {
    expect(recentlyPlayedAlbums(entries('a'), [album('hero', ['a'])], 'hero')).toEqual([]);
  });
});

describe('resume album collection', () => {
  it('orders available tracks by disc and track number and starts at the historical track', () => {
    const first = track('first', { discNumber: 1, trackNumber: 1 });
    const target = track('target', { discNumber: 1, trackNumber: 2 });
    const nextDisc = track('next-disc', { discNumber: 2, trackNumber: 1 });
    const missing = track('missing', { discNumber: 1, trackNumber: 3, isAvailable: false });
    const collection = recentTrackCollection(target, album('album', ['next-disc', 'missing', 'target', 'first']), byId(first, target, nextDisc, missing));
    expect(collection.tracks).toEqual([first, target, nextDisc]);
    expect(collection.startIndex).toBe(1);
  });
  it('plays the historical track alone when its album cannot be found', () => {
    const target = track('target');
    expect(recentTrackCollection(target, null, byId(target))).toEqual({ tracks: [target], startIndex: 0 });
  });
  it('does not create a collection for an unavailable standalone track', () => {
    expect(recentTrackCollection(track('missing', { isAvailable: false }), null, new Map())).toEqual({ tracks: [], startIndex: 0 });
  });
});

describe('Home hero action', () => {
  const home = (hero: object, tracks = new Map<string, Track>()) => {
    const player = { togglePlayPause: vi.fn(), playCollection: vi.fn() };
    const onPlayAlbum = vi.fn();
    return { hero: () => hero, trackMapSignal: () => tracks, player, onPlayAlbum };
  };
  it('toggles the current track without rebuilding its queue', () => {
    const component = home({ kind: 'current', playable: true });
    HomeComponent.prototype.onPlayHero.call(component as unknown as HomeComponent);
    expect(component.player.togglePlayPause).toHaveBeenCalledOnce();
    expect(component.player.playCollection).not.toHaveBeenCalled();
  });
  it('passes the album collection and historical index to the player', () => {
    const first = track('first', { trackNumber: 1 });
    const target = track('target', { trackNumber: 2 });
    const component = home({ kind: 'recent', playable: true, track: target, album: album('album', ['target', 'first']) }, byId(first, target));
    HomeComponent.prototype.onPlayHero.call(component as unknown as HomeComponent);
    expect(component.player.playCollection).toHaveBeenCalledWith([first, target], 1);
  });
  it('delegates the first-run album to the existing album action', () => {
    const item = album('first', ['track']);
    const component = home({ kind: 'album', playable: true, album: item });
    HomeComponent.prototype.onPlayHero.call(component as unknown as HomeComponent);
    expect(component.onPlayAlbum).toHaveBeenCalledWith(item);
  });
});