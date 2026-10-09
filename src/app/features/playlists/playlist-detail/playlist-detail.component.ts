import { selectPlaylistArtwork } from '../../../shared/utils/list-media';
import { linkedSignal, WritableSignal, Component, DestroyRef, OnInit, afterNextRender, computed, effect, ElementRef, Injector, inject, signal, untracked, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterModule } from '@angular/router';
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
import { TrackActionsMenuComponent } from '../../../shared/components/track-actions-menu/track-actions-menu.component';
import { AddTracksPanelComponent, isTrackDrag, readTrackDrag } from '../add-tracks-panel/add-tracks-panel.component';

/** Entry order after `addTracks` appended new entries: moves them next to `targetId` (null keeps them at the end). */
export function insertOrder(before: readonly string[], after: readonly string[], targetId: string | null, placement: 'before' | 'after'): string[] {
  const existing = new Set(before);
  const added = after.filter((id) => !existing.has(id));
  const kept = after.filter((id) => existing.has(id));
  const index = targetId === null ? -1 : kept.indexOf(targetId);
  if (index < 0) return [...kept, ...added];
  kept.splice(index + (placement === 'after' ? 1 : 0), 0, ...added);
  return kept;
}

interface PlaylistTrackRow {
  entry: PlaylistEntry;
  track: Track;
}

@Component({
  selector: 'app-playlist-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, DurationPipe, IconComponent, TrackSelectionBarComponent, TrackActionsMenuComponent, AddTracksPanelComponent],
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
  readonly draggingEntryId = signal<string | null>(null);
  readonly dropTarget = signal<{ entryId: string; placement: 'before' | 'after' } | null>(null);
  readonly reorderAnnouncement = signal('');
  private readonly queueActions = inject(QueueActionsService);

  readonly playlist = signal<Playlist | null>(null);
  readonly allLibraryTracks = signal<Track[]>([]);
  readonly entryTracks = signal<ReadonlyMap<string, Track>>(new Map());
  readonly isLoading = signal<boolean>(true);
  readonly showAddTracksModal = signal<boolean>(false);
  private addTracksOpener: HTMLElement | null = null;

  openAddTracks(event: Event): void {
    this.addTracksOpener = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    this.showAddTracksModal.set(true);
  }

  closeAddTracks(): void {
    this.showAddTracksModal.set(false);
    if (this.addTracksOpener?.isConnected) this.addTracksOpener.focus();
    this.addTracksOpener = null;
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

  onDragStart(event: DragEvent, entryId: string): void {
    event.stopPropagation();
    if (!event.dataTransfer) return;
    this.draggingEntryId.set(entryId);
    this.dropTarget.set(null);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', entryId);
  }

  onDragOver(event: DragEvent, entryId: string): void {
    const sourceId = this.draggingEntryId();
    if (!sourceId && isTrackDrag(event)) {
      event.preventDefault();
      event.dataTransfer!.dropEffect = 'copy';
      const placement = this.dropPlacement(event);
      const current = this.dropTarget();
      if (current?.entryId !== entryId || current.placement !== placement) this.dropTarget.set({ entryId, placement });
      return;
    }
    if (!sourceId || sourceId === entryId) {
      this.dropTarget.set(null);
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const placement = this.dropPlacement(event);
    if (!this.reorderedEntries(sourceId, entryId, placement)) {
      this.dropTarget.set(null);
      return;
    }
    const current = this.dropTarget();
    if (current?.entryId !== entryId || current.placement !== placement) this.dropTarget.set({ entryId, placement });
  }

  onDragLeave(event: DragEvent, entryId: string): void {
    const row = event.currentTarget as HTMLElement;
    if (event.relatedTarget instanceof Node && row.contains(event.relatedTarget)) return;
    if (this.dropTarget()?.entryId === entryId) this.dropTarget.set(null);
  }

  onDrop(event: DragEvent, entryId: string): void {
    const sourceId = this.draggingEntryId();
    if (!sourceId) {
      const trackIds = readTrackDrag(event);
      if (!trackIds) return;
      event.preventDefault();
      event.stopPropagation();
      const placement = this.dropPlacement(event);
      this.dropTarget.set(null);
      void this.insertTracks(trackIds, entryId, placement);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const placement = this.dropPlacement(event);
    this.onDragEnd();
    if (sourceId !== entryId) void this.moveEntry(sourceId, entryId, placement);
  }

  /** Panel tracks dropped outside any row (header, empty state, below the last row) go to the end. */
  onCardDragOver(event: DragEvent): void {
    if (this.draggingEntryId() || !isTrackDrag(event)) return;
    event.preventDefault();
    event.dataTransfer!.dropEffect = 'copy';
    if (!(event.target instanceof Element && event.target.closest('.entry-row'))) this.dropTarget.set(null);
  }

  onCardDrop(event: DragEvent): void {
    if (this.draggingEntryId()) return;
    const trackIds = readTrackDrag(event);
    if (!trackIds) return;
    event.preventDefault();
    this.dropTarget.set(null);
    void this.insertTracks(trackIds, null, 'after');
  }

  onDragEnd(): void {
    this.draggingEntryId.set(null);
    this.dropTarget.set(null);
  }

  onHandleKeydown(event: KeyboardEvent, entryId: string): void {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    event.stopPropagation();
    const entries = this.playlist()?.entries ?? [];
    const direction = event.key === 'ArrowUp' ? -1 : 1;
    const target = entries[entries.findIndex((entry) => entry.id === entryId) + direction];
    if (target) void this.moveEntry(entryId, target.id, direction < 0 ? 'before' : 'after', event.currentTarget);
  }

  private dropPlacement(event: DragEvent): 'before' | 'after' {
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after';
  }

  /** The entries with `sourceId` moved next to `targetId`, or null when nothing would change. */
  private reorderedEntries(sourceId: string, targetId: string, placement: 'before' | 'after'): PlaylistEntry[] | null {
    const current = this.playlist()?.entries ?? [];
    const source = current.find((entry) => entry.id === sourceId);
    const entries = current.filter((entry) => entry.id !== sourceId);
    const targetIndex = entries.findIndex((entry) => entry.id === targetId);
    if (!source || targetIndex < 0) return null;
    entries.splice(targetIndex + (placement === 'after' ? 1 : 0), 0, source);
    return entries.some((entry, index) => entry !== current[index]) ? entries : null;
  }

  private async moveEntry(sourceId: string, targetId: string, placement: 'before' | 'after', button?: EventTarget | null): Promise<void> {
    const pl = this.playlist();
    const row = this.trackRows().find((item) => item.entry.id === sourceId);
    const entries = this.reorderedEntries(sourceId, targetId, placement);
    if (!pl || !row || !entries || this.movePending) return;

    const routeVersion = this.routeVersion;
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
      const updated = await this.playlistGateway.reorderEntries(pl.id, entries.map((entry) => entry.id));
      if (routeVersion !== this.routeVersion || this.destroyRef.destroyed) { cleanup(); unregisterDestroy(); return; }
      this.playlist.set(updated);
      const position = this.trackRows().findIndex((item) => item.entry.id === sourceId);
      this.reorderAnnouncement.set(`Moved to position ${position + 1} of ${this.trackRows().length}.`);
      if (restoreFocus) {
        afterNextRender(() => {
          cleanup();
          unregisterDestroy();
          if (routeVersion !== this.routeVersion || this.destroyRef.destroyed || focusMoved || !this.trackRows().some((item) => item.entry.id === row.entry.id)) return;
          this.activeId.set(row.entry.id);
          focusListItem(this.rowsContainer()?.nativeElement, 'data-entry-id', row.entry.id, '.drag-handle');
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

  private async insertTracks(trackIds: string[], targetId: string | null, placement: 'before' | 'after'): Promise<void> {
    const pl = this.playlist();
    if (!pl || this.movePending) return;
    const routeVersion = this.routeVersion;
    const before = pl.entries.map((entry) => entry.id);
    this.movePending = true;
    try {
      // ponytail: add then reorder is two writes, not atomic; give addTracks an insert index if a failed reorder ever matters.
      let updated = await this.playlistGateway.addTracks(pl.id, trackIds);
      if (routeVersion !== this.routeVersion || this.destroyRef.destroyed) return;
      this.playlist.set(updated);
      const after = updated.entries.map((entry) => entry.id);
      const order = insertOrder(before, after, targetId, placement);
      if (order.some((id, index) => id !== after[index])) {
        updated = await this.playlistGateway.reorderEntries(pl.id, order);
        if (routeVersion !== this.routeVersion || this.destroyRef.destroyed) return;
        this.playlist.set(updated);
      }
      const added = order.filter((id) => !before.includes(id));
      this.reorderAnnouncement.set(`Added ${added.length} ${added.length === 1 ? 'track' : 'tracks'} at position ${order.indexOf(added[0]) + 1}.`);
    } finally {
      this.movePending = false;
    }
  }

  /** A row menu may add tracks back into this same playlist. */
  onPlaylistUpdated(updated: Playlist): void {
    if (updated.id === this.playlist()?.id) this.playlist.set(updated);
  }

  onActivateRow(row: PlaylistTrackRow, moveFocus = false): void {
    this.activeId.set(row.entry.id);
    this.selection.selected.set(row.track);
    if (moveFocus) focusListItem(this.rowsContainer()?.nativeElement, 'data-entry-id', row.entry.id);
  }

  onRowsKeyDown(event: KeyboardEvent): void {
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

}
