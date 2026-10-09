import { Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LIBRARY_GATEWAY, PLAYLIST_GATEWAY, SETTINGS_GATEWAY } from '../../../core/contracts';
import { ADD_TRACKS_TABS, AddTracksTab, Album, Artist, FolderNode, isAddTracksTab, MusicFolder, Playlist, Track } from '../../../core/models';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { BrowseFilterPopoverComponent } from '../../../shared/components/browse-filter-popover/browse-filter-popover.component';
import { SearchableFilterSelectComponent } from '../../../shared/components/searchable-filter-select/searchable-filter-select.component';
import { artistInitial, compareAlbumsByTitle, compareNames } from '../../library-browse';
import { matchesQualityFilter } from '../../home/library-quality';

/** Drag payload from this panel: a JSON array of track ids. */
export const TRACK_DRAG_TYPE = 'application/x-lutstra-tracks';

export function isTrackDrag(event: DragEvent): boolean {
  return Boolean(event.dataTransfer?.types.includes(TRACK_DRAG_TYPE));
}

export function readTrackDrag(event: DragEvent): string[] | null {
  try {
    const ids: unknown = JSON.parse(event.dataTransfer?.getData(TRACK_DRAG_TYPE) || 'null');
    return Array.isArray(ids) && ids.length > 0 && ids.every((id) => typeof id === 'string') ? ids : null;
  } catch {
    return null;
  }
}

const UNKNOWN_ARTIST = '__unknown_artist__';
const UNKNOWN_ALBUM = '__unknown_album__';
const UNKNOWN_YEAR = 'unknown';
const TAB_LABELS: Record<AddTracksTab, string> = { songs: 'Songs', albums: 'Albums', artists: 'Artists', folders: 'Folders' };
const folderCollator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

type Drill = { kind: 'album'; item: Album } | { kind: 'artist'; item: Artist };
interface FolderInfo { trackIds: string[]; artwork: string | null }

@Component({
  selector: 'app-add-tracks-panel',
  standalone: true,
  imports: [FormsModule, NgTemplateOutlet, IconComponent, BrowseFilterPopoverComponent, SearchableFilterSelectComponent],
  templateUrl: './add-tracks-panel.component.html',
  styleUrl: './add-tracks-panel.component.scss',
})
export class AddTracksPanelComponent {
  private readonly libraryGateway = inject(LIBRARY_GATEWAY);
  private readonly playlistGateway = inject(PLAYLIST_GATEWAY);
  private readonly settingsGateway = inject(SETTINGS_GATEWAY);
  private readonly destroyRef = inject(DestroyRef);
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');

  readonly playlist = input.required<Playlist>();
  readonly playlistChange = output<Playlist>();
  readonly close = output<void>();

  readonly tabs = ADD_TRACKS_TABS;
  readonly tabLabels = TAB_LABELS;
  readonly initial = artistInitial;
  readonly tab = signal<AddTracksTab>('songs');
  readonly query = signal('');
  readonly drill = signal<Drill | null>(null);
  readonly folderStack = signal<FolderNode[]>([]);
  readonly isLoading = signal(true);

  private readonly tracks = signal<Track[]>([]);
  private readonly albums = signal<Album[]>([]);
  private readonly artists = signal<Artist[]>([]);
  private readonly roots = signal<MusicFolder[]>([]);
  private readonly folderTrees = signal<ReadonlyMap<string, FolderNode>>(new Map());
  private folderTreesRequested = false;

  readonly filterArtist = signal('');
  readonly filterAlbum = signal('');
  readonly filterYear = signal('');
  readonly filterQuality = signal('');
  readonly qualityOptions = [
    { value: 'lossless', label: 'Lossless (incl. Hi-Res)' },
    { value: 'hires', label: 'Hi-Res only' },
    { value: 'lossy', label: 'Lossy' },
  ];
  readonly artistOptions = computed(() => [...new Set(this.tracks().map((t) => t.artist).filter((v): v is string => Boolean(v)))].sort(compareNames));
  readonly albumOptions = computed(() => [...new Set(this.tracks().map((t) => t.album).filter((v): v is string => Boolean(v)))].sort(compareNames));
  readonly yearOptions = computed(() => [...new Set(this.tracks().map((t) => t.year).filter((v): v is number => v !== null))].sort((a, b) => b - a));
  readonly hasUnknownArtist = computed(() => this.tracks().some((t) => !t.artist));
  readonly hasUnknownAlbum = computed(() => this.tracks().some((t) => !t.album));
  readonly hasUnknownYear = computed(() => this.tracks().some((t) => t.year === null));
  readonly filterCount = computed(() => [this.filterArtist(), this.filterAlbum(), this.filterYear(), this.filterQuality()].filter(Boolean).length);

  readonly addedIds = computed(() => new Set(this.playlist().entries.map((entry) => entry.trackId)));
  private readonly trackMap = computed(() => new Map(this.tracks().map((track) => [track.id, track])));
  private readonly needle = computed(() => this.query().trim().toLowerCase());

  readonly songs = computed(() => {
    const query = this.needle();
    const artist = this.filterArtist();
    const album = this.filterAlbum();
    const year = this.filterYear();
    const quality = this.filterQuality();
    return this.tracks().filter((track) =>
      this.matchesTrack(track, query) &&
      (!artist || (artist === UNKNOWN_ARTIST ? !track.artist : track.artist === artist)) &&
      (!album || (album === UNKNOWN_ALBUM ? !track.album : track.album === album)) &&
      (!year || (year === UNKNOWN_YEAR ? track.year === null : track.year === Number(year))) &&
      (!quality || matchesQualityFilter(track, quality)));
  });

  readonly albumList = computed(() => {
    const query = this.needle();
    return this.albums().filter((album) => !query || album.title.toLowerCase().includes(query) || (album.artist || '').toLowerCase().includes(query)).sort(compareAlbumsByTitle);
  });

  readonly artistList = computed(() => {
    const query = this.needle();
    return this.artists().filter((artist) => !query || artist.name.toLowerCase().includes(query)).sort((a, b) => compareNames(a.name, b.name));
  });

  readonly rootList = computed(() => {
    const query = this.needle();
    const trees = this.folderTrees();
    return this.roots()
      .map((root) => ({ root, tree: trees.get(root.id) ?? null }))
      .filter(({ root }) => !query || root.name.toLowerCase().includes(query))
      .sort((a, b) => folderCollator.compare(a.root.name, b.root.name));
  });

  readonly currentFolder = computed(() => this.folderStack().at(-1) ?? null);
  readonly subfolders = computed(() => {
    const query = this.needle();
    return (this.currentFolder()?.children ?? [])
      .filter((child) => child.isFolder && (!query || child.name.toLowerCase().includes(query)))
      .sort((a, b) => folderCollator.compare(a.name, b.name));
  });

  /** Recursive track ids and first artwork for every folder node, for Add all, drag and covers. */
  private readonly folderInfo = computed(() => {
    const info = new Map<string, FolderInfo>();
    const tracks = this.trackMap();
    const walk = (node: FolderNode): FolderInfo => {
      const result: FolderInfo = { trackIds: [], artwork: null };
      for (const child of [...(node.children ?? [])].sort((a, b) => folderCollator.compare(a.name, b.name))) {
        if (child.isFolder) {
          const sub = walk(child);
          result.trackIds.push(...sub.trackIds);
          result.artwork ??= sub.artwork;
        } else if (child.trackId && tracks.has(child.trackId)) {
          result.trackIds.push(child.trackId);
          result.artwork ??= tracks.get(child.trackId)!.artwork;
        }
      }
      info.set(node.id, result);
      return result;
    };
    for (const tree of this.folderTrees().values()) walk(tree);
    return info;
  });

  /** Tracks of the opened album, artist or folder; folders list only their direct tracks. */
  readonly drillTracks = computed<Track[]>(() => {
    const query = this.needle();
    const tracks = this.trackMap();
    const drill = this.drill();
    const folder = this.currentFolder();
    const ids = drill ? drill.item.trackIds
      : folder ? (folder.children ?? []).filter((child) => !child.isFolder).sort((a, b) => folderCollator.compare(a.name, b.name)).map((child) => child.trackId ?? '')
      : [];
    return ids.map((id) => tracks.get(id)).filter((track): track is Track => Boolean(track) && this.matchesTrack(track!, query));
  });

  /** Every track of the opened group, ignoring the search box. */
  readonly groupTrackIds = computed<string[]>(() => {
    const drill = this.drill();
    if (drill) return drill.item.trackIds.filter((id) => this.trackMap().has(id));
    const folder = this.currentFolder();
    return folder ? this.folderTrackIds(folder) : [];
  });
  readonly groupMissingIds = computed(() => this.missing(this.groupTrackIds()));
  readonly groupTitle = computed(() => {
    const drill = this.drill();
    if (drill) return drill.kind === 'album' ? drill.item.title : drill.item.name;
    return this.currentFolder()?.name ?? '';
  });
  readonly isDrilled = computed(() => Boolean(this.drill() || this.currentFolder()));

  constructor() {
    afterNextRender(() => this.searchInput()?.nativeElement.focus());
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const [settings, lib] = await Promise.all([
        this.settingsGateway.getSettings().catch(() => null),
        this.libraryGateway.getLibrary(),
      ]);
      if (this.destroyRef.destroyed) return;
      const savedTab = settings?.addTracksTab;
      if (isAddTracksTab(savedTab)) this.tab.set(savedTab);
      this.tracks.set(lib.tracks);
      this.albums.set(lib.albums);
      this.artists.set(lib.artists);
      this.roots.set(lib.folders);
      if (this.tab() === 'folders') void this.loadFolderTrees();
    } catch (error) {
      console.error('Could not load library for Add tracks', error);
    } finally {
      if (!this.destroyRef.destroyed) this.isLoading.set(false);
    }
  }

  private async loadFolderTrees(): Promise<void> {
    if (this.folderTreesRequested) return;
    this.folderTreesRequested = true;
    const roots = this.roots();
    const results = await Promise.allSettled(roots.map((root) => this.libraryGateway.getFolderTree(root.id)));
    if (this.destroyRef.destroyed) return;
    const trees = new Map<string, FolderNode>();
    results.forEach((result, index) => { if (result.status === 'fulfilled' && result.value) trees.set(roots[index].id, result.value); });
    this.folderTrees.set(trees);
  }

  setTab(tab: AddTracksTab): void {
    if (tab === this.tab()) return;
    this.tab.set(tab);
    this.drill.set(null);
    this.folderStack.set([]);
    if (tab === 'folders') void this.loadFolderTrees();
    this.settingsGateway.saveSettings({ addTracksTab: tab }).catch((error) => console.error('Could not save Add tracks tab', error));
  }

  onTabKeydown(event: KeyboardEvent): void {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = this.tabs[(this.tabs.indexOf(this.tab()) + step + this.tabs.length) % this.tabs.length];
    this.setTab(next);
    (event.currentTarget as HTMLElement).querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus();
  }

  onPanelKeydown(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault();
      if (this.isDrilled()) this.back();
      else this.close.emit();
    }
  }

  openAlbum(item: Album): void { this.drill.set({ kind: 'album', item }); }
  openArtist(item: Artist): void { this.drill.set({ kind: 'artist', item }); }
  openFolder(node: FolderNode | null): void { if (node) this.folderStack.update((stack) => [...stack, node]); }

  back(): void {
    if (this.drill()) this.drill.set(null);
    else this.folderStack.update((stack) => stack.slice(0, -1));
  }

  clearFilters(): void {
    this.filterArtist.set('');
    this.filterAlbum.set('');
    this.filterYear.set('');
    this.filterQuality.set('');
  }

  artistAvatar(artist: Artist): string | null {
    return artist.customAvatar ?? artist.onlineMetadata?.avatar ?? null;
  }

  albumArtwork(album: Album): string | null {
    return album.artwork ?? album.trackIds.map((id) => this.trackMap().get(id)?.artwork).find(Boolean) ?? null;
  }

  folderArtwork(node: FolderNode | null): string | null {
    return node ? this.folderInfo().get(node.id)?.artwork ?? null : null;
  }

  folderTrackIds(node: FolderNode | null): string[] {
    return node ? this.folderInfo().get(node.id)?.trackIds ?? [] : [];
  }

  addTrack(track: Track): void {
    if (!this.addedIds().has(track.id)) void this.add([track.id]);
  }

  addGroup(): void {
    void this.add(this.groupMissingIds());
  }

  onDragStart(event: DragEvent, trackIds: string[]): void {
    if (!event.dataTransfer || trackIds.length === 0) { event.preventDefault(); return; }
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(TRACK_DRAG_TYPE, JSON.stringify(trackIds));
    event.dataTransfer.setData('text/plain', trackIds.map((id) => this.trackMap().get(id)?.title ?? id).join('\n'));
  }

  /** Dragging a group carries only the tracks the playlist does not hold yet. */
  missing(trackIds: string[]): string[] {
    const added = this.addedIds();
    return trackIds.filter((id) => !added.has(id));
  }

  private async add(trackIds: string[]): Promise<void> {
    if (trackIds.length === 0) return;
    const playlistId = this.playlist().id;
    try {
      const updated = await this.playlistGateway.addTracks(playlistId, trackIds);
      if (!this.destroyRef.destroyed) this.playlistChange.emit(updated);
    } catch (error) {
      console.error('Could not add tracks', error);
    }
  }

  private matchesTrack(track: Track, query: string): boolean {
    return !query || track.title.toLowerCase().includes(query) || (track.artist || '').toLowerCase().includes(query) || (track.album || '').toLowerCase().includes(query);
  }
}
