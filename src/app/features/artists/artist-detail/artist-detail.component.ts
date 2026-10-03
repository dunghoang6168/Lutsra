import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { ARTIST_METADATA_GATEWAY, LIBRARY_GATEWAY } from '../../../core/contracts';
import { Album, Artist, ArtistMatchCandidate, orderAlbumTracks, Track } from '../../../core/models';
import { PlayerService } from '../../../core/player/player.service';
import { QueueActionsService } from '../../../core/player/queue-actions.service';
import { DurationPipe } from '../../../shared/pipes/duration.pipe';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { artistAvatarCandidates } from '../artist-avatar';
import { orderArtistTracks } from '../artist-play-order';

@Component({
  selector: 'app-artist-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, DurationPipe, IconComponent],
  templateUrl: './artist-detail.component.html',
  styleUrl: './artist-detail.component.scss'
})
export class ArtistDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly libraryGateway = inject(LIBRARY_GATEWAY);
  private readonly artistMetadata = inject(ARTIST_METADATA_GATEWAY);
  private readonly destroyRef = inject(DestroyRef);
  readonly player = inject(PlayerService);
  private readonly queueActions = inject(QueueActionsService);

  readonly artist = signal<Artist | null>(null);
  readonly artistAlbums = signal<Album[]>([]);
  readonly artistTracks = signal<Track[]>([]);
  readonly allTracks = signal<Track[]>([]);
  readonly isLoading = signal<boolean>(true);
  readonly metadataStatus = signal<'idle' | 'loading' | 'available' | 'not-found' | 'ambiguous' | 'matched-empty' | 'error'>('idle');
  readonly metadataError = signal<string | null>(null);
  readonly biographyExpanded = signal(false);
  readonly failedAvatars = signal<Set<string>>(new Set());
  readonly aboutImageFailed = signal(false);
  readonly showMetadataEditor = signal(false);
  readonly candidateQuery = signal('');
  readonly candidates = signal<ArtistMatchCandidate[]>([]);
  readonly selectedCandidateId = signal<string | null>(null);
  readonly wikipediaOverride = signal('');
  readonly editorLoading = signal(false);
  readonly editorError = signal<string | null>(null);
  readonly sourceLinks = computed(() => {
    const metadata = this.artist()?.onlineMetadata;
    if (!metadata) return [];
    const values = [
      metadata.biographySourceUrl ? { label: sourceLabel(metadata.biographySourceUrl), url: metadata.biographySourceUrl } : null,
      metadata.avatarSourceUrl ? { label: sourceLabel(metadata.avatarSourceUrl), url: metadata.avatarSourceUrl } : null,
      metadata.aboutImageSourceUrl ? { label: sourceLabel(metadata.aboutImageSourceUrl), url: metadata.aboutImageSourceUrl } : null,
      { label: 'MusicBrainz', url: `https://musicbrainz.org/artist/${metadata.musicBrainzId}` },
    ].filter((value): value is { label: string; url: string } => Boolean(value));
    return values.filter((value, index) => values.findIndex((candidate) => candidate.url === value.url) === index);
  });
  readonly hasAboutContent = computed(() => {
    const metadata = this.artist()?.onlineMetadata;
    return Boolean(metadata?.biography?.trim() || (metadata?.aboutImage && !this.aboutImageFailed()));
  });
  readonly metadataNotice = computed(() => {
    if (this.hasAboutContent()) return null;
    switch (this.metadataStatus()) {
      case 'ambiguous': return 'Several MusicBrainz profiles match this name. Choose the correct one in Edit online info.';
      case 'not-found': return 'No matching MusicBrainz profile was found. Search or choose a profile in Edit online info.';
      case 'matched-empty': return 'A MusicBrainz profile was matched, but no biography or About image was found. You can provide a Wikipedia page in Edit online info.';
      case 'available': return 'An artist image was found, but no biography or About image is available yet.';
      case 'error': return 'Artist information could not be loaded. Retry or choose a profile in Edit online info.';
      default: return null;
    }
  });
  readonly heroAvatar = computed(() => {
    const artist = this.artist();
    if (!artist) return null;
    return artistAvatarCandidates(artist, this.artistAlbums()).find((url) => !this.failedAvatars().has(url)) ?? null;
  });

  onAvatarError(): void {
    const url = this.heroAvatar();
    if (url) this.failedAvatars.update((current) => new Set(current).add(url));
  }

  async ngOnInit(): Promise<void> {
    const artistId = this.route.snapshot.paramMap.get('id');
    if (!artistId) {
      this.isLoading.set(false);
      return;
    }

    let wasScanning = false;
    this.libraryGateway.scanProgress$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((progress) => {
      const justFinished = wasScanning && !progress.isScanning;
      wasScanning = progress.isScanning;
      if (justFinished) void this.refreshLibraryArtwork(artistId);
    });
    this.libraryGateway.libraryChanged$?.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => void this.refreshLibraryArtwork(artistId));

    this.artistMetadata.updates$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((update) => {
      if (update.artistId !== artistId) return;
      this.artist.update((artist) => artist ? { ...artist, onlineMetadata: update.metadata, customAvatar: update.customAvatar === undefined ? artist.customAvatar : update.customAvatar } : artist);
      this.metadataStatus.set(update.status);
      this.metadataError.set(update.error ?? null);
    });

    try {
      const lib = await this.libraryGateway.getLibrary();
      this.allTracks.set(lib.tracks);
      const foundArtist = lib.artists.find((a) => a.id === artistId) || null;
      this.artist.set(foundArtist);

      if (foundArtist) {
        this.metadataStatus.set(foundArtist.onlineMetadata ? 'available' : 'loading');
        // Albums by this artist
        const albums = lib.albums.filter((a) => foundArtist.albumIds.includes(a.id));
        this.artistAlbums.set(albums);

        // Tracks by this artist, in album playback order.
        this.artistTracks.set(orderArtistTracks(foundArtist, albums, lib.tracks));
        void this.artistMetadata.ensureArtist(foundArtist.id).catch((error: unknown) => {
          this.metadataStatus.set('error');
          this.metadataError.set(errorMessage(error));
        });
      }
    } finally {
      this.isLoading.set(false);
    }
  }

  private async refreshLibraryArtwork(artistId: string): Promise<void> {
    const library = await this.libraryGateway.getLibrary();
    const artist = library.artists.find((item) => item.id === artistId);
    this.allTracks.set(library.tracks);
    this.artist.set(artist ?? null);
    if (!artist) {
      this.artistAlbums.set([]);
      this.artistTracks.set([]);
      return;
    }
    const albums = library.albums.filter((album) => artist.albumIds.includes(album.id));
    this.artistAlbums.set(albums);
    this.artistTracks.set(orderArtistTracks(artist, albums, library.tracks));
  }

  async retryMetadata(): Promise<void> {
    const artist = this.artist();
    if (!artist) return;
    this.metadataStatus.set('loading');
    this.metadataError.set(null);
    try {
      const metadata = await this.artistMetadata.refreshArtist(artist.id);
      this.artist.update((value) => value ? { ...value, onlineMetadata: metadata } : value);
      if (metadata) this.metadataStatus.set('available');
      else if (this.metadataStatus() === 'loading') this.metadataStatus.set('not-found');
    } catch (error) {
      this.metadataStatus.set('error');
      this.metadataError.set(errorMessage(error));
    }
  }

  async openMetadataEditor(): Promise<void> {
    const artist = this.artist();
    if (!artist) return;
    this.showMetadataEditor.set(true);
    this.candidateQuery.set(artist.name);
    this.selectedCandidateId.set(artist.onlineMetadata?.musicBrainzId ?? null);
    this.wikipediaOverride.set('');
    setTimeout(() => document.querySelector<HTMLElement>('.metadata-modal-card input')?.focus());
    await this.searchMetadataCandidates();
  }

  closeMetadataEditor(): void {
    this.showMetadataEditor.set(false);
    this.editorError.set(null);
  }

  async chooseCustomAvatar(): Promise<void> {
    const artist = this.artist();
    if (!artist) return;
    this.editorError.set(null);
    try {
      const avatar = await this.artistMetadata.selectCustomAvatar(artist.id);
      if (avatar) this.artist.update((value) => value ? { ...value, customAvatar: avatar } : value);
    } catch (error) { this.editorError.set(errorMessage(error)); }
  }

  async removeCustomAvatar(): Promise<void> {
    const artist = this.artist();
    if (!artist) return;
    this.editorError.set(null);
    try {
      await this.artistMetadata.clearCustomAvatar(artist.id);
      this.artist.update((value) => value ? { ...value, customAvatar: null } : value);
    } catch (error) { this.editorError.set(errorMessage(error)); }
  }

  async searchMetadataCandidates(): Promise<void> {
    const query = this.candidateQuery().trim();
    if (!query) return;
    this.editorLoading.set(true);
    this.editorError.set(null);
    try { this.candidates.set(await this.artistMetadata.searchCandidates(query)); }
    catch (error) { this.editorError.set(errorMessage(error)); }
    finally { this.editorLoading.set(false); }
  }

  async saveMetadataMatch(): Promise<void> {
    const artist = this.artist();
    const mbid = this.selectedCandidateId();
    if (!artist || !mbid) { this.editorError.set('Select a MusicBrainz artist.'); return; }
    this.editorLoading.set(true);
    this.editorError.set(null);
    try {
      let metadata = await this.artistMetadata.setArtistMatch(artist.id, mbid);
      const wikipedia = this.wikipediaOverride().trim();
      if (wikipedia) metadata = await this.artistMetadata.setWikipediaOverride(artist.id, wikipedia);
      this.artist.update((value) => value ? { ...value, onlineMetadata: metadata } : value);
      this.metadataStatus.set(metadata ? 'available' : 'matched-empty');
      this.closeMetadataEditor();
    } catch (error) { this.editorError.set(errorMessage(error)); }
    finally { this.editorLoading.set(false); }
  }

  onEditorKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); this.closeMetadataEditor(); return; }
    if (event.key !== 'Tab') return;
    const container = event.currentTarget as HTMLElement;
    const focusable = [...container.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')];
    if (!focusable.length) return;
    const first = focusable[0]; const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  openSource(url: string): void { void this.artistMetadata.openSource(url); }

  onPlayAll(): void {
    const artist = this.artist();
    if (!artist) return;
    const tracks = orderArtistTracks(artist, this.artistAlbums(), this.allTracks());
    if (tracks.length > 0) {
      this.player.setShuffle(false);
      this.player.playCollection(tracks, 0);
    }
  }

  onPlayTrack(track: Track, index: number): void {
    if (!track.isAvailable) return;
    const artist = this.artist();
    if (!artist) return;
    const tracks = orderArtistTracks(artist, this.artistAlbums(), this.allTracks());
    const selectedIndex = tracks.findIndex((item) => item.id === track.id);
    if (selectedIndex < 0) return;
    this.player.setShuffle(false);
    this.player.playCollection(tracks, selectedIndex);
  }

  onPlayAlbum(event: MouseEvent, album: Album): void {
    event.stopPropagation();
    const albumTracks = this.tracksForAlbum(album);

    if (albumTracks.length === 0) return;

    this.player.setShuffle(false);
    this.player.playCollection(albumTracks, 0);
  }

  onAddAllToQueue(): void {
    const artist = this.artist();
    if (artist) this.queueActions.add(orderArtistTracks(artist, this.artistAlbums(), this.allTracks()));
  }

  onAddAlbumToQueue(event: MouseEvent, album: Album): void {
    event.stopPropagation();
    this.queueActions.add(this.tracksForAlbum(album));
  }

  onAddTrackToQueue(track: Track): void {
    this.queueActions.add([track]);
  }

  private tracksForAlbum(album: Album): Track[] {
    const trackMap = new Map(this.allTracks().map((track) => [track.id, track]));
    return orderAlbumTracks(album.trackIds
      .map((trackId) => trackMap.get(trackId))
      .filter((track): track is Track => Boolean(track)));
  }
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function sourceLabel(url: string): string {
  const host = new URL(url).hostname;
  if (host.includes('wikipedia')) return 'Wikipedia';
  if (host.includes('wikidata')) return 'Wikidata';
  if (host.includes('theaudiodb')) return 'TheAudioDB';
  return 'Source';
}
