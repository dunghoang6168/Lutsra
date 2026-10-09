import { linkedSignal, WritableSignal, Component, DestroyRef, OnInit, computed, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { ARTIST_METADATA_GATEWAY, LIBRARY_GATEWAY } from '../../../core/contracts';
import { Album, Artist, ArtistMatchCandidate, orderAlbumTracks, Track } from '../../../core/models';
import { albumFormatMap } from '../../home/library-quality';
import { PlayerService } from '../../../core/player/player.service';
import { QueueActionsService } from '../../../core/player/queue-actions.service';
import { TrackSelectionService } from '../../../core/layout/track-selection.service';
import { focusListItem, nextRowIndex } from '../../../shared/utils/row-navigation';
import { RowSelection, RowSelectionAction, selectRows, visibleRowSelection } from '../../../shared/utils/row-selection';
import { TrackSelectionBarComponent } from '../../../shared/components/track-selection-bar/track-selection-bar.component';
import { DurationPipe } from '../../../shared/pipes/duration.pipe';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { TrackActionsMenuComponent } from '../../../shared/components/track-actions-menu/track-actions-menu.component';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { artistAvatarCandidates } from '../artist-avatar';
import { orderArtistTracks } from '../artist-play-order';
import { AlbumCardComponent } from '../../../shared/components/album-card/album-card.component';

@Component({
  selector: 'app-artist-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, DurationPipe, IconComponent, AlbumCardComponent, TrackSelectionBarComponent, TrackActionsMenuComponent],
  templateUrl: './artist-detail.component.html',
  styleUrl: './artist-detail.component.scss'
})
export class ArtistDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly libraryGateway = inject(LIBRARY_GATEWAY);
  private readonly artistMetadata = inject(ARTIST_METADATA_GATEWAY);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private currentId: string | null | undefined;
  private loadToken = 0;
  private routeVersion = 0;
  readonly player = inject(PlayerService);
  private readonly selection = inject(TrackSelectionService);
  private readonly rowsContainer = viewChild<ElementRef<HTMLElement>>('rowsContainer');
  readonly activeId = signal<string | null>(null);
  private readonly queueActions = inject(QueueActionsService);

  readonly artist = signal<Artist | null>(null);
  readonly artistAlbums = signal<Album[]>([]);
  readonly artistTracks = signal<Track[]>([]);
  readonly allTracks = signal<Track[]>([]);
  readonly albumFormats = computed(() => albumFormatMap(this.artistAlbums(), this.allTracks()));
  readonly isLoading = signal<boolean>(true);
  readonly metadataStatus = signal<'idle' | 'loading' | 'available' | 'not-found' | 'ambiguous' | 'matched-empty' | 'error'>('idle');
  readonly metadataError = signal<string | null>(null);
  readonly biographyExpanded = signal(false);
  readonly failedAvatars = signal<Set<string>>(new Set());
  readonly aboutImageFailed = signal(false);
  readonly showMetadataEditor = signal(false);
  private readonly metadataDialog = viewChild<ElementRef<HTMLDialogElement>>('metadataDialog');
  private readonly openMetadataDialog = effect(() => {
    const dialog = this.metadataDialog()?.nativeElement;
    if (dialog && !dialog.open) dialog.showModal();
  });

  onMetadataDialogClick(event: MouseEvent): void {
    const dialog = event.currentTarget as HTMLDialogElement;
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) this.closeMetadataEditor();
  }

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

  // Drops ids that leave the view; selectedRows adds the focused-row fallback.
  // Created on first use because detail-route-reuse tests build the component from its prototype, without field initialisers.
  private selectionState?: WritableSignal<RowSelection>;
  private get rowSelection(): WritableSignal<RowSelection> {
    return this.selectionState ??= linkedSignal<readonly string[], RowSelection>({
      source: () => this.visibleRowIds?.() ?? [],
      computation: (ids, previous) => visibleRowSelection(previous?.value ?? { ids: new Set(), anchor: null }, ids, this.activeId()),
    });
  }
  readonly visibleRowIds = computed(() => this.artistTracks().map((row) => row.id));
  readonly selectedRows = computed(() => visibleRowSelection(this.rowSelection(), this.visibleRowIds(), this.activeId()));
  readonly selectedTracks = computed(() => this.artistTracks().filter((row) => this.selectedRows().ids.has(row.id)).map((row) => row));

  private updateRowSelection(action: RowSelectionAction): void {
    this.rowSelection.set(selectRows(this.selectedRows(), this.visibleRowIds(), action));
  }

  onRowMouseDown(event: MouseEvent): void {
    if (event.shiftKey) event.preventDefault();
  }

  onRowClick(track: Track, event: MouseEvent): void {
    this.updateRowSelection({ type: event.shiftKey ? 'range' : event.ctrlKey ? 'toggle' : 'replace', id: track.id });
    this.onActivateTrack(track, true);
  }

  collapseSelection(): void {
    const rows = this.artistTracks();
    const active = rows.find((row) => row.id === this.activeId()) ?? rows[0];
    if (!active) return;
    this.updateRowSelection({ type: 'collapse', id: active.id });
    this.onActivateTrack(active, true);
  }

  constructor() {
    effect(() => {
      const rows = this.artistTracks();
      untracked(() => {
        if (!rows.some((row) => row.id === this.activeId())) {
          this.activeId.set(rows[0] ? rows[0].id : null);
        }
        const active = rows.find((row) => row.id === this.activeId());
        this.selection.selected.set(active ? active : null);
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
      this.artist.set(null);
      this.artistAlbums.set([]);
      this.artistTracks.set([]);
      this.allTracks.set([]);
      this.metadataStatus.set('idle');
      this.metadataError.set(null);
      this.biographyExpanded.set(false);
      this.failedAvatars.set(new Set());
      this.aboutImageFailed.set(false);
      this.showMetadataEditor.set(false);
      this.candidateQuery.set('');
      this.candidates.set([]);
      this.selectedCandidateId.set(null);
      this.wikipediaOverride.set('');
      this.editorLoading.set(false);
      this.editorError.set(null);
      this.isLoading.set(Boolean(id));
      const viewport = this.host.nativeElement.closest<HTMLElement>('.main-content');
      if (viewport) { viewport.scrollTop = 0; viewport.scrollLeft = 0; }
      void this.loadArtist(true);
    });

    let wasScanning = false;
    this.libraryGateway.scanProgress$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((progress) => {
      const justFinished = wasScanning && !progress.isScanning;
      wasScanning = progress.isScanning;
      if (justFinished) void this.loadArtist();
    });
    this.libraryGateway.libraryChanged$?.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => void this.loadArtist());

    this.artistMetadata.updates$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((update) => {
      if (update.artistId !== this.currentId || this.artist()?.id !== update.artistId) return;
      this.artist.update((artist) => artist ? { ...artist, onlineMetadata: update.metadata, customAvatar: update.customAvatar === undefined ? artist.customAvatar : update.customAvatar } : artist);
      this.metadataStatus.set(update.status);
      this.metadataError.set(update.error ?? null);
    });
  }

  private async loadArtist(ensureMetadata = false): Promise<void> {
    const artistId = this.currentId;
    const token = ++this.loadToken;
    const routeVersion = this.routeVersion;
    if (!artistId) { this.isLoading.set(false); return; }
    try {
      const library = await this.libraryGateway.getLibrary();
      if (token !== this.loadToken || this.destroyRef.destroyed) return;
      const artist = library.artists.find((item) => item.id === artistId) ?? null;
      const albums = artist ? library.albums.filter((album) => artist.albumIds.includes(album.id)) : [];
      this.allTracks.set(library.tracks);
      this.artist.set(artist);
      this.artistAlbums.set(albums);
      this.rowSelection.set(selectRows(this.rowSelection(), [], { type: 'reset' }));
      this.artistTracks.set(artist ? orderArtistTracks(artist, albums, library.tracks) : []);
      if (artist && ensureMetadata) {
        this.metadataStatus.set(artist.onlineMetadata ? 'available' : 'loading');
        void this.artistMetadata.ensureArtist(artist.id).catch((error: unknown) => {
          if (routeVersion !== this.routeVersion || this.destroyRef.destroyed) return;
          this.metadataStatus.set('error');
          this.metadataError.set(errorMessage(error));
        });
      }
    } catch (error) {
      if (token === this.loadToken && !this.destroyRef.destroyed) console.error('Could not load artist', error);
    } finally {
      if (token === this.loadToken && !this.destroyRef.destroyed) this.isLoading.set(false);
    }
  }

  async retryMetadata(): Promise<void> {
    const artist = this.artist();
    if (!artist) return;
    const routeVersion = this.routeVersion;
    this.metadataStatus.set('loading');
    this.metadataError.set(null);
    try {
      const metadata = await this.artistMetadata.refreshArtist(artist.id);
      if (routeVersion !== this.routeVersion || this.destroyRef.destroyed) return;
      this.artist.update((value) => value ? { ...value, onlineMetadata: metadata } : value);
      if (metadata) this.metadataStatus.set('available');
      else if (this.metadataStatus() === 'loading') this.metadataStatus.set('not-found');
    } catch (error) {
      if (routeVersion !== this.routeVersion || this.destroyRef.destroyed) return;
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
    const routeVersion = this.routeVersion;
    setTimeout(() => {
      if (routeVersion === this.routeVersion && !this.destroyRef.destroyed && this.showMetadataEditor()) {
        this.host.nativeElement.querySelector<HTMLElement>('.metadata-modal-card input')?.focus();
      }
    });
    await this.searchMetadataCandidates();
  }

  closeMetadataEditor(): void {
    this.showMetadataEditor.set(false);
    this.editorError.set(null);
  }

  async chooseCustomAvatar(): Promise<void> {
    const artist = this.artist();
    if (!artist) return;
    const routeVersion = this.routeVersion;
    this.editorError.set(null);
    try {
      const avatar = await this.artistMetadata.selectCustomAvatar(artist.id);
      if (routeVersion !== this.routeVersion || this.destroyRef.destroyed) return;
      if (avatar) this.artist.update((value) => value ? { ...value, customAvatar: avatar } : value);
    } catch (error) {
      if (routeVersion !== this.routeVersion || this.destroyRef.destroyed) return;
      this.editorError.set(errorMessage(error));
    }
  }

  async removeCustomAvatar(): Promise<void> {
    const artist = this.artist();
    if (!artist) return;
    const routeVersion = this.routeVersion;
    this.editorError.set(null);
    try {
      await this.artistMetadata.clearCustomAvatar(artist.id);
      if (routeVersion !== this.routeVersion || this.destroyRef.destroyed) return;
      this.artist.update((value) => value ? { ...value, customAvatar: null } : value);
    } catch (error) {
      if (routeVersion !== this.routeVersion || this.destroyRef.destroyed) return;
      this.editorError.set(errorMessage(error));
    }
  }

  async searchMetadataCandidates(): Promise<void> {
    const query = this.candidateQuery().trim();
    if (!query) return;
    const routeVersion = this.routeVersion;
    this.editorLoading.set(true);
    this.editorError.set(null);
    try {
      const candidates = await this.artistMetadata.searchCandidates(query);
      if (routeVersion !== this.routeVersion || this.destroyRef.destroyed) return;
      this.candidates.set(candidates);
    } catch (error) {
      if (routeVersion !== this.routeVersion || this.destroyRef.destroyed) return;
      this.editorError.set(errorMessage(error));
    } finally { if (routeVersion === this.routeVersion && !this.destroyRef.destroyed) this.editorLoading.set(false); }
  }

  async saveMetadataMatch(): Promise<void> {
    const artist = this.artist();
    const mbid = this.selectedCandidateId();
    const wikipedia = this.wikipediaOverride().trim();
    if (!artist || !mbid) { this.editorError.set('Select a MusicBrainz artist.'); return; }
    const routeVersion = this.routeVersion;
    this.editorLoading.set(true);
    this.editorError.set(null);
    try {
      let metadata = await this.artistMetadata.setArtistMatch(artist.id, mbid);
      if (routeVersion !== this.routeVersion || this.destroyRef.destroyed) return;
      if (wikipedia) metadata = await this.artistMetadata.setWikipediaOverride(artist.id, wikipedia);
      if (routeVersion !== this.routeVersion || this.destroyRef.destroyed) return;
      this.artist.update((value) => value ? { ...value, onlineMetadata: metadata } : value);
      this.metadataStatus.set(metadata ? 'available' : 'matched-empty');
      this.closeMetadataEditor();
    } catch (error) {
      if (routeVersion !== this.routeVersion || this.destroyRef.destroyed) return;
      this.editorError.set(errorMessage(error));
    } finally { if (routeVersion === this.routeVersion && !this.destroyRef.destroyed) this.editorLoading.set(false); }
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

  onActivateTrack(track: Track, moveFocus = false): void {
    this.activeId.set(track.id);
    this.selection.selected.set(track);
    if (moveFocus) focusListItem(this.rowsContainer()?.nativeElement, 'data-track-id', track.id);
  }

  onRowsKeyDown(event: KeyboardEvent): void {
    if (this.showMetadataEditor()) return;
    if (event.defaultPrevented || event.isComposing || event.altKey || event.metaKey) return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.closest('input, textarea, select, [contenteditable], [role="textbox"], [role="combobox"]')) return;
    const row = target.closest<HTMLElement>('.track-row[data-track-id]');
    if (!row || row.parentElement !== event.currentTarget) return;
    const rows = this.artistTracks();
    const current = rows.findIndex((item) => item.id === row.dataset['trackId']);
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
      this.updateRowSelection({ type: 'toggle', id: rows[current].id });
      return;
    }
    if (event.key === 'Enter' && !event.ctrlKey) {
      event.preventDefault();
      this.onPlayTrack(rows[current], current);
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
    if (event.shiftKey) this.updateRowSelection({ type: 'range', id: rows[next].id });
    else if (!event.ctrlKey) this.updateRowSelection({ type: 'replace', id: rows[next].id });
    this.onActivateTrack(rows[next], true);
  }

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

  onPlayAlbum(album: Album): void {
    const albumTracks = this.tracksForAlbum(album);

    if (albumTracks.length === 0) return;

    this.player.setShuffle(false);
    this.player.playCollection(albumTracks, 0);
  }

  onAddAllToQueue(): void {
    const artist = this.artist();
    if (artist) this.queueActions.add(orderArtistTracks(artist, this.artistAlbums(), this.allTracks()));
  }

  onAddAlbumToQueue(album: Album): void {
    this.queueActions.add(this.tracksForAlbum(album));
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
