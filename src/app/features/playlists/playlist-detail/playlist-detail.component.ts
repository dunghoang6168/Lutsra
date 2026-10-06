import { selectPlaylistArtwork } from '../../../shared/utils/list-media';
import { Component, DestroyRef, OnInit, afterNextRender, computed, effect, ElementRef, Injector, inject, signal, untracked, viewChild } from '@angular/core';
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
import { DurationPipe } from '../../../shared/pipes/duration.pipe';
import { IconComponent } from '../../../shared/components/icon/icon.component';

interface PlaylistTrackRow {
  entry: PlaylistEntry;
  track: Track;
}

@Component({
  selector: 'app-playlist-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, DurationPipe, IconComponent],
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

  constructor() {
    effect(() => {
      const rows = this.trackRows();
      untracked(() => {
        if (!rows.some((row) => row.entry.id === this.activeId())) {
          this.activeId.set(rows[0] ? rows[0].entry.id : null);
        }
      });
    });
  }

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id = params.get('id');
      if (id === this.currentId) return;
      this.currentId = id;
      ++this.routeVersion;
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
    if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.closest(
      'button, input, textarea, select, a, [contenteditable], [role="button"], [role="textbox"], [role="combobox"]',
    )) return;
    const row = target.closest<HTMLElement>('.entry-row[data-entry-id]');
    if (!row || row.parentElement !== event.currentTarget) return;
    const rows = this.trackRows();
    const current = rows.findIndex((item) => item.entry.id === row.dataset['entryId']);
    if (current < 0) return;
    if (event.key === 'Enter') {
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
