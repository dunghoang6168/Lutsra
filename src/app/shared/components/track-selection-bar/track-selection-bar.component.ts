import { Component, DestroyRef, ElementRef, HostListener, Injector, afterNextRender, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PLAYLIST_GATEWAY } from '../../../core/contracts';
import { Playlist, Track } from '../../../core/models';
import { PlayerService } from '../../../core/player/player.service';
import { QueueActionsService } from '../../../core/player/queue-actions.service';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-track-selection-bar',
  standalone: true,
  imports: [FormsModule, IconComponent],
  templateUrl: './track-selection-bar.component.html',
  styleUrl: './track-selection-bar.component.scss',
})
export class TrackSelectionBarComponent {
  readonly tracks = input.required<readonly Track[]>();
  readonly excludePlaylistId = input<string>();
  readonly clear = output<void>();
  private readonly player = inject(PlayerService);
  private readonly queueActions = inject(QueueActionsService);
  private readonly gateway = inject(PLAYLIST_GATEWAY);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private requestVersion = 0;
  private createdPlaylist: Playlist | null = null;
  readonly open = signal(false);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly playlists = signal<Playlist[]>([]);
  readonly creating = signal(false);
  readonly name = signal('');
  readonly available = computed(() => this.tracks().filter((track) => track.isAvailable));

  playNext(): void {
    const tracks = this.available();
    if (tracks.length) this.player.playNext(tracks);
    this.queueActions.notify(this.resultMessage(tracks.length, 'to play next', this.tracks().length - tracks.length));
  }

  addToQueue(): void {
    const tracks = this.available();
    const result = this.player.addToQueue(tracks);
    this.queueActions.notify(this.resultMessage(result.addedCount, 'to queue', this.tracks().length - tracks.length));
  }

  private resultMessage(count: number, destination: string, skipped: number): string {
    const added = count ? 'Added ' + count + (count === 1 ? ' track ' : ' tracks ') + destination : 'No available tracks to add';
    return added + (skipped ? ', skipped ' + skipped + ' unavailable' : '');
  }

  async togglePopover(): Promise<void> {
    if (this.open()) { this.closePopover(); return; }
    this.open.set(true);
    this.creating.set(false);
    this.name.set('');
    this.createdPlaylist = null;
    this.playlists.set([]);
    this.error.set(null);
    this.loading.set(true);
    this.renderPanel(true);
    await this.loadPlaylists();
  }

  async loadPlaylists(): Promise<void> {
    const version = ++this.requestVersion;
    this.loading.set(true);
    this.error.set(null);
    try {
      const playlists = await this.gateway.getPlaylists();
      if (version !== this.requestVersion || this.destroyRef.destroyed || !this.open()) return;
      this.playlists.set(playlists.filter((playlist) => playlist.id !== this.excludePlaylistId()));
    } catch (error) {
      if (version !== this.requestVersion || this.destroyRef.destroyed || !this.open()) return;
      this.error.set('Could not load playlists. ' + this.errorMessage(error));
    } finally {
      if (version === this.requestVersion && !this.destroyRef.destroyed && this.open()) {
        this.loading.set(false);
        this.renderPanel(!this.creating());
      }
    }
  }

  closePopover(restoreFocus = true): void {
    ++this.requestVersion;
    this.panel()?.nativeElement.hidePopover();
    this.open.set(false);
    if (restoreFocus) this.trigger()?.nativeElement.focus();
  }

  private renderPanel(focusFirst = false, focusInput = false): void {
    afterNextRender(() => {
      if (!this.open() || this.destroyRef.destroyed) return;
      const panel = this.panel()?.nativeElement;
      if (!panel) return;
      if (!panel.matches(':popover-open')) panel.showPopover();
      this.positionPanel();
      if (focusInput) panel.querySelector<HTMLInputElement>('input')?.focus();
      else if (focusFirst) (panel.querySelector<HTMLElement>('[data-playlist-option]:not(:disabled)') ?? panel).focus();
    }, { injector: this.injector });
  }

  @HostListener('window:resize')
  positionPanel(): void {
    const panel = this.panel()?.nativeElement;
    const trigger = this.trigger()?.nativeElement;
    if (!this.open() || !panel || !trigger) return;
    const rect = trigger.getBoundingClientRect();
    const gap = Number.parseFloat(getComputedStyle(panel).paddingLeft);
    panel.style.maxHeight = Math.max(0, window.innerHeight - gap * 2) + 'px';
    const bounds = panel.getBoundingClientRect();
    panel.style.left = Math.max(gap, Math.min(rect.left, window.innerWidth - bounds.width - gap)) + 'px';
    panel.style.top = Math.max(gap, Math.min(rect.bottom + gap, window.innerHeight - bounds.height - gap)) + 'px';
  }

  @HostListener('document:click', ['$event'])
  onOutsideClick(event: MouseEvent): void {
    if (!this.open() || !(event.target instanceof Node)) return;
    if (!this.panel()?.nativeElement.contains(event.target) && !this.trigger()?.nativeElement.contains(event.target)) this.closePopover(false);
  }

  @HostListener('keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (this.open()) this.closePopover();
      else this.clear.emit();
      return;
    }
    if (!this.open() || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') || (event.target as HTMLElement)?.closest('input')) return;
    const options = [...(this.panel()?.nativeElement.querySelectorAll<HTMLButtonElement>('[data-playlist-option]:not(:disabled)') ?? [])];
    if (!options.length) return;
    event.preventDefault();
    const current = options.indexOf(document.activeElement as HTMLButtonElement);
    const next = current < 0 ? 0 : (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    options[next].focus();
  }

  beginCreate(): void {
    this.creating.set(true);
    this.error.set(null);
    this.renderPanel(false, true);
  }

  async addToPlaylist(playlist?: Playlist): Promise<void> {
    if (this.busy() || (!playlist && !this.name().trim())) return;
    const tracks = [...this.available()];
    const skipped = this.tracks().length - tracks.length;
    if (!tracks.length) {
      this.error.set('No available tracks to add. Select an available track and try again.');
      return;
    }
    const version = this.requestVersion;
    this.busy.set(true);
    this.error.set(null);
    try {
      const name = this.name().trim();
      let destination = playlist;
      if (!destination) {
        // Retry a failed add without creating the same playlist a second time.
        destination = this.createdPlaylist?.name === name ? this.createdPlaylist : await this.gateway.createPlaylist(name);
        if (version === this.requestVersion) this.createdPlaylist = destination;
      }
      await this.gateway.addTracks(destination.id, tracks.map((track) => track.id));
      if (this.destroyRef.destroyed) return;
      this.queueActions.notify(this.resultMessage(tracks.length, 'to “' + destination.name + '”', skipped));
      if (this.open() && version === this.requestVersion) this.closePopover();
    } catch (error) {
      if (!this.destroyRef.destroyed && this.open() && version === this.requestVersion) {
        this.error.set('Could not add tracks to playlist. ' + this.errorMessage(error) + ' Try again.');
        this.renderPanel();
      }
    } finally {
      if (!this.destroyRef.destroyed) this.busy.set(false);
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
