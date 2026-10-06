import '@angular/compiler';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computed, signal } from '@angular/core';
import { convertToParamMap } from '@angular/router';
import { BehaviorSubject, Subject } from 'rxjs';
import { AlbumDetailComponent } from '../src/app/features/albums/album-detail/album-detail.component';
import { ArtistDetailComponent } from '../src/app/features/artists/artist-detail/artist-detail.component';
import { PlaylistDetailComponent } from '../src/app/features/playlists/playlist-detail/playlist-detail.component';
import { LibrarySnapshot } from '../src/app/core/contracts/library.gateway';
import { Album, Artist, Playlist, Track } from '../src/app/core/models';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const track = (id: string): Track => ({
  id, title: id, path: id, fileName: id, artist: id, albumArtist: id, album: id,
  genre: null, year: null, trackNumber: 1, discNumber: 1, duration: 10,
  codec: 'FLAC', bitrate: null, sampleRate: 96000, bitDepth: 24, channels: 2,
  artwork: null, fileSize: null, lastModified: null, isAvailable: true,
});
const tracks = [track('A'), track('B')];
const albums: Album[] = tracks.map(t => ({ id: t.id, title: t.id, artist: t.id, year: null, artwork: null, trackIds: [t.id] }));
const artists: Artist[] = tracks.map(t => ({ id: t.id, name: t.id, albumIds: [t.id], trackIds: [t.id], onlineMetadata: null, customAvatar: null }));
const playlists: Playlist[] = tracks.map(t => ({ id: t.id, name: t.id, entries: [{ id: 'entry-' + t.id, trackId: t.id, addedAt: 0 }], createdAt: 0, updatedAt: 0 }));
const library = (): LibrarySnapshot => ({ tracks: [...tracks], albums: [...albums], artists: [...artists], folders: [] });
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

const surfaces = [
  { name: 'album', type: AlbumDetailComponent, entity: 'album', rows: 'albumTracks', modal: null },
  { name: 'artist', type: ArtistDetailComponent, entity: 'artist', rows: 'artistTracks', modal: 'showMetadataEditor' },
  { name: 'playlist', type: PlaylistDetailComponent, entity: 'playlist', rows: 'trackRows', modal: 'showAddTracksModal' },
] as const;

// Exercise real lifecycle/load methods, using the same prototype harness style as audio-engine.spec.ts.
// DOM rendering and constructor effects are verified separately in the browser.
function harness(surface: typeof surfaces[number]) {
  const params = new BehaviorSubject(convertToParamMap({ id: 'A' }));
  const scan = new BehaviorSubject({ isScanning: false });
  const changed = new Subject<void>();
  const updates = new Subject<any>();
  const requests: ReturnType<typeof deferred<LibrarySnapshot>>[] = [];
  const destroyCallbacks = new Set<() => void>();
  const destroyRef = {
    destroyed: false,
    onDestroy(callback: () => void) {
      destroyCallbacks.add(callback);
      return () => destroyCallbacks.delete(callback);
    },
  };
  const viewport = { scrollTop: 70, scrollLeft: 30 };
  const host = { closest: vi.fn(() => viewport), focus: vi.fn(), blur: vi.fn() };
  const libraryGateway = {
    scanProgress$: scan, libraryChanged$: changed,
    getLibrary: vi.fn(() => { const request = deferred<LibrarySnapshot>(); requests.push(request); return request.promise; }),
    getTrackById: vi.fn(async (id: string) => tracks.find(t => t.id === id) ?? null),
  };
  const playlistGateway = { getPlaylists: vi.fn(async () => playlists), removeEntry: vi.fn(), addTracks: vi.fn() };
  const artistMetadata = {
    updates$: updates, ensureArtist: vi.fn(async () => {}),
    refreshArtist: vi.fn(), searchCandidates: vi.fn(), setArtistMatch: vi.fn(), setWikipediaOverride: vi.fn(),
  };
  const component: any = Object.create(surface.type.prototype);
  Object.assign(component, {
    route: { paramMap: params }, destroyRef, host: { nativeElement: host },
    currentId: undefined, loadToken: 0, routeVersion: 0, libraryGateway, playlistGateway, artistMetadata,
    activeId: signal<string | null>(null), selection: { selected: signal<Track | null>(null) },
    isLoading: signal(true), album: signal(null), albumTracks: signal([]),
    playlist: signal(null), allLibraryTracks: signal([]), entryTracks: signal(new Map()),
    artist: signal(null), artistAlbums: signal([]), artistTracks: signal([]), allTracks: signal([]),
    showAddTracksModal: signal(false), metadataStatus: signal('idle'), metadataError: signal(null),
    biographyExpanded: signal(false), failedAvatars: signal(new Set()), aboutImageFailed: signal(false),
    showMetadataEditor: signal(false), candidateQuery: signal(''), candidates: signal([]),
    selectedCandidateId: signal(null), wikipediaOverride: signal(''), editorLoading: signal(false), editorError: signal(null),
  });
  component.trackRows = computed(() => (component.playlist()?.entries ?? []).map((entry: any) => ({ entry, track: component.entryTracks().get(entry.trackId) })));
  component.ngOnInit();
  const id = () => component[surface.entity]()?.id;
  const rowIds = () => component[surface.rows]().map((row: any) => (row.track ?? row).id);
  const navigate = (id?: string) => params.next(convertToParamMap(id ? { id } : {}));
  const destroy = () => { destroyRef.destroyed = true; for (const callback of [...destroyCallbacks]) callback(); };
  return { component, params, scan, changed, updates, requests, libraryGateway, playlistGateway, artistMetadata, viewport, host, id, rowIds, navigate, destroy };
}
afterEach(() => vi.restoreAllMocks());

describe.each(surfaces)('$name detail router reuse', surface => {
  it('reloads A to B and clears navigation state without calling focus or blur', async () => {
    const h = harness(surface);
    h.requests[0].resolve(library()); await flush();
    expect(h.id()).toBe('A');
    h.component.activeId.set(surface.name === 'playlist' ? 'entry-A' : 'A');
    h.component.selection.selected.set(tracks[0]);
    if (surface.modal) h.component[surface.modal].set(true);
    h.viewport.scrollTop = 200; h.viewport.scrollLeft = 15;
    h.navigate('B');
    expect(h.id()).toBeUndefined();
    expect(h.rowIds()).toEqual([]);
    expect(h.component.activeId()).toBeNull();
    expect(h.component.selection.selected()).toBeNull();
    expect(h.viewport).toEqual({ scrollTop: 0, scrollLeft: 0 });
    if (surface.modal) expect(h.component[surface.modal]()).toBe(false);
    h.requests[1].resolve(library()); await flush();
    expect(h.id()).toBe('B');
    expect(h.rowIds()).toEqual(['B']);
    expect(h.component.isLoading()).toBe(false);
    expect(h.host.focus).not.toHaveBeenCalled();
    expect(h.host.blur).not.toHaveBeenCalled();
  });

  it('ignores A arriving after B has loaded', async () => {
    const h = harness(surface);
    h.navigate('B');
    h.requests[1].resolve(library()); await flush();
    h.requests[0].resolve(library()); await flush();
    expect(h.id()).toBe('B');
    expect(h.rowIds()).toEqual(['B']);
  });

  it('keeps B loading when an old A request rejects', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = harness(surface);
    h.navigate('B');
    h.requests[0].reject(new Error('old A')); await flush();
    expect(h.component.isLoading()).toBe(true);
    expect(log).not.toHaveBeenCalled();
    h.requests[1].resolve(library()); await flush();
    expect(h.id()).toBe('B');
    expect(h.component.isLoading()).toBe(false);
  });

  it('rejects the first A in an A to B to A race', async () => {
    const h = harness(surface);
    h.navigate('B'); h.navigate('A');
    const latest = library();
    latest.tracks = [{ ...tracks[0], title: 'latest A' }, tracks[1]];
    h.requests[2].resolve(latest); await flush();
    h.requests[0].resolve(library()); h.requests[1].resolve(library()); await flush();
    expect(h.id()).toBe('A');
    const rows = h.component[surface.rows]();
    expect((rows[0].track ?? rows[0]).title).toBe('latest A');
  });

  it('keeps selection, active row, scroll and modal on same-ID events', async () => {
    const h = harness(surface);
    h.navigate('B'); h.requests[1].resolve(library()); await flush();
    const active = surface.name === 'playlist' ? 'entry-B' : 'B';
    h.component.activeId.set(active); h.component.selection.selected.set(tracks[1]);
    h.viewport.scrollTop = 250; h.viewport.scrollLeft = 12;
    if (surface.modal) h.component[surface.modal].set(true);
    const assertPreserved = () => {
      expect(h.id()).toBe('B'); expect(h.rowIds()).toEqual(['B']);
      expect(h.component.activeId()).toBe(active);
      expect(h.component.selection.selected()).toBe(tracks[1]);
      expect(h.viewport).toEqual({ scrollTop: 250, scrollLeft: 12 });
      expect(h.component.isLoading()).toBe(false);
      if (surface.modal) expect(h.component[surface.modal]()).toBe(true);
    };
    h.navigate('B');
    expect(h.requests).toHaveLength(2); assertPreserved();
    h.changed.next(); assertPreserved();
    h.requests[2].resolve(library()); await flush(); assertPreserved();
    h.scan.next({ isScanning: true }); h.scan.next({ isScanning: false }); assertPreserved();
    h.requests[3].resolve(library()); await flush(); assertPreserved();
    h.requests[0].resolve(library()); await flush(); assertPreserved();
  });

  it('clears missing IDs and rejects pending loads after destruction', async () => {
    const h = harness(surface);
    h.navigate(); h.requests[0].resolve(library()); await flush();
    expect(h.id()).toBeUndefined(); expect(h.rowIds()).toEqual([]);
    expect(h.component.isLoading()).toBe(false);
    h.navigate('B'); h.destroy();
    h.requests[1].resolve(library()); await flush();
    expect(h.id()).toBeUndefined();
    h.navigate('A'); h.changed.next(); h.scan.next({ isScanning: true }); h.scan.next({ isScanning: false });
    expect(h.requests).toHaveLength(2);
  });

  it('handles a missing entity and a current load failure', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = harness(surface);
    h.navigate('missing'); h.requests[1].resolve(library()); await flush();
    expect(h.id()).toBeUndefined(); expect(h.rowIds()).toEqual([]);
    expect(h.component.isLoading()).toBe(false);
    h.navigate('B'); h.requests[2].reject(new Error('current failure')); await flush();
    expect(h.component.isLoading()).toBe(false);
    expect(log).toHaveBeenCalledOnce();
  });
});

describe('late detail callbacks', () => {
  it('does not apply playlist missing-track lookups after navigating away', async () => {
    const h = harness(surfaces[2]);
    const lookup = deferred<Track | null>();
    h.libraryGateway.getTrackById.mockImplementation(() => lookup.promise);
    h.requests[0].resolve({ ...library(), tracks: [tracks[1]] }); await flush();
    expect(h.libraryGateway.getTrackById).toHaveBeenCalledWith('A');
    h.navigate('B'); h.requests[1].resolve(library()); await flush();
    lookup.resolve(tracks[0]); await flush();
    expect(h.id()).toBe('B'); expect(h.rowIds()).toEqual(['B']);
  });

  it('does not apply playlist edits after A to B to A', async () => {
    const h = harness(surfaces[2]);
    h.requests[0].resolve(library()); await flush();
    const edit = deferred<Playlist>();
    h.playlistGateway.removeEntry.mockReturnValue(edit.promise);
    const pending = h.component.onRemoveEntry('entry-A');
    h.navigate('B'); h.navigate('A'); h.requests[2].resolve(library()); await flush();
    edit.resolve({ ...playlists[0], name: 'stale edit', entries: [] }); await pending;
    expect(h.component.playlist().name).toBe('A');
    expect(h.rowIds()).toEqual(['A']);
  });

  it('filters artist updates using the current route ID', async () => {
    const h = harness(surfaces[1]);
    h.navigate('B'); h.requests[1].resolve(library()); await flush();
    h.updates.next({ artistId: 'A', metadata: null, status: 'error', error: 'old error' });
    expect(h.component.metadataError()).toBeNull();
    h.updates.next({ artistId: 'B', metadata: null, status: 'not-found' });
    expect(h.component.metadataStatus()).toBe('not-found');
  });

  it('ignores an old artist metadata failure and a late retry response', async () => {
    const h = harness(surfaces[1]);
    const ensure = deferred<void>(), retry = deferred<any>();
    h.artistMetadata.ensureArtist.mockReturnValueOnce(ensure.promise);
    h.requests[0].resolve(library()); await flush();
    h.artistMetadata.refreshArtist.mockReturnValue(retry.promise);
    const pending = h.component.retryMetadata();
    h.navigate('B'); h.requests[1].resolve(library()); await flush();
    const status = h.component.metadataStatus();
    ensure.reject(new Error('old ensure')); retry.resolve({ biography: 'A biography' });
    await pending; await flush();
    expect(h.id()).toBe('B');
    expect(h.component.artist().onlineMetadata).toBeNull();
    expect(h.component.metadataStatus()).toBe(status);
    expect(h.component.metadataError()).toBeNull();
  });
});
describe('pending actions during same-ID library refresh', () => {
  it('keeps artist candidate search valid and clears its loading state', async () => {
    const h = harness(surfaces[1]);
    h.requests[0].resolve(library()); await flush();
    const search = deferred<any[]>();
    h.artistMetadata.searchCandidates.mockReturnValue(search.promise);
    h.component.candidateQuery.set('A'); h.component.showMetadataEditor.set(true);
    const pending = h.component.searchMetadataCandidates();
    h.changed.next(); h.requests[1].resolve(library()); await flush();
    expect(h.component.editorLoading()).toBe(true);
    search.resolve([{ musicBrainzId: 'candidate-A' }]); await pending;
    expect(h.component.candidates()).toEqual([{ musicBrainzId: 'candidate-A' }]);
    expect(h.component.showMetadataEditor()).toBe(true);
    expect(h.component.editorLoading()).toBe(false);
  });

  it('applies same-ID playlist edits even if a scan refresh completes first', async () => {
    const h = harness(surfaces[2]);
    h.requests[0].resolve(library()); await flush();
    const edit = deferred<Playlist>();
    h.playlistGateway.removeEntry.mockReturnValue(edit.promise);
    const pending = h.component.onRemoveEntry('entry-A');
    h.changed.next(); h.requests[1].resolve(library()); await flush();
    edit.resolve({ ...playlists[0], entries: [] }); await pending;
    expect(h.rowIds()).toEqual([]);
  });

  it('does not publish old candidate search results or loading state after A to B to A', async () => {
    const h = harness(surfaces[1]);
    h.requests[0].resolve(library()); await flush();
    const search = deferred<any[]>();
    h.artistMetadata.searchCandidates.mockReturnValue(search.promise);
    h.component.candidateQuery.set('A');
    const pending = h.component.searchMetadataCandidates();
    h.navigate('B'); h.navigate('A'); h.requests[2].resolve(library()); await flush();
    h.component.editorLoading.set(true);
    search.resolve([{ musicBrainzId: 'stale' }]); await pending;
    expect(h.component.candidates()).toEqual([]);
    expect(h.component.editorLoading()).toBe(true);
  });
});
