import { describe, expect, it } from 'vitest';
import type { QueueEntry, Track } from '../src/app/core/models';
import { nextQueueEntries, selectPlaylistArtwork } from '../src/app/shared/utils/list-media';

const track = (id: string, artwork: string | null = null) => ({ id, artwork } as Track);
const entries = (tracks: readonly Track[]) => tracks.map(({ id }) => ({ trackId: id }));

describe('playlist artwork', () => {
  it.each([0, 1, 3, 4, 6])('selects up to four distinct artworks from %s images', (count) => {
    const tracks = Array.from({ length: count }, (_, i) => track(String(i), 'cover-' + i));
    expect(selectPlaylistArtwork(entries(tracks), tracks)).toEqual(tracks.slice(0, 4).map(t => t.artwork));
  });
  it('deduplicates artwork across tracks and repeated playlist entries', () => {
    const tracks = [track('a', 'cover-a'), track('b', 'cover-a'), track('c', 'cover-c')];
    expect(selectPlaylistArtwork([{ trackId: 'a' }, { trackId: 'a' }, ...entries(tracks)], tracks))
      .toEqual(['cover-a', 'cover-c']);
  });
  it('skips tracks with no artwork and tracks removed from the library', () => {
    const tracks = [track('a'), track('b', ''), track('c', 'cover-c')];
    expect(selectPlaylistArtwork([{ trackId: 'removed' }, ...entries(tracks)], tracks)).toEqual(['cover-c']);
  });
  it('uses playlist order with map input, without mutating inputs', () => {
    const tracks = Object.freeze([track('a', 'cover-a'), track('b', 'cover-b')]);
    const playlist = Object.freeze([{ trackId: 'b' }, { trackId: 'a' }]);
    expect(selectPlaylistArtwork(playlist, new Map(tracks.map(t => [t.id, t])))).toEqual(['cover-b', 'cover-a']);
    expect(tracks.map(t => t.id)).toEqual(['a', 'b']);
    expect(playlist.map(e => e.trackId)).toEqual(['b', 'a']);
  });
});

describe('Up next queue entries', () => {
  const queue: QueueEntry[] = Array.from({ length: 7 }, (_, i) => ({
    id: 'entry-' + i, track: track('track-' + i), originalIndex: 6 - i,
  }));
  it('takes the next three entries at the start', () => {
    expect(nextQueueEntries(queue, 0)).toEqual([1, 2, 3].map(index => ({ entry: queue[index], index })));
  });
  it('takes the next three entries in the middle', () => {
    expect(nextQueueEntries(queue, 2)).toEqual([3, 4, 5].map(index => ({ entry: queue[index], index })));
  });
  it('returns only remaining entries near the end', () => {
    expect(nextQueueEntries(queue, 5)).toEqual([{ entry: queue[6], index: 6 }]);
  });
  it('returns no entries at the end', () => expect(nextQueueEntries(queue, 6)).toEqual([]));
  it('handles an empty queue', () => expect(nextQueueEntries([], -1)).toEqual([]));
  it('returns no preview when there is no current entry', () => expect(nextQueueEntries(queue, -1)).toEqual([]));
  it('preserves queue order and duplicate tracks with independent entry IDs', () => {
    const shuffled = Object.freeze([queue[4], queue[1], { ...queue[1], id: 'duplicate' }, queue[6]]);
    const preview = nextQueueEntries(shuffled, 0);
    expect(preview.map(x => x.entry.id)).toEqual(['entry-1', 'duplicate', 'entry-6']);
    expect(preview.map(x => x.index)).toEqual([1, 2, 3]);
    expect(shuffled[0]).toBe(queue[4]);
  });
});
