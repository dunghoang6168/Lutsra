import { Component, DestroyRef, ElementRef, OnDestroy, afterNextRender, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LIBRARY_GATEWAY, PLAYLIST_GATEWAY } from '../../../core/contracts';
import { Playlist, Track } from '../../../core/models';
import { QueueActionsService } from '../../../core/player/queue-actions.service';
import { selectPlaylistArtwork, splitDuplicates } from '../../utils/list-media';
import { IconComponent } from '../icon/icon.component';

interface PendingAdd { playlist: Playlist; duplicates: string[]; fresh: string[]; }

@Component({
  selector: 'app-add-to-playlist-dialog',
  standalone: true,
  imports: [FormsModule, IconComponent],
  templateUrl: './add-to-playlist-dialog.component.html',
  styleUrl: './add-to-playlist-dialog.component.scss',
})
export class AddToPlaylistDialogComponent implements OnDestroy {
  readonly tracks = input.required<readonly Track[]>();
  readonly excludePlaylistId = input<string>();
  readonly closed = output<void>();
  readonly added = output<Playlist>();
  private readonly gateway = inject(PLAYLIST_GATEWAY);
  private readonly library = inject(LIBRARY_GATEWAY);
  private readonly queueActions = inject(QueueActionsService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dialog');
  private focusBeforeDialog: HTMLElement | null = null;
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly playlists = signal<Playlist[]>([]);
  readonly libraryTracks = signal<ReadonlyMap<string, Track>>(new Map());
  readonly query = signal('');
  readonly pending = signal<PendingAdd | null>(null);
  readonly available = computed(() => this.tracks().filter((track) => track.isAvailable));
  readonly trackIds = computed(() => this.available().map((track) => track.id));
  readonly filtered = computed(() => {
    const query = this.query().trim().toLocaleLowerCase();
    return this.playlists().filter((playlist) => playlist.name.toLocaleLowerCase().includes(query));
  });
  readonly title = computed(() => this.tracks().length === 1 ? '“' + this.tracks()[0].title + '”' : this.tracks().length + ' tracks');

  constructor() {
    afterNextRender(() => {
      this.focusBeforeDialog = document.activeElement as HTMLElement | null;
      this.dialog()?.nativeElement.showModal();
    });
    void this.load();
  }

  ngOnDestroy(): void {
    this.dialog()?.nativeElement.close();
    if (this.focusBeforeDialog?.isConnected) this.focusBeforeDialog.focus();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [playlists, library] = await Promise.all([this.gateway.getPlaylists(), this.library.getLibrary()]);
      if (this.destroyRef.destroyed) return;
      this.playlists.set(playlists.filter((playlist) => playlist.id !== this.excludePlaylistId()));
      this.libraryTracks.set(new Map(library.tracks.map((track) => [track.id, track])));
    } catch (error) {
      if (!this.destroyRef.destroyed) this.error.set('Could not load playlists. ' + errorMessage(error));
    } finally {
      if (!this.destroyRef.destroyed) this.loading.set(false);
    }
  }

  artwork(playlist: Playlist): string[] {
    return selectPlaylistArtwork(playlist.entries, this.libraryTracks());
  }

  contains(playlist: Playlist): boolean {
    return splitDuplicates(playlist.entries, this.trackIds()).duplicates.length > 0;
  }

  choose(playlist: Playlist): void {
    const split = splitDuplicates(playlist.entries, this.trackIds());
    if (split.duplicates.length) this.pending.set({ playlist, ...split });
    else void this.add(playlist, split.fresh);
  }

  async create(): Promise<void> {
    const name = this.query().trim();
    if (!name || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const playlist = await this.gateway.createPlaylist(name);
      if (this.destroyRef.destroyed) return;
      this.playlists.update((playlists) => [...playlists, playlist]);
      this.busy.set(false);
      await this.add(playlist, this.trackIds());
    } catch (error) {
      if (!this.destroyRef.destroyed) this.error.set('Could not create playlist. ' + errorMessage(error));
    } finally {
      if (!this.destroyRef.destroyed) this.busy.set(false);
    }
  }

  async add(playlist: Playlist, trackIds: readonly string[]): Promise<void> {
    if (this.busy()) return;
    if (!trackIds.length) {
      this.error.set('No available tracks to add.');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const updated = await this.gateway.addTracks(playlist.id, [...trackIds]);
      if (this.destroyRef.destroyed) return;
      this.added.emit(updated);
      const skipped = this.tracks().length - this.available().length;
      const count = trackIds.length;
      this.queueActions.notify('Added ' + count + (count === 1 ? ' track' : ' tracks') + ' to “' + playlist.name + '”'
        + (skipped ? ', skipped ' + skipped + ' unavailable' : ''));
      this.closed.emit();
    } catch (error) {
      if (!this.destroyRef.destroyed) this.error.set('Could not add tracks to playlist. ' + errorMessage(error) + ' Try again.');
    } finally {
      if (!this.destroyRef.destroyed) this.busy.set(false);
    }
  }

  onCancel(event: Event): void {
    event.preventDefault();
    if (this.pending()) this.pending.set(null);
    else this.closed.emit();
  }

  onKeyDown(event: KeyboardEvent): void {
    // Keep global player/search shortcuts outside the modal's focus scope.
    event.stopPropagation();
    if (event.key === 'Escape') this.onCancel(event);
  }

  onBackdropClick(event: MouseEvent): void {
    const dialog = this.dialog()?.nativeElement;
    if (!dialog || event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom) this.closed.emit();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
