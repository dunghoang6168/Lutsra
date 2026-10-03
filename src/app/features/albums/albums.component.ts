import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { LIBRARY_GATEWAY } from '../../core/contracts';
import { Album, orderAlbumTracks, Track } from '../../core/models';
import { PlayerService } from '../../core/player/player.service';
import { QueueActionsService } from '../../core/player/queue-actions.service';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { compareAlbumsByTitle, compareNames } from '../library-browse';
import { BrowseFilterPopoverComponent } from '../../shared/components/browse-filter-popover/browse-filter-popover.component';
import { SearchableFilterSelectComponent } from '../../shared/components/searchable-filter-select/searchable-filter-select.component';

type AlbumSort = 'title' | 'artist' | 'year' | 'tracks';
type SortDirection = 'asc' | 'desc';
const UNKNOWN_ARTIST = '__unknown_artist__';
const UNKNOWN_YEAR = 'unknown';

@Component({
  selector: 'app-albums',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, IconComponent, BrowseFilterPopoverComponent, SearchableFilterSelectComponent],
  templateUrl: './albums.component.html',
  styleUrl: './albums.component.scss'
})
export class AlbumsComponent implements OnInit {
  readonly sortOptions = [
    { value: 'title', label: 'Title' },
    { value: 'artist', label: 'Artist' },
    { value: 'year', label: 'Year' },
    { value: 'tracks', label: 'Track count' },
  ] as const;
  readonly sortDirectionOptions = [{ value: 'asc', label: 'Ascending' }, { value: 'desc', label: 'Descending' }] as const;

  private readonly libraryGateway = inject(LIBRARY_GATEWAY);
  private readonly destroyRef = inject(DestroyRef);
  private readonly player = inject(PlayerService);
  private readonly queueActions = inject(QueueActionsService);

  readonly albums = signal<Album[]>([]);
  readonly allTracks = signal<Track[]>([]);
  readonly isLoading = signal<boolean>(true);
  readonly errorMessage = signal<string | null>(null);
  readonly searchQuery = signal<string>('');
  readonly sortBy = signal<AlbumSort>('title');
  readonly sortDirection = signal<SortDirection>('asc');
  readonly artistFilter = signal<string>('');
  readonly yearFilter = signal<string>('');
  readonly artistOptions = computed(() => {
    const selected = this.artistFilter();
    return [...new Set([
      ...this.albums().map((a) => a.artist).filter((name): name is string => Boolean(name)),
      ...(selected && selected !== UNKNOWN_ARTIST ? [selected] : []),
    ])].sort(compareNames);
  });
  readonly yearOptions = computed(() => {
    const selected = this.yearFilter();
    return [...new Set([
      ...this.albums().map((a) => a.year).filter((year): year is number => year !== null),
      ...(selected && selected !== UNKNOWN_YEAR ? [Number(selected)] : []),
    ])].sort((a, b) => b - a);
  });
  readonly hasUnknownArtist = computed(() => this.artistFilter() === UNKNOWN_ARTIST || this.albums().some((a) => !a.artist));
  readonly hasUnknownYear = computed(() => this.yearFilter() === UNKNOWN_YEAR || this.albums().some((a) => a.year === null));
  readonly hasFilters = computed(() => Boolean(this.searchQuery().trim() || this.artistFilter() || this.yearFilter()));
  readonly activeFilterCount = computed(() => Number(Boolean(this.artistFilter())) + Number(Boolean(this.yearFilter())));

  readonly filteredAlbums = computed<Album[]>(() => {
    const list = this.albums();
    const query = this.searchQuery().trim().toLowerCase();
    const artist = this.artistFilter();
    const year = this.yearFilter();
    const direction = this.sortDirection() === 'asc' ? 1 : -1;
    const sortBy = this.sortBy();

    return list.filter((a) =>
      (!query || a.title.toLowerCase().includes(query) || (a.artist || '').toLowerCase().includes(query)) &&
      (!artist || (artist === UNKNOWN_ARTIST ? !a.artist : a.artist === artist)) &&
      (!year || (year === UNKNOWN_YEAR ? a.year === null : a.year === Number(year)))
    ).sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'title') comparison = compareNames(a.title, b.title);
      if (sortBy === 'artist') comparison = compareNames(a.artist || '', b.artist || '');
      if (sortBy === 'tracks') comparison = a.trackIds.length - b.trackIds.length;
      if (sortBy === 'year') {
        if (a.year === null) return b.year === null ? this.compareAlbumFallback(a, b) : 1;
        if (b.year === null) return -1;
        comparison = a.year - b.year;
      }
      return comparison * direction || this.compareAlbumFallback(a, b);
    });
  });

  private compareAlbumFallback(a: Album, b: Album): number {
    return compareAlbumsByTitle(a, b);
  }

  clearFilters(): void {
    this.artistFilter.set('');
    this.yearFilter.set('');
  }

  async ngOnInit(): Promise<void> {
    let wasScanning = false;
    this.libraryGateway.scanProgress$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((progress) => {
      const justFinished = wasScanning && !progress.isScanning;
      wasScanning = progress.isScanning;
      if (justFinished) void this.loadAlbums();
    });
    this.libraryGateway.libraryChanged$?.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => void this.loadAlbums());
    await this.loadAlbums();
  }

  async loadAlbums(): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set(null);
    try {
      const lib = await this.libraryGateway.getLibrary();
      this.albums.set(lib.albums);
      this.allTracks.set(lib.tracks);
    } catch (err: any) {
      this.errorMessage.set(err?.message || 'Failed to load albums');
    } finally {
      this.isLoading.set(false);
    }
  }

  onPlayAlbum(event: MouseEvent, album: Album): void {
    event.stopPropagation();
    const albumTracks = this.tracksForAlbum(album);
    if (albumTracks.length > 0) {
      this.player.setShuffle(false);
      this.player.playCollection(albumTracks, 0);
    }
  }

  onAddAlbumToQueue(event: MouseEvent, album: Album): void {
    event.stopPropagation();
    this.queueActions.add(this.tracksForAlbum(album));
  }

  private tracksForAlbum(album: Album): Track[] {
    const trackMap = new Map<string, Track>();
    this.allTracks().forEach((t) => trackMap.set(t.id, t));

    const albumTracks: Track[] = [];
    album.trackIds.forEach((id) => {
      const t = trackMap.get(id);
      if (t) albumTracks.push(t);
    });

    return orderAlbumTracks(albumTracks);
  }
}
