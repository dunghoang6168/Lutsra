import { SearchableFilterSelectComponent } from '../../shared/components/searchable-filter-select/searchable-filter-select.component';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ARTIST_METADATA_GATEWAY, LIBRARY_GATEWAY } from '../../core/contracts';
import { Artist, Track } from '../../core/models';
import { PlayerService } from '../../core/player/player.service';
import { QueueActionsService } from '../../core/player/queue-actions.service';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Album } from '../../core/models';
import { artistAvatarCandidates } from './artist-avatar';
import { artistInitial, compareNames } from '../library-browse';
import { BrowseFilterPopoverComponent } from '../../shared/components/browse-filter-popover/browse-filter-popover.component';
import { orderArtistTracks } from './artist-play-order';
import { AlbumCardComponent } from '../../shared/components/album-card/album-card.component';

type ArtistSort = 'name' | 'albums' | 'tracks';
type SortDirection = 'asc' | 'desc';

@Component({
  selector: 'app-artists',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, IconComponent, BrowseFilterPopoverComponent, SearchableFilterSelectComponent, AlbumCardComponent],
  templateUrl: './artists.component.html',
  styleUrl: './artists.component.scss'
})
export class ArtistsComponent implements OnInit {
  readonly sortOptions = [
    { value: 'name', label: 'Name' },
    { value: 'albums', label: 'Album count' },
    { value: 'tracks', label: 'Track count' },
  ] as const;
  readonly sortDirectionOptions = [{ value: 'asc', label: 'Ascending' }, { value: 'desc', label: 'Descending' }] as const;

  private readonly libraryGateway = inject(LIBRARY_GATEWAY);
  private readonly player = inject(PlayerService);
  private readonly queueActions = inject(QueueActionsService);
  private readonly artistMetadata = inject(ARTIST_METADATA_GATEWAY);
  private readonly destroyRef = inject(DestroyRef);

  readonly artists = signal<Artist[]>([]);
  readonly allTracks = signal<Track[]>([]);
  readonly allAlbums = signal<Album[]>([]);
  readonly isLoading = signal<boolean>(true);
  readonly errorMessage = signal<string | null>(null);
  readonly addingFolder = signal(false);
  readonly addFolderError = signal<string | null>(null);
  readonly searchQuery = signal<string>('');
  readonly sortBy = signal<ArtistSort>('name');
  readonly sortDirection = signal<SortDirection>('asc');
  readonly initialFilter = signal<string>('');
  readonly initialOptions = computed(() => [...new Set([
    ...this.artists().map((artist) => artistInitial(artist.name)),
    ...(this.initialFilter() ? [this.initialFilter()] : []),
  ])].sort((a, b) => a === '#' ? 1 : b === '#' ? -1 : compareNames(a, b)));
  readonly hasFilters = computed(() => Boolean(this.searchQuery().trim() || this.initialFilter()));
  readonly activeFilterCount = computed(() => Number(Boolean(this.initialFilter())));
  readonly failedAvatars = signal<Set<string>>(new Set());
  readonly refreshRunning = signal(false);
  readonly refreshError = signal<string | null>(null);

  readonly filteredArtists = computed<Artist[]>(() => {
    const list = this.artists();
    const query = this.searchQuery().trim().toLowerCase();
    const initial = this.initialFilter();
    const direction = this.sortDirection() === 'asc' ? 1 : -1;
    const sortBy = this.sortBy();
    return list.filter((a) =>
      (!query || a.name.toLowerCase().includes(query)) &&
      (!initial || artistInitial(a.name) === initial)
    ).sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'name') comparison = compareNames(a.name, b.name);
      if (sortBy === 'albums') comparison = a.albumIds.length - b.albumIds.length;
      if (sortBy === 'tracks') comparison = a.trackIds.length - b.trackIds.length;
      return comparison * direction || compareNames(a.name, b.name) || compareNames(a.id, b.id);
    });
  });

  clearFilters(): void {
    this.initialFilter.set('');
  }

  async ngOnInit(): Promise<void> {
    let wasScanning = false;
    this.libraryGateway.scanProgress$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((progress) => {
      const justFinished = wasScanning && !progress.isScanning;
      wasScanning = progress.isScanning;
      if (justFinished) void this.loadArtists();
    });
    this.libraryGateway.libraryChanged$?.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => void this.loadArtists());
    this.artistMetadata.updates$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((update) => {
      this.artists.update((artists) => artists.map((artist) => artist.id === update.artistId ? { ...artist, onlineMetadata: update.metadata, customAvatar: update.customAvatar === undefined ? artist.customAvatar : update.customAvatar } : artist));
    });
    await this.loadArtists();
    void this.artistMetadata.refreshMissing();
  }

  avatarFor(artist: Artist): string | null {
    return artistAvatarCandidates(artist, this.allAlbums()).find((url) => !this.failedAvatars().has(`${artist.id}:${url}`)) ?? null;
  }

  onAvatarError(artist: Artist): void {
    const url = this.avatarFor(artist);
    if (url) this.failedAvatars.update((current) => new Set(current).add(`${artist.id}:${url}`));
  }

  async refreshMissingInfo(): Promise<void> {
    this.refreshRunning.set(true);
    this.refreshError.set(null);
    try { await this.artistMetadata.refreshMissing(true); }
    catch (error) { this.refreshError.set(error instanceof Error ? error.message : String(error)); }
    finally { this.refreshRunning.set(false); }
  }

  async onAddFolder(): Promise<void> {
    if (this.addingFolder()) return;
    this.addingFolder.set(true);
    this.addFolderError.set(null);
    try {
      const added = await this.libraryGateway.selectAndAddMusicFolders();
      if (added.length) await this.loadArtists();
    } catch (error) {
      this.addFolderError.set(error instanceof Error ? error.message : 'Failed to add music folder');
    } finally {
      this.addingFolder.set(false);
    }
  }

  async loadArtists(): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set(null);
    try {
      const lib = await this.libraryGateway.getLibrary();
      this.artists.set(lib.artists);
      this.allTracks.set(lib.tracks);
      this.allAlbums.set(lib.albums);
    } catch (err: any) {
      this.errorMessage.set(err?.message || 'Failed to load artists');
    } finally {
      this.isLoading.set(false);
    }
  }

  onPlayArtist(artist: Artist): void {
    const tracks = this.tracksForArtist(artist);
    if (tracks.length > 0) {
      this.player.setShuffle(false);
      this.player.playCollection(tracks, 0);
    }
  }

  onAddArtistToQueue(artist: Artist): void {
    this.queueActions.add(this.tracksForArtist(artist));
  }

  private tracksForArtist(artist: Artist): Track[] {
    return orderArtistTracks(artist, this.allAlbums(), this.allTracks());
  }
}
