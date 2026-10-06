import { Component, DestroyRef, OnInit, computed, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { LIBRARY_GATEWAY } from '../../../core/contracts';
import { Album, orderAlbumTracks, Track } from '../../../core/models';
import { formatResolution, trackQuality } from '../../home/library-quality';
import { PlayerService } from '../../../core/player/player.service';
import { QueueActionsService } from '../../../core/player/queue-actions.service';
import { TrackSelectionService } from '../../../core/layout/track-selection.service';
import { focusListItem, nextRowIndex } from '../../../shared/utils/row-navigation';
import { DurationPipe } from '../../../shared/pipes/duration.pipe';
import { IconComponent } from '../../../shared/components/icon/icon.component';

interface DiscGroup {
  discNumber: number;
  tracks: Track[];
}

@Component({
  selector: 'app-album-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, DurationPipe, IconComponent],
  templateUrl: './album-detail.component.html',
  styleUrl: './album-detail.component.scss'
})
export class AlbumDetailComponent implements OnInit {
  readonly formatResolution = formatResolution;
  readonly trackQuality = trackQuality;
  private readonly route = inject(ActivatedRoute);
  private readonly libraryGateway = inject(LIBRARY_GATEWAY);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private currentId: string | null | undefined;
  private loadToken = 0;
  readonly player = inject(PlayerService);
  private readonly selection = inject(TrackSelectionService);
  private readonly rowsContainer = viewChild<ElementRef<HTMLElement>>('rowsContainer');
  readonly activeId = signal<string | null>(null);
  private readonly queueActions = inject(QueueActionsService);

  readonly album = signal<Album | null>(null);
  readonly albumTracks = signal<Track[]>([]);
  readonly isLoading = signal<boolean>(true);
  readonly orderedAlbumTracks = computed<Track[]>(() => orderAlbumTracks(this.albumTracks()));

  readonly discGroups = computed<DiscGroup[]>(() => {
    const tracks = this.orderedAlbumTracks();
    const map = new Map<number, Track[]>();

    tracks.forEach((t) => {
      const disc = t.discNumber ?? 1;
      if (!map.has(disc)) map.set(disc, []);
      map.get(disc)!.push(t);
    });

    const groups: DiscGroup[] = [];
    map.forEach((discTracks, discNumber) => {
      groups.push({ discNumber, tracks: discTracks });
    });

    return groups;
  });

  readonly totalDuration = computed<string>(() => {
    const totalSecs = this.albumTracks().reduce((acc, t) => acc + t.duration, 0);
    const mins = Math.floor(totalSecs / 60);
    return `${mins} min`;
  });

  constructor() {
    effect(() => {
      const rows = this.orderedAlbumTracks();
      untracked(() => {
        if (!rows.some((row) => row.id === this.activeId())) {
          this.activeId.set(rows[0] ? rows[0].id : null);
        }
      });
    });
  }

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id = params.get('id');
      if (id === this.currentId) return;
      this.currentId = id;
      this.activeId.set(null);
      this.selection.selected.set(null);
      this.album.set(null);
      this.albumTracks.set([]);
      this.isLoading.set(Boolean(id));
      const viewport = this.host.nativeElement.closest<HTMLElement>('.main-content');
      if (viewport) { viewport.scrollTop = 0; viewport.scrollLeft = 0; }
      void this.loadAlbum();
    });
    let wasScanning = false;
    this.libraryGateway.scanProgress$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((progress) => {
      const justFinished = wasScanning && !progress.isScanning;
      wasScanning = progress.isScanning;
      if (justFinished) void this.loadAlbum();
    });
    this.libraryGateway.libraryChanged$?.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => void this.loadAlbum());
  }

  private async loadAlbum(): Promise<void> {
    const albumId = this.currentId;
    const token = ++this.loadToken;
    if (!albumId) {
      this.isLoading.set(false);
      return;
    }

    try {
      const lib = await this.libraryGateway.getLibrary();
      if (token !== this.loadToken || this.destroyRef.destroyed) return;
      const foundAlbum = lib.albums.find((a) => a.id === albumId) || null;
      this.album.set(foundAlbum);
      if (!foundAlbum) this.albumTracks.set([]);

      if (foundAlbum) {
        const trackMap = new Map<string, Track>();
        lib.tracks.forEach((t) => trackMap.set(t.id, t));

        const tracks: Track[] = [];
        foundAlbum.trackIds.forEach((id) => {
          const t = trackMap.get(id);
          if (t) tracks.push(t);
        });

        this.albumTracks.set(tracks);
      }
    } catch (error) {
      if (token === this.loadToken && !this.destroyRef.destroyed) console.error('Could not load album', error);
    } finally {
      if (token === this.loadToken && !this.destroyRef.destroyed) this.isLoading.set(false);
    }
  }

  onActivateTrack(track: Track, moveFocus = false): void {
    this.activeId.set(track.id);
    this.selection.selected.set(track);
    if (moveFocus) focusListItem(this.rowsContainer()?.nativeElement, 'data-track-id', track.id);
  }

  onRowsKeyDown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.closest(
      'button, input, textarea, select, a, [contenteditable], [role="button"], [role="textbox"], [role="combobox"]',
    )) return;
    const row = target.closest<HTMLElement>('.track-row[data-track-id]');
    if (!row || row.parentElement !== event.currentTarget) return;
    const rows = this.orderedAlbumTracks();
    const current = rows.findIndex((track) => track.id === row.dataset['trackId']);
    if (current < 0) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      this.onPlayTrack(rows[current]);
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
    this.onActivateTrack(rows[next], true);
  }

  onPlayAll(): void {
    const tracks = this.orderedAlbumTracks();
    if (tracks.length > 0) {
      this.player.setShuffle(false);
      this.player.playCollection(tracks, 0);
    }
  }

  onShufflePlay(): void {
    const tracks = this.orderedAlbumTracks();
    if (tracks.length > 0) {
      this.player.setShuffle(true);
      this.player.playCollection(tracks, 0);
    }
  }

  onPlayTrack(track: Track): void {
    if (!track.isAvailable) return;
    const tracks = this.orderedAlbumTracks();
    const idx = tracks.findIndex((t) => t.id === track.id);
    this.player.setShuffle(false);
    this.player.playCollection(tracks, Math.max(0, idx));
  }

  onAddAllToQueue(): void {
    this.queueActions.add(this.orderedAlbumTracks());
  }

  onAddTrackToQueue(track: Track): void {
    this.queueActions.add([track]);
  }
}
