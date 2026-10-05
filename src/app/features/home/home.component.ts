import { Component, DestroyRef, OnInit, computed, effect, ElementRef, inject, signal, untracked, viewChild, viewChildren, afterRenderEffect } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterModule } from '@angular/router';
import { LIBRARY_GATEWAY, PLAYLIST_GATEWAY } from '../../core/contracts';
import { Album, orderAlbumTracks, Playlist, Track, ScanProgress } from '../../core/models';
import { PlayerService } from '../../core/player/player.service';
import { QueueActionsService } from '../../core/player/queue-actions.service';
import { focusListItem, nextRowIndex } from '../../shared/utils/row-navigation';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { AlbumCardComponent } from '../../shared/components/album-card/album-card.component';
import { albumFormatMap, formatCount, formatTrackFormat as trackFormatLabel, summarizeQuality, formatQualityLine } from './library-quality';
import { RecentPlaysService, findRecentPlayableTrack, recentlyPlayedAlbums, recentTrackCollection } from '../../core/layout/recent-plays.service';
import { LayoutPreferenceService } from '../../core/layout/layout-preference.service';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [DecimalPipe, RouterModule, IconComponent, AlbumCardComponent],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss'
})
export class HomeComponent implements OnInit {
  private readonly libraryGateway = inject(LIBRARY_GATEWAY);
  private readonly destroyRef = inject(DestroyRef);
  private readonly playlistGateway = inject(PLAYLIST_GATEWAY);
  readonly player = inject(PlayerService);
  private readonly recentPlays = inject(RecentPlaysService);
  private readonly albumGrids = viewChildren<ElementRef<HTMLElement>>('albumGrid');
  private readonly visibleCardCount = signal(1);
  private readonly rowsContainer = viewChild<ElementRef<HTMLElement>>('rowsContainer');
  readonly activeId = signal<string | null>(null);
  private readonly queueActions = inject(QueueActionsService);
  readonly errorMessage = signal<string | null>(null);
  readonly addingFolder = signal(false);
  readonly isLoading = signal(true);
  private isFirstLoad = true;
  readonly libraryLoadError = signal<string | null>(null);

  readonly scanProgress = signal<ScanProgress>({ isScanning: false, scannedFiles: 0, audioFiles: 0, currentPath: null });
  readonly scanFinishedMessage = signal<string | null>(null);
  private scanToastTimer: ReturnType<typeof setTimeout> | undefined;

  readonly tracksCount = signal<number>(0);
  readonly foldersCount = signal<number>(0);
  readonly allAlbums = signal<Album[]>([]);
  readonly playlists = signal<Playlist[]>([]);
  readonly allTracksSignal = signal<Track[]>([]);
  readonly trackMapSignal = computed(() => new Map(this.allTracksSignal().map((t) => [t.id, t] as const)));

  readonly recentlyAddedAlbums = computed(() => {
    const trackMap = this.trackMapSignal();
    return this.allAlbums()
      .map((album) => ({
        album,
        maxTime: Math.max(0, ...album.trackIds.map((id) => trackMap.get(id)?.lastModified ?? 0)),
      }))
      .sort((a, b) => b.maxTime - a.maxTime)
      .slice(0, 8)
      .map((item) => item.album);
  });

  readonly layout = inject(LayoutPreferenceService).mode;
  readonly formatLabel = trackFormatLabel;
  readonly recentTracks = computed(() => [...this.allTracksSignal()]
    .sort((a, b) => (b.lastModified ?? 0) - (a.lastModified ?? 0))
    .slice(0, 24));
  readonly playableRecentTracks = computed(() => this.recentTracks().filter((track) => track.isAvailable));
  readonly albumFormats = computed(() => albumFormatMap(this.allAlbums(), this.allTracksSignal()));
  readonly qualityStats = computed(() => summarizeQuality(this.allTracksSignal()));
  readonly qualityLine = computed(() => formatQualityLine(this.qualityStats()));
  readonly limitedPlaylists = computed(() => this.playlists().slice(0, 6));

  readonly hero = computed(() => {
    const current = this.player.currentTrack();
    const recent = current ? null : findRecentPlayableTrack(this.recentPlays.entries(), this.trackMapSignal());
    const track = current ?? recent;
    const album = track
      ? this.allAlbums().find((item) => item.trackIds.includes(track.id)) ?? null
      : this.recentlyAddedAlbums()[0] ?? null;
    if (!track && !album) return null;
    const kind = current ? 'current' : recent ? 'recent' : 'album';
    const active = kind === 'current' && this.player.isPlaybackActive();
    return {
      kind, track, album,
      title: track?.title ?? album!.title,
      artist: track?.artist || album?.artist || 'Unknown Artist',
      albumTitle: track ? track.album || album?.title || 'Unknown Album' : null,
      artwork: track?.artwork || album?.artwork || null,
      format: track ? trackFormatLabel(track) : this.albumFormats().get(album!.id) ?? null,
      status: kind === 'current' ? active ? 'Now Playing' : 'Paused' : kind === 'recent' ? 'Continue listening' : 'Recently modified',
      playLabel: kind === 'album' ? 'Play album' : active ? 'Pause' : 'Play',
      playable: kind === 'current' || !!track?.isAvailable || !!album?.trackIds.some((id) => this.trackMapSignal().get(id)?.isAvailable),
    };
  });
  readonly recentlyPlayed = computed(() => recentlyPlayedAlbums(this.recentPlays.entries(), this.allAlbums(), this.hero()?.album?.id ?? null));
  readonly visibleRecentlyPlayed = computed(() => this.recentlyPlayed().slice(0, this.visibleCardCount()));
  readonly visibleRecentlyModified = computed(() => this.recentlyAddedAlbums().slice(0, this.visibleCardCount()));
  readonly visiblePlaylists = computed(() => this.layout() === 'classic'
    ? this.limitedPlaylists() : this.limitedPlaylists().slice(0, this.visibleCardCount()));

  onPlayHero(): void {
    const hero = this.hero();
    if (!hero?.playable) return;
    if (hero.kind === 'current') {
      void this.player.togglePlayPause();
    } else if (hero.track) {
      const collection = recentTrackCollection(hero.track, hero.album, this.trackMapSignal());
      if (collection.tracks.length) void this.player.playCollection(collection.tracks, collection.startIndex);
    } else if (hero.album) {
      this.onPlayAlbum(hero.album);
    }
  }

  constructor() {
    effect(() => {
      const tracks = this.playableRecentTracks();
      untracked(() => {
        if (!tracks.some((track) => track.id === this.activeId())) {
          this.activeId.set(tracks[0]?.id ?? null);
        }
      });
    });
    afterRenderEffect((onCleanup) => {
      if (this.layout() === 'classic') return;
      const grids = this.albumGrids().map((grid) => grid.nativeElement);
      if (!grids.length) return;
      const measure = () => {
        // auto-fill exposes the real column count, including unused columns.
        // Keeping only that many cards also removes overflow cards from Tab order.
        const columns = getComputedStyle(grids[0]).gridTemplateColumns;
        this.visibleCardCount.set(columns === 'none' ? 1 : Math.max(1, columns.trim().split(/\s+/).length));
      };
      const observer = new ResizeObserver(measure);
      grids.forEach((grid) => observer.observe(grid));
      measure();
      onCleanup(() => observer.disconnect());
    });
    this.destroyRef.onDestroy(() => clearTimeout(this.scanToastTimer));
  }

  async ngOnInit(): Promise<void> {
    let wasScanning = false;
    this.libraryGateway.scanProgress$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((progress) => {
      this.scanProgress.set(progress);
      const justFinished = wasScanning && !progress.isScanning;
      wasScanning = progress.isScanning;
      if (justFinished) {
        void this.loadHome().then(() => {
          if (this.tracksCount() === 0) return;
          this.scanFinishedMessage.set(`Found ${formatCount.format(this.tracksCount())} tracks · ${this.qualityLine()}`);
          clearTimeout(this.scanToastTimer);
          this.scanToastTimer = setTimeout(() => this.scanFinishedMessage.set(null), 5000);
        });
      }
    });
    this.libraryGateway.libraryChanged$?.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => void this.loadHome());
    await this.loadHome();
  }

  async onAddFolder(): Promise<void> {
    if (this.addingFolder()) return;
    this.addingFolder.set(true);
    this.errorMessage.set(null);
    try {
      const added = await this.libraryGateway.selectAndAddMusicFolders();
      if (added.length) await this.loadHome();
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : 'Failed to add music folder');
    } finally {
      this.addingFolder.set(false);
    }
  }

  onRescanAll(): void {
    void this.libraryGateway.requestScan();
  }

  shuffleAll(): void {
    const tracks = this.allTracksSignal().filter((t) => t.isAvailable);
    if (tracks.length === 0) return;
    const shuffled = [...tracks];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    void this.player.playCollection(shuffled, 0);
  }

  async loadHome(): Promise<void> {
    if (this.isFirstLoad) this.isLoading.set(true);
    this.libraryLoadError.set(null);
    try {
      const [lib, pls] = await Promise.all([
        this.libraryGateway.getLibrary(),
        this.playlistGateway.getPlaylists(),
      ]);
      this.allTracksSignal.set(lib.tracks);
      this.tracksCount.set(lib.tracks.length);
      this.foldersCount.set(lib.folders.length);
      this.allAlbums.set(lib.albums);
      this.playlists.set(pls);
    } catch (error) {
      this.libraryLoadError.set(error instanceof Error ? error.message : 'Failed to load music library');
    } finally {
      this.isLoading.set(false);
      this.isFirstLoad = false;
    }
  }

  onRecentKeyDown(event: KeyboardEvent): void {
    if (this.layout() !== 'classic' || event.defaultPrevented || event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest<HTMLButtonElement>('button.console-play');
    const row = button?.closest<HTMLElement>('tr[data-track-id]');
    if (!button || button.disabled || !row || row.parentElement !== event.currentTarget) return;
    const rows = this.playableRecentTracks();
    const current = rows.findIndex((track) => track.id === row.dataset['trackId']);
    if (current < 0) return;
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
    this.activeId.set(rows[next].id);
    focusListItem(this.rowsContainer()?.nativeElement, 'data-track-id', rows[next].id, '.console-play');
  }

  playRecent(track: Track): void {
    const playable = this.recentTracks().filter((item) => item.isAvailable);
    void this.player.playCollection(playable, Math.max(0, playable.indexOf(track)));
  }

  onPlayAlbum(album: Album): void {
    const tracks = this.tracksForIds(album.trackIds);
    if (tracks.length > 0) void this.player.playCollection(orderAlbumTracks(tracks), 0);
  }

  onAddAlbumToQueue(album: Album): void {
    this.queueActions.add(orderAlbumTracks(this.tracksForIds(album.trackIds)));
  }

  onPlayPlaylist(playlist: Playlist): void {
    const tracks = this.tracksForIds(playlist.entries.map((entry) => entry.trackId));
    if (tracks.length > 0) void this.player.playCollection(tracks, 0);
  }

  onAddPlaylistToQueue(playlist: Playlist): void {
    this.queueActions.add(this.tracksForIds(playlist.entries.map((entry) => entry.trackId)));
  }

  private tracksForIds(ids: string[]): Track[] {
    const trackMap = this.trackMapSignal();
    return ids.map((id) => trackMap.get(id)).filter((t): t is Track => t?.isAvailable === true);
  }
}
