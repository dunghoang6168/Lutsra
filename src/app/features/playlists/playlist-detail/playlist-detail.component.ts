import { selectPlaylistArtwork } from '../../../shared/utils/list-media';
import { linkedSignal, WritableSignal, Component, DestroyRef, OnInit, afterNextRender, computed, effect, ElementRef, Injector, inject, signal, untracked, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { LIBRARY_GATEWAY, PLAYLIST_GATEWAY } from '../../../core/contracts';
import { Playlist, PlaylistEntry, Track } from '../../../core/models';
import { PlayerService } from '../../../core/player/player.service';
import { QueueActionsService } from '../../../core/player/queue-actions.service';
import { TrackSelectionService } from '../../../core/layout/track-selection.service';
import { focusListItem, nextRowIndex } from '../../../shared/utils/row-navigation';
import { RowSelection, RowSelectionAction, selectRows, visibleRowSelection } from '../../../shared/utils/row-selection';
import { TrackSelectionBarComponent } from '../../../shared/components/track-selection-bar/track-selection-bar.component';
import { DurationPipe } from '../../../shared/pipes/duration.pipe';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { BrowseFilterPopoverComponent } from '../../../shared/components/browse-filter-popover/browse-filter-popover.component';
import { SearchableFilterSelectComponent } from '../../../shared/components/searchable-filter-select/searchable-filter-select.component';
import { compareNames } from '../../library-browse';
import { matchesQualityFilter } from '../../home/library-quality';

const UNKNOWN_ARTIST = '__unknown_artist__';
const UNKNOWN_ALBUM = '__unknown_album__';
const UNKNOWN_YEAR = 'unknown';

interface PlaylistTrackRow {
  entry: PlaylistEntry;
  track: Track;
}

@Component({
  selector: 'app-playlist-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, DurationPipe, IconComponent, TrackSelectionBarComponent, BrowseFilterPopoverComponent, SearchableFilterSelectComponent],
  templateUrl: './playlist-detail.component.html',
  styleUrl: './playlist-detail.component.scss'
})
export class PlaylistDetailComponent implements OnInit {
  readonly playlistArtwork = selectPlaylistArtwork;
  private readonly route = inject(ActivatedRoute);
  private readonly playlistGateway = inject(PLAYLIST_GATEWAY);
  private readonly libraryGateway = inject(LIBRARY_GATEWAY);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private currentId: string | null | undefined;
  private loadToken = 0;
  private routeVersion = 0;
  readonly player = inject(PlayerService);
  private readonly injector = inject(Injector);
  private movePending = false;
  private readonly selection = inject(TrackSelectionService);
  private readonly rowsContainer = viewChild<ElementRef<HTMLElement>>('rowsContainer');
  readonly activeId = signal<string | null>(null);
  private readonly queueActions = inject(QueueActionsService);

  readonly playlist = signal<Playlist | null>(null);
  readonly allLibraryTracks = signal<Track[]>([]);
  readonly entryTracks = signal<ReadonlyMap<string, Track>>(new Map());
  readonly isLoading = signal<boolean>(true);
  readonly showAddTracksModal = signal<boolean>(false);
  readonly pickerQuery = signal('');
  readonly pickerHideAdded = signal(false);
  readonly pickerArtist = signal('');
  readonly pickerAlbum = signal('');
  readonly pickerYear = signal('');
  readonly pickerQuality = signal('');
  readonly qualityOptions = [
    { value: 'lossless', label: 'Lossless (incl. Hi-Res)' },
    { value: 'hires', label: 'Hi-Res only' },
    { value: 'lossy', label: 'Lossy' },
  ];
  readonly pickerArtistOptions = computed(() => [...new Set(this.allLibraryTracks().map((t) => t.artist).filter((v): v is string => Boolean(v)))].sort(compareNames));
  readonly pickerAlbumOptions = computed(() => [...new Set(this.allLibraryTracks().map((t) => t.album).filter((v): v is string => Boolean(v)))].sort(compareNames));
  readonly pickerYearOptions = computed(() => [...new Set(this.allLibraryTracks().map((t) => t.year).filter((v): v is number => v !== null))].sort((a, b) => b - a));
  readonly pickerHasUnknownArtist = computed(() => this.allLibraryTracks().some((t) => !t.artist));
  readonly pickerHasUnknownAlbum = computed(() => this.allLibraryTracks().some((t) => !t.album));
  readonly pickerHasUnknownYear = computed(() => this.allLibraryTracks().some((t) => t.year === null));
  readonly pickerFilterCount = computed(() => [this.pickerArtist(), this.pickerAlbum(), this.pickerYear(), this.pickerQuality()].filter(Boolean).length);
  readonly pickerTracks = computed<Track[]>(() => {
    const query = this.pickerQuery().trim().toLowerCase();
    const added = this.pickerHideAdded() ? new Set(this.playlist()?.entries.map((entry) => entry.trackId)) : null;
    const artist = this.pickerArtist();
    const album = this.pickerAlbum();
    const year = this.pickerYear();
    const quality = this.pickerQuality();
    return this.allLibraryTracks().filter((track) =>
      (!added || !added.has(track.id)) &&
      (!query || track.title.toLowerCase().includes(query) || (track.artist || '').toLowerCase().includes(query) || (track.album || '').toLowerCase().includes(query)) &&
      (!artist || (artist === UNKNOWN_ARTIST ? !track.artist : track.artist === artist)) &&
      (!album || (album === UNKNOWN_ALBUM ? !track.album : track.album === album)) &&
      (!year || (year === UNKNOWN_YEAR ? track.year === null : track.year === Number(year))) &&
      (!quality || matchesQualityFilter(track, quality)));
  });

  // Native modal dialog renders in the top layer, above the app header in every layout.
  private readonly addTracksDialog = viewChild<ElementRef<HTMLDialogElement>>('addTracksDialog');
  private readonly openAddTracksDialog = effect(() => {
    const dialog = this.addTracksDialog()?.nativeElement;
    if (dialog && !dialog.open) dialog.showModal();
  });

  onAddTracksDialogClick(event: MouseEvent): void {
    const dialog = event.currentTarget as HTMLDialogElement;
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) this.showAddTracksModal.set(false);
  }

  clearPickerFilters(): void {
    this.pickerArtist.set('');
    this.pickerAlbum.set('');
    this.pickerYear.set('');
    this.pickerQuality.set('');
  }

  readonly trackRows = computed<PlaylistTrackRow[]>(() => {
    const pl = this.playlist();
    if (!pl) return [];

    const trackMap = this.entryTracks();

    const rows: PlaylistTrackRow[] = [];
    pl.entries.forEach((entry) => {
      const track = trackMap.get(entry.trackId);
      if (track) {
        rows.push({ entry, track });
      }
    });

    return rows;
  });

  readonly totalDuration = computed<string>(() => {
    const totalSecs = this.trackRows().reduce((acc, r) => acc + r.track.duration, 0);
    const mins = Math.floor(totalSecs / 60);
    return `${mins} min`;
  });

  // Drops ids that leave the view; selectedRows adds the focused-row fallback.
  // Created on first use because detail-route-reuse tests build the component from its prototype, without field initialisers.
  private selectionState?: WritableSignal<RowSelection>;
  private get rowSelection(): WritableSignal<RowSelection> {
    return this.selectionState ??= linkedSignal<readonly string[], RowSelection>({
      source: () => this.visibleRowIds?.() ?? [],
      computation: (ids, previous) => visibleRowSelection(previous?.value ?? { ids: new Set(), anchor: null }, ids, this.activeId()),
    });
  }
  readonly visibleRowIds = computed(() => this.trackRows().map((row) => row.entry.id));
  readonly selectedRows = computed(() => visibleRowSelection(this.rowSelection(), this.visibleRowIds(), this.activeId()));
  readonly selectedTracks = computed(() => this.trackRows().filter((row) => this.selectedRows().ids.has(row.entry.id)).map((row) => row.track));

  private updateRowSelection(action: RowSelectionAction): void {
    this.rowSelection.set(selectRows(this.selectedRows(), this.visibleRowIds(), action));
  }

  onRowMouseDown(event: MouseEvent): void {
    if (event.shiftKey) event.preventDefault();
  }

  onRowClick(row: PlaylistTrackRow, event: MouseEvent): void {
    this.updateRowSelection({ type: event.shiftKey ? 'range' : event.ctrlKey ? 'toggle' : 'replace', id: row.entry.id });
    this.onActivateRow(row, true);
  }

  collapseSelection(): void {
    const rows = this.trackRows();
    const active = rows.find((row) => row.entry.id === this.activeId()) ?? rows[0];
    if (!active) return;
    this.updateRowSelection({ type: 'collapse', id: active.entry.id });
    this.onActivateRow(active, true);
  }

  constructor() {
    effect(() => {
      const rows = this.trackRows();
      untracked(() => {
        if (!rows.some((row) => row.entry.id === this.activeId())) {
          this.activeId.set(rows[0] ? rows[0].entry.id : null);
        }
        const active = rows.find((row) => row.entry.id === this.activeId());
        this.selection.selected.set(active ? active.track : null);
      });
    });
  }

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id = params.get('id');
      if (id === this.currentId) return;
      this.currentId = id;
      ++this.routeVersion;
      this.rowSelection.set(selectRows(this.rowSelection(), [], { type: 'reset' }));
      this.activeId.set(null);
      this.selection.selected.set(null);
      this.playlist.set(null);
      this.allLibraryTracks.set([]);
      this.entryTracks.set(new Map());
      this.showAddTracksModal.set(false);
      this.isLoading.set(Boolean(id));
      const viewport = this.host.nativeElement.closest<HTMLElement>('.main-content');
      if (viewport) { viewport.scrollTop = 0; viewport.scrollLeft = 0; }
      void this.loadPlaylist();
    });
    let wasScanning = false;
    this.libraryGateway.scanProgress$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((progress) => {
      const justFinished = wasScanning && !progress.isScanning;
      wasScanning = progress.isScanning;
      if (justFinished) void this.loadPlaylist();
    });
    this.libraryGateway.libraryChanged$?.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => void this.loadPlaylist());
  }

  async loadPlaylist(): Promise<void> {
    const id = this.currentId;
    const token = ++this.loadToken;
    if (!id) {
      this.isLoading.set(false);
      return;
    }

    try {
      const [playlists, lib] = await Promise.all([
        this.playlistGateway.getPlaylists(),
        this.libraryGateway.getLibrary(),
      ]);
      if (token !== this.loadToken || this.destroyRef.destroyed) return;
      const found = playlists.find((p) => p.id === id) || null;
      const libraryTracks = new Map(lib.tracks.map((track) => [track.id, track]));
      const missingIds = [...new Set(found?.entries.map((entry) => entry.trackId) ?? [])]
        .filter((trackId) => !libraryTracks.has(trackId));
      const missingTracks = await Promise.all(missingIds.map((trackId) => this.libraryGateway.getTrackById(trackId)));
      if (token !== this.loadToken || this.destroyRef.destroyed) return;
      missingTracks.forEach((track) => { if (track) libraryTracks.set(track.id, track); });
      this.rowSelection.set(selectRows(this.rowSelection(), [], { type: 'reset' }));
      this.playlist.set(found);
      this.allLibraryTracks.set(lib.tracks);
      this.entryTracks.set(libraryTracks);
    } catch (error) {
      if (token === this.loadToken && !this.destroyRef.destroyed) console.error('Could not load playlist', error);
    } finally {
      if (token === this.loadToken && !this.destroyRef.destroyed) this.isLoading.set(false);
    }
  }

  onMoveUp(index: number, event?: MouseEvent): Promise<void> {
    return this.moveRow(index, -1, event);
  }

  onMoveDown(index: number, event?: MouseEvent): Promise<void> {
    return this.moveRow(index, 1, event);
  }

  private async moveRow(index: number, direction: -1 | 1, event?: MouseEvent): Promise<void> {
    const pl = this.playlist();
    const row = this.trackRows()[index];
    if (!pl || !row || this.movePending || index + direction < 0 || index + direction >= this.trackRows().length) return;
    const entryIndex = pl.entries.findIndex((entry) => entry.id === row.entry.id);
    if (entryIndex < 0 || !pl.entries[entryIndex + direction]) return;

    const routeVersion = this.routeVersion;
    const button = event?.currentTarget;
    const restoreFocus = button instanceof HTMLElement && document.activeElement === button;
    let focusMoved = false;
    const onFocusChanged = (focusEvent: FocusEvent) => {
      if (focusEvent.target !== button) focusMoved = true;
    };
    if (restoreFocus) document.addEventListener('focusin', onFocusChanged);
    const cleanup = () => document.removeEventListener('focusin', onFocusChanged);
    const unregisterDestroy = this.destroyRef.onDestroy(cleanup);
    this.movePending = true;
    try {
      const entries = [...pl.entries];
      [entries[entryIndex], entries[entryIndex + direction]] = [entries[entryIndex + direction], entries[entryIndex]];
      const updated = await this.playlistGateway.reorderEntries(pl.id, entries.map((entry) => entry.id));
      if (routeVersion !== this.routeVersion || this.destroyRef.destroyed) { cleanup(); unregisterDestroy(); return; }
      this.playlist.set(updated);
      if (restoreFocus) {
        afterNextRender(() => {
          cleanup();
          unregisterDestroy();
          if (routeVersion !== this.routeVersion || this.destroyRef.destroyed || focusMoved || this.showAddTracksModal() || !this.trackRows().some((item) => item.entry.id === row.entry.id)) return;
          this.activeId.set(row.entry.id);
          focusListItem(this.rowsContainer()?.nativeElement, 'data-entry-id', row.entry.id,
            direction < 0 ? '[data-move="up"]' : '[data-move="down"]');
        }, { injector: this.injector });
      }
    } catch (error) {
      cleanup();
      unregisterDestroy();
      if (routeVersion === this.routeVersion && !this.destroyRef.destroyed) throw error;
    } finally {
      this.movePending = false;
      if (!restoreFocus || this.destroyRef.destroyed) {
        cleanup();
        unregisterDestroy();
      }
    }
  }

  async onRemoveEntry(entryId: string): Promise<void> {
    const pl = this.playlist();
    if (!pl) return;
    const routeVersion = this.routeVersion;
    const updated = await this.playlistGateway.removeEntry(pl.id, entryId);
    if (routeVersion !== this.routeVersion || this.destroyRef.destroyed) return;
    this.playlist.set(updated);
  }

  async onAddSingleTrack(trackId: string): Promise<void> {
    const pl = this.playlist();
    if (!pl) return;
    const routeVersion = this.routeVersion;
    const updated = await this.playlistGateway.addTracks(pl.id, [trackId]);
    if (routeVersion !== this.routeVersion || this.destroyRef.destroyed) return;
    this.playlist.set(updated);
  }

  onActivateRow(row: PlaylistTrackRow, moveFocus = false): void {
    this.activeId.set(row.entry.id);
    this.selection.selected.set(row.track);
    if (moveFocus) focusListItem(this.rowsContainer()?.nativeElement, 'data-entry-id', row.entry.id);
  }

  onRowsKeyDown(event: KeyboardEvent): void {
    if (this.showAddTracksModal()) return;
    if (event.defaultPrevented || event.isComposing || event.altKey || event.metaKey) return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.closest('input, textarea, select, [contenteditable], [role="textbox"], [role="combobox"]')) return;
    const row = target.closest<HTMLElement>('.entry-row[data-entry-id]');
    if (!row || row.parentElement !== event.currentTarget) return;
    const rows = this.trackRows();
    const current = rows.findIndex((item) => item.entry.id === row.dataset['entryId']);
    if (current < 0) return;
    if (event.ctrlKey && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      this.updateRowSelection({ type: 'all' });
      return;
    }
    if (event.key === 'Escape' && this.selectedRows().ids.size > 1) {
      event.preventDefault();
      this.collapseSelection();
      return;
    }
    if (target.closest('button, a, [role="button"]')) return;
    if (event.ctrlKey && (event.code === 'Space' || event.key === ' ')) {
      event.preventDefault();
      this.updateRowSelection({ type: 'toggle', id: rows[current].entry.id });
      return;
    }
    if (event.key === 'Enter' && !event.ctrlKey) {
      event.preventDefault();
      this.onPlayRow(current);
      return;
    }
    let next = nextRowIndex(event.key, current, rows.length, 1);
    if (next === null) return;
    event.preventDefault();
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      const viewport = row.closest<HTMLElement>('.main-content');
      const rowHeight = row.getBoundingClientRect().height;
      const clearance = Number.parseFloat(getComputedStyle(row).scrollMarginTop) || 0;
      const pageSize = viewport && rowHeight > 0
        ? Math.max(1, Math.floor((viewport.clientHeight - clearance) / rowHeight))
        : 1;
      next = nextRowIndex(event.key, current, rows.length, pageSize)!;
    }
    if (event.shiftKey) this.updateRowSelection({ type: 'range', id: rows[next].entry.id });
    else if (!event.ctrlKey) this.updateRowSelection({ type: 'replace', id: rows[next].entry.id });
    this.onActivateRow(rows[next], true);
  }

  onPlayAll(): void {
    const tracks = this.trackRows().map((r) => r.track).filter((track) => track.isAvailable);
    if (tracks.length > 0) {
      this.player.playCollection(tracks, 0);
    }
  }

  onShufflePlay(): void {
    const tracks = this.trackRows().map((r) => r.track).filter((track) => track.isAvailable);
    if (tracks.length > 0) {
      if (!this.player.isShuffle()) {
        this.player.toggleShuffle();
      }
      this.player.playCollection(tracks, 0);
    }
  }

  onPlayRow(index: number): void {
    const tracks = this.trackRows().map((r) => r.track);
    if (index >= 0 && index < tracks.length) {
      if (!tracks[index].isAvailable) return;
      this.player.playCollection(tracks, index);
    }
  }

  onAddAllToQueue(): void {
    this.queueActions.add(this.trackRows().map((row) => row.track));
  }

  onAddTrackToQueue(track: Track): void {
    this.queueActions.add([track]);
  }
}
