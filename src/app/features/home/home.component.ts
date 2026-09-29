import { AfterViewInit, Component, DestroyRef, ElementRef, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterModule } from '@angular/router';
import { LIBRARY_GATEWAY, PLAYLIST_GATEWAY } from '../../core/contracts';
import { Album, Playlist, Track } from '../../core/models';
import { PlayerService } from '../../core/player/player.service';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { compareAlbumsByTitle } from '../library-browse';
import { getDesktopApi } from '../../core/desktop/desktop-api';

export function featuredAlbumColumns(width: number, minCardWidth = 160, gap = 16): number {
  return Math.max(1, Math.floor((width + gap) / (minCardWidth + gap)));
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterModule, IconComponent],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss'
})
export class HomeComponent implements OnInit, AfterViewInit {
  private readonly libraryGateway = inject(LIBRARY_GATEWAY);
  private readonly destroyRef = inject(DestroyRef);
  private readonly playlistGateway = inject(PLAYLIST_GATEWAY);
  readonly player = inject(PlayerService);
  readonly isDesktop = Boolean(getDesktopApi());
  readonly errorMessage = signal<string | null>(null);

  readonly tracksCount = signal<number>(0);
  readonly albumsCount = signal<number>(0);
  readonly artistsCount = signal<number>(0);
  readonly foldersCount = signal<number>(0);
  readonly allAlbums = signal<Album[]>([]);
  readonly featuredColumnCount = signal(1);
  readonly featuredAlbums = computed(() => [...this.allAlbums()].sort(compareAlbumsByTitle).slice(0, this.featuredColumnCount()));
  readonly playlists = signal<Playlist[]>([]);
  private allTracks: Track[] = [];
  @ViewChild('albumsGrid', { static: true }) private albumsGrid!: ElementRef<HTMLElement>;

  ngAfterViewInit(): void {
    const grid = this.albumsGrid.nativeElement;
    const updateColumns = () => {
      const style = getComputedStyle(grid);
      const minWidth = Number.parseFloat(style.getPropertyValue('--featured-album-min-width')) || 160;
      const gap = Number.parseFloat(style.columnGap) || 0;
      this.featuredColumnCount.set(featuredAlbumColumns(grid.clientWidth, minWidth, gap));
    };
    updateColumns();
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(updateColumns);
      observer.observe(grid);
      this.destroyRef.onDestroy(() => observer.disconnect());
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
    this.errorMessage.set(null);
    try {
      await this.libraryGateway.selectAndAddMusicFolders();
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : 'Failed to add music folder');
    }
  }

  private async loadHome(): Promise<void> {
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
  }

  onPlayAlbum(event: MouseEvent, album: Album): void {
    event.stopPropagation();
    const trackMap = new Map<string, Track>();
    this.allTracks.forEach((t) => trackMap.set(t.id, t));

    const tracks: Track[] = [];
    album.trackIds.forEach((id) => {
      const t = trackMap.get(id);
      if (t) tracks.push(t);
    });

    if (tracks.length > 0) {
      this.player.playCollection(tracks, 0);
    }
  }
}
