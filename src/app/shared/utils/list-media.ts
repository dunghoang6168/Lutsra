import type { PlaylistEntry, QueueEntry, Track } from '../../core/models';

/** First four distinct artworks, in playlist entry order. */
export function selectPlaylistArtwork(
  entries: readonly Pick<PlaylistEntry, 'trackId'>[],
  tracks: readonly Track[] | ReadonlyMap<string, Track>,
): string[] {
  const trackMap = 'get' in tracks ? tracks : new Map(tracks.map((track) => [track.id, track]));
  const artworks = new Set<string>();
  for (const entry of entries) {
    const artwork = trackMap.get(entry.trackId)?.artwork?.trim();
    if (artwork) artworks.add(artwork);
    if (artworks.size === 4) break;
  }
  return [...artworks];
}

/** Queue indexes, rather than original indexes, also preserve the active shuffle order. */
export function nextQueueEntries(queue: readonly QueueEntry[], currentIndex: number) {
  if (currentIndex < 0 || currentIndex >= queue.length) return [];
  return queue.slice(currentIndex + 1, currentIndex + 4)
    .map((entry, offset) => ({ entry, index: currentIndex + 1 + offset }));
}
