import { selectPlaylistArtwork } from '../../shared/utils/list-media';
import { Component, DestroyRef, ElementRef, Injector, OnInit, afterNextRender, computed, effect, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { LIBRARY_GATEWAY, PLAYLIST_GATEWAY } from '../../core/contracts';
import { Playlist, Track } from '../../core/models';
import { PlayerService } from '../../core/player/player.service';
import { QueueActionsService } from '../../core/player/queue-actions.service';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { AlbumCardComponent } from '../../shared/components/album-card/album-card.component';

const UNDO_DELETE_MS = 6000;

@Component({
  selector: 'app-playlists',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, IconComponent, AlbumCardComponent],
  templateUrl: './playlists.component.html',
  styleUrl: './playlists.component.scss'
})
export class PlaylistsComponent implements OnInit {
  readonly playlistArtwork = selectPlaylistArtwork;
  private readonly playlistGateway = inject(PLAYLIST_GATEWAY);
  private readonly libraryGateway = inject(LIBRARY_GATEWAY);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly player = inject(PlayerService);
  private readonly queueActions = inject(QueueActionsService);

  readonly playlists = signal<Playlist[]>([]);
  readonly allTracks = signal<Track[]>([]);
  readonly isLoading = signal<boolean>(true);
  readonly errorMessage = signal<string | null>(null);

  // Deleting hides the playlist at once; the gateway delete runs after the undo window or when the page closes.
  readonly pendingDelete = signal<Playlist | null>(null);
  private readonly hiddenIds = signal<ReadonlySet<string>>(new Set());
  private deleteTimer: ReturnType<typeof setTimeout> | undefined;

  readonly visiblePlaylists = computed(() => {
    const hidden = this.hiddenIds();
    return this.playlists().filter((p) => !hidden.has(p.id));
  });

  // Modals state
  readonly showCreateModal = signal<boolean>(false);
  newPlaylistName = '';

  readonly playlistToRename = signal<Playlist | null>(null);
  renameValue = '';

  private readonly createPlaylistDialog = viewChild<ElementRef<HTMLDialogElement>>('createPlaylistDialog');
  private readonly renamePlaylistDialog = viewChild<ElementRef<HTMLDialogElement>>('renamePlaylistDialog');
  private readonly openPlaylistDialogs = effect(() => {
    for (const ref of [this.createPlaylistDialog(), this.renamePlaylistDialog()]) {
      const dialog = ref?.nativeElement;
      if (dialog && !dialog.open) dialog.showModal();
    }
  });

  onPlaylistDialogClick(event: MouseEvent, name: 'createPlaylistDialog' | 'renamePlaylistDialog'): void {
    const dialog = event.currentTarget as HTMLDialogElement;
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) {
      if (name === 'createPlaylistDialog') this.showCreateModal.set(false);
      else this.playlistToRename.set(null);
    }
  }

  constructor() {
    this.destroyRef.onDestroy(() => this.flushPendingDelete());
  }

  async ngOnInit(): Promise<void> {
    this.libraryGateway.libraryChanged$?.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => void this.loadData());
    await this.loadData();
  }

  async loadData(): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set(null);
    try {
      const [plist, lib] = await Promise.all([
        this.playlistGateway.getPlaylists(),
        this.libraryGateway.getLibrary(),
      ]);
      this.playlists.set(plist);
      this.allTracks.set(lib.tracks);
    } catch (err: any) {
      this.errorMessage.set(err?.message || 'Failed to load playlists');
    } finally {
      this.isLoading.set(false);
    }
  }

  async onConfirmCreate(): Promise<void> {
    const name = this.newPlaylistName.trim();
    if (!name) return;
    this.errorMessage.set(null);
    try {
      await this.playlistGateway.createPlaylist(name);
      this.newPlaylistName = '';
      this.showCreateModal.set(false);
      await this.loadData();
    } catch (err: any) {
      this.errorMessage.set(err?.message || 'Failed to create playlist');
    }
  }

  onOpenRename(event: MouseEvent, playlist: Playlist): void {
    event.stopPropagation();
    this.playlistToRename.set(playlist);
    this.renameValue = playlist.name;
  }

  async onConfirmRename(): Promise<void> {
    const pl = this.playlistToRename();
    if (!pl || !this.renameValue.trim()) return;
    this.errorMessage.set(null);
    try {
      await this.playlistGateway.renamePlaylist(pl.id, this.renameValue.trim());
      this.playlistToRename.set(null);
      await this.loadData();
    } catch (err: any) {
      this.errorMessage.set(err?.message || 'Failed to rename playlist');
    }
  }

  onDeletePlaylist(event: MouseEvent, playlist: Playlist): void {
    event.stopPropagation();
    const visible = this.visiblePlaylists();
    const index = visible.findIndex((p) => p.id === playlist.id);
    const neighbour = visible[index + 1] ?? visible[index - 1] ?? null;
    // Only one delete can be undone; an earlier pending delete is committed now.
    this.flushPendingDelete();
    this.setHidden(playlist.id, true);
    this.pendingDelete.set(playlist);
    this.deleteTimer = setTimeout(() => this.flushPendingDelete(), UNDO_DELETE_MS);
    this.focusCardAfterRender(neighbour?.id ?? null);
  }

  onUndoDelete(): void {
    const pending = this.pendingDelete();
    if (!pending) return;
    clearTimeout(this.deleteTimer);
    this.pendingDelete.set(null);
    this.setHidden(pending.id, false);
    this.focusCardAfterRender(pending.id);
  }

  private flushPendingDelete(): void {
    clearTimeout(this.deleteTimer);
    const pending = this.pendingDelete();
    if (!pending) return;
    this.pendingDelete.set(null);
    void this.commitDelete(pending);
  }

  /** The playlist stays hidden while the delete runs, and comes back if it fails. */
  private async commitDelete(playlist: Playlist): Promise<void> {
    try {
      await this.playlistGateway.deletePlaylist(playlist.id);
      if (!this.destroyRef.destroyed) this.playlists.update((list) => list.filter((p) => p.id !== playlist.id));
    } catch (err: any) {
      if (!this.destroyRef.destroyed) this.errorMessage.set(err?.message || 'Failed to delete playlist');
    } finally {
      if (!this.destroyRef.destroyed) this.setHidden(playlist.id, false);
    }
  }

  private setHidden(id: string, hidden: boolean): void {
    this.hiddenIds.update((ids) => {
      const next = new Set(ids);
      if (hidden) next.add(id); else next.delete(id);
      return next;
    });
  }

  /** Focuses a playlist card, or the create button when none is given, once the grid has re-rendered. */
  private focusCardAfterRender(playlistId: string | null): void {
    if (typeof document === 'undefined') return;
    afterNextRender(() => {
      const host = this.host.nativeElement;
      const card = playlistId
        ? host.querySelector<HTMLElement>(`app-album-card[data-playlist-id="${CSS.escape(playlistId)}"]`)
        : null;
      const target = card ? card.querySelector<HTMLElement>('a, button') ?? card : host.querySelector<HTMLElement>('.btn-create');
      target?.focus();
    }, { injector: this.injector });
  }

  onPlayPlaylist(playlist: Playlist): void {
    const tracks = this.tracksForPlaylist(playlist);
    if (tracks.length > 0) {
      this.player.playCollection(tracks, 0);
    }
  }

  onAddPlaylistToQueue(playlist: Playlist): void {
    this.queueActions.add(this.tracksForPlaylist(playlist));
  }

  private tracksForPlaylist(playlist: Playlist): Track[] {
    const trackMap = new Map<string, Track>();
    this.allTracks().forEach((t) => trackMap.set(t.id, t));

    const tracks: Track[] = [];
    playlist.entries.forEach((entry) => {
      const t = trackMap.get(entry.trackId);
      if (t) tracks.push(t);
    });

    return tracks;
  }
}
