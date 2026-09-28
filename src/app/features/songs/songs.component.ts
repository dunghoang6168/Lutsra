import { Component, DestroyRef, OnInit, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { LIBRARY_GATEWAY, LYRICS_GATEWAY } from '../../core/contracts';
import { compareAlbumTracks, SongColumn, Track } from '../../core/models';
import { PlayerService } from '../../core/player/player.service';
import { SongColumnPreferencesService } from '../../core/settings/song-column-preferences.service';
import { DurationPipe } from '../../shared/pipes/duration.pipe';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { BrowseFilterPopoverComponent } from '../../shared/components/browse-filter-popover/browse-filter-popover.component';
import { SearchableFilterSelectComponent } from '../../shared/components/searchable-filter-select/searchable-filter-select.component';
import { compareNames } from '../library-browse';

type SortColumn = 'title' | 'artist' | 'album' | 'duration' | 'codec' | 'sampleRate';
type SortDirection = 'asc' | 'desc';
const UNKNOWN_ARTIST = '__unknown_artist__';
const UNKNOWN_ALBUM = '__unknown_album__';
const UNKNOWN_YEAR = 'unknown';

@Component({
  selector: 'app-songs',
  standalone: true,
  imports: [CommonModule, FormsModule, DurationPipe, IconComponent, BrowseFilterPopoverComponent, SearchableFilterSelectComponent],
  templateUrl: './songs.component.html',
  styleUrl: './songs.component.scss'
})
export class SongsComponent implements OnInit {
  private readonly libraryGateway = inject(LIBRARY_GATEWAY);
  private readonly lyricsGateway = inject(LYRICS_GATEWAY);
  readonly songColumns = inject(SongColumnPreferencesService);
  private readonly destroyRef = inject(DestroyRef);
  private lyricsRequestVersion = 0;
  readonly player = inject(PlayerService);

  readonly tracks = signal<Track[]>([]);
  readonly lyricTrackIds = signal<ReadonlySet<string>>(new Set());
  readonly isLoading = signal<boolean>(true);
  readonly searchQuery = signal<string>('');
  readonly sortColumn = signal<SortColumn>('title');
  readonly sortDirection = signal<SortDirection>('asc');
  readonly artistFilter = signal('');
  readonly albumFilter = signal('');
  readonly yearFilter = signal('');
  readonly artistOptions = computed(() => this.textOptions(this.tracks().map((track) => track.artist), this.artistFilter(), UNKNOWN_ARTIST));
  readonly albumOptions = computed(() => this.textOptions(this.tracks().map((track) => track.album), this.albumFilter(), UNKNOWN_ALBUM));
  readonly yearOptions = computed(() => {
    const selected = this.yearFilter();
    return [...new Set([
      ...this.tracks().map((track) => track.year).filter((year): year is number => year !== null),
      ...(selected && selected !== UNKNOWN_YEAR ? [Number(selected)] : []),
    ])].sort((a, b) => b - a);
  });
  readonly hasUnknownArtist = computed(() => this.artistFilter() === UNKNOWN_ARTIST || this.tracks().some((track) => !track.artist));
  readonly hasUnknownAlbum = computed(() => this.albumFilter() === UNKNOWN_ALBUM || this.tracks().some((track) => !track.album));
  readonly hasUnknownYear = computed(() => this.yearFilter() === UNKNOWN_YEAR || this.tracks().some((track) => track.year === null));
  readonly activeFilterCount = computed(() => Number(Boolean(this.artistFilter())) + Number(Boolean(this.albumFilter())) + Number(Boolean(this.yearFilter())));
  readonly hasFilters = computed(() => Boolean(this.searchQuery().trim() || this.activeFilterCount()));
  readonly selectedTrackId = signal<string | null>(null);
  readonly noticeMessage = signal<string | null>(null);

  constructor() {
    effect(() => {
      const tracks = this.tracks();
      const hidden = this.songColumns.isHidden('lyrics');
      const loadingPreferences = this.songColumns.isLoading();
      const version = ++this.lyricsRequestVersion;
      this.lyricTrackIds.set(new Set());
      if (hidden || loadingPreferences || !tracks.length) return;
      void this.loadLyricsAvailability(tracks.map((track) => track.id), version);
    });
    this.destroyRef.onDestroy(() => { ++this.lyricsRequestVersion; });
  }

  private async loadLyricsAvailability(trackIds: string[], version: number): Promise<void> {
    try {
      const found = new Set<string>();
      for (let offset = 0; offset < trackIds.length; offset += 500) {
        const batch = await this.lyricsGateway.findTracksWithLyrics(trackIds.slice(offset, offset + 500));
        if (version !== this.lyricsRequestVersion) return;
        batch.forEach((id) => found.add(id));
        this.lyricTrackIds.set(new Set(found));
      }
    } catch {
      if (version === this.lyricsRequestVersion) this.lyricTrackIds.set(new Set());
    }
  }

  readonly filteredTracks = computed<Track[]>(() => {
    const list = this.tracks();
    const query = this.searchQuery().trim().toLowerCase();

    const artist = this.artistFilter();
    const album = this.albumFilter();
    const year = this.yearFilter();
    const col = this.sortColumn();
    const dir = this.sortDirection() === 'asc' ? 1 : -1;

    return list.filter((track) =>
      (!query || track.title.toLowerCase().includes(query) || (track.artist || '').toLowerCase().includes(query) || (track.album || '').toLowerCase().includes(query)) &&
      (!artist || (artist === UNKNOWN_ARTIST ? !track.artist : track.artist === artist)) &&
      (!album || (album === UNKNOWN_ALBUM ? !track.album : track.album === album)) &&
      (!year || (year === UNKNOWN_YEAR ? track.year === null : track.year === Number(year)))
    ).sort((a, b) => {
      let comparison = 0;
      if (col === 'title') comparison = compareNames(a.title, b.title);
      if (col === 'artist' || col === 'album') {
        const groupA = col === 'artist' ? a.artist : a.album;
        const groupB = col === 'artist' ? b.artist : b.album;
        const groupOrder = this.compareGroupNames(groupA, groupB, dir);
        if (groupOrder !== 0) return groupOrder;

        if (col === 'artist') {
          const albumOrder = this.compareGroupNames(a.album, b.album, 1);
          if (albumOrder !== 0) return albumOrder;
        }
        const albumArtistOrder = this.compareGroupNames(a.albumArtist || a.artist, b.albumArtist || b.artist, 1);
        return albumArtistOrder || compareAlbumTracks(a, b);
      }
      if (col === 'codec') {
        if (!a.codec) return b.codec ? 1 : this.compareTrackFallback(a, b);
        if (!b.codec) return -1;
        comparison = compareNames(a.codec, b.codec);
      }
      if (col === 'duration') comparison = a.duration - b.duration;
      if (col === 'sampleRate') {
        if (a.sampleRate === null) return b.sampleRate === null ? this.compareTrackFallback(a, b) : 1;
        if (b.sampleRate === null) return -1;
        comparison = a.sampleRate - b.sampleRate;
      }
      return comparison * dir || this.compareTrackFallback(a, b);
    });
  });

  private textOptions(values: (string | null)[], selected: string, unknown: string): string[] {
    return [...new Set([
      ...values.filter((value): value is string => Boolean(value)),
      ...(selected && selected !== unknown ? [selected] : []),
    ])].sort(compareNames);
  }

  private compareGroupNames(a: string | null, b: string | null, direction: number): number {
    if (!a) return b ? 1 : 0;
    if (!b) return -1;
    return compareNames(a, b) * direction;
  }
  private compareTrackFallback(a: Track, b: Track): number {
    return compareNames(a.title, b.title) || compareNames(a.id, b.id);
  }

  clearFilters(): void {
    this.artistFilter.set('');
    this.albumFilter.set('');
    this.yearFilter.set('');
  }

  readonly errorMessage = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    let wasScanning = false;
    this.libraryGateway.scanProgress$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((progress) => {
      const justFinished = wasScanning && !progress.isScanning;
      wasScanning = progress.isScanning;
      if (justFinished) void this.loadSongs();
    });
    await Promise.all([this.loadSongs(), this.songColumns.load()]);
  }

  isSongColumnHidden(column: SongColumn): boolean {
    return this.songColumns.isHidden(column);
  }

  async loadSongs(): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set(null);
    try {
      const lib = await this.libraryGateway.getLibrary();
      this.tracks.set(lib.tracks);
    } catch (err: any) {
      this.errorMessage.set(err?.message || 'Failed to load songs from library');
    } finally {
      this.isLoading.set(false);
    }
  }

  onSelectTrack(track: Track): void {
    this.selectedTrackId.set(track.id);
  }

  onPlayTrack(track: Track, indexInFiltered: number): void {
    if (!track.isAvailable) {
      this.noticeMessage.set(`Track "${track.title}" is unavailable or missing from disk.`);
      return;
    }
    this.noticeMessage.set(null);
    this.selectedTrackId.set(track.id);
    this.player.playCollection(this.filteredTracks(), indexInFiltered);
  }

  onPlayAll(): void {
    const list = this.filteredTracks();
    if (list.length > 0) {
      this.player.playCollection(list, 0);
    }
  }

  onShuffleAll(): void {
    const list = this.filteredTracks();
    if (list.length > 0) {
      if (!this.player.isShuffle()) {
        this.player.toggleShuffle();
      }
      this.player.playCollection(list, 0);
    }
  }

  onPlayNext(track: Track): void {
    this.player.playNext([track]);
  }

  onAddToQueue(track: Track): void {
    this.player.addToQueue([track]);
  }

  toggleSort(col: SortColumn): void {
    if (this.sortColumn() === col) {
      this.sortDirection.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortColumn.set(col);
      this.sortDirection.set('asc');
    }
  }

  getAriaSort(col: SortColumn): 'ascending' | 'descending' | 'none' {
    if (this.sortColumn() !== col) return 'none';
    return this.sortDirection() === 'asc' ? 'ascending' : 'descending';
  }

  isHiRes(track: Track): boolean {
    return (track.sampleRate !== null && track.sampleRate > 48000) ||
           (track.bitDepth !== null && track.bitDepth > 16);
  }

  formatSampleRate(sr: number | null): string {
    if (!sr) return '—';
    const khz = sr / 1000;
    return Number.isInteger(khz) ? `${khz} kHz` : `${khz.toFixed(1)} kHz`;
  }
}
