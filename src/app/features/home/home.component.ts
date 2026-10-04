import { Component, DestroyRef, ElementRef, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterModule } from '@angular/router';
import { LIBRARY_GATEWAY, PLAYLIST_GATEWAY } from '../../core/contracts';
import { Album, orderAlbumTracks, Playlist, Track } from '../../core/models';
import { PlayerService } from '../../core/player/player.service';
import { QueueActionsService } from '../../core/player/queue-actions.service';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { compareAlbumsByTitle } from '../library-browse';

export function albumColumns(width: number, minCardWidth = 160, gap = 16): number {
  return Math.max(1, Math.floor((width + gap) / (minCardWidth + gap)));
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterModule, IconComponent],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss'
})
export class HomeComponent implements OnInit {
  private readonly libraryGateway = inject(LIBRARY_GATEWAY);
  private readonly destroyRef = inject(DestroyRef);
  private readonly playlistGateway = inject(PLAYLIST_GATEWAY);
  readonly player = inject(PlayerService);
  private readonly queueActions = inject(QueueActionsService);
  readonly errorMessage = signal<string | null>(null);
  readonly addingFolder = signal(false);
  readonly isLoading = signal(true);
  readonly libraryLoadError = signal<string | null>(null);

  readonly tracksCount = signal<number>(0);
  readonly albumsCount = signal<number>(0);
  readonly artistsCount = signal<number>(0);
  readonly foldersCount = signal<number>(0);
  readonly allAlbums = signal<Album[]>([]);
  readonly albumColumnCount = signal(1);
  readonly albumsAZ = computed(() => [...this.allAlbums()].sort(compareAlbumsByTitle).slice(0, this.albumColumnCount()));
  readonly playlists = signal<Playlist[]>([]);
  private allTracks: Track[] = [];
  private albumsGridElement: HTMLElement | null = null;
  private albumsObserver: ResizeObserver | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => this.albumsObserver?.disconnect());
  }

  @ViewChild('albumsGrid') private set albumsGrid(element: ElementRef<HTMLElement> | undefined) {
    this.albumsObserver?.disconnect();
    this.albumsObserver = null;
    this.albumsGridElement = element?.nativeElement ?? null;
    const grid = this.albumsGridElement;
    if (!grid) return;
    const updateColumns = () => {
      if (this.albumsGridElement !== grid) return;
      const style = getComputedStyle(grid);
      const minWidth = Number.parseFloat(style.getPropertyValue('--album-min-width')) || 160;
      const gap = Number.parseFloat(style.columnGap) || 0;
      this.albumColumnCount.set(albumColumns(grid.clientWidth, minWidth, gap));
    };
    queueMicrotask(updateColumns);
    if (typeof ResizeObserver === 'function') {
      this.albumsObserver = new ResizeObserver(updateColumns);
      this.albumsObserver.observe(grid);
    }
  }

  async ngOnInit(): Promise<void> {
    let wasScanning = false;
    this.libraryGateway.scanProgress$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((progress) => {
      const justFinished = wasScanning && !progress.isScanning;
      wasScanning = progress.isScanning;
      if (justFinished) void this.loadHome();
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

  async loadHome(): Promise<void> {
    this.isLoading.set(true);
    this.libraryLoadError.set(null);
    try {
      const [lib, pls] = await Promise.all([
        this.libraryGateway.getLibrary(),
        this.playlistGateway.getPlaylists(),
      ]);

      this.allTracks = lib.tracks;
      this.tracksCount.set(lib.tracks.length);
      this.albumsCount.set(lib.albums.length);
      this.artistsCount.set(lib.artists.length);
      this.foldersCount.set(lib.folders.length);
      this.allAlbums.set(lib.albums);
      this.playlists.set(pls);
    } catch (error) {
      this.libraryLoadError.set(error instanceof Error ? error.message : 'Failed to load music library');
    } finally {
      this.isLoading.set(false);
    }
  }

  onPlayAlbum(event: MouseEvent, album: Album): void {
    event.stopPropagation();
    const tracks = this.tracksForAlbum(album);
    if (tracks.length > 0) {
      this.player.playCollection(tracks, 0);
    }
  }

  onAddAlbumToQueue(event: MouseEvent, album: Album): void {
    event.stopPropagation();
    this.queueActions.add(this.tracksForAlbum(album));
  }

  private tracksForAlbum(album: Album): Track[] {
    const trackMap = new Map<string, Track>();
    this.allTracks.forEach((t) => trackMap.set(t.id, t));

    const tracks: Track[] = [];
    album.trackIds.forEach((id) => {
      const t = trackMap.get(id);
      if (t) tracks.push(t);
    });

    return orderAlbumTracks(tracks);
  }
}
