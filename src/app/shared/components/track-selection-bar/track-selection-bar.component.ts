import { Component, HostListener, computed, inject, input, output, signal } from '@angular/core';
import { Track } from '../../../core/models';
import { PlayerService } from '../../../core/player/player.service';
import { QueueActionsService } from '../../../core/player/queue-actions.service';
import { AddToPlaylistDialogComponent } from '../add-to-playlist-dialog/add-to-playlist-dialog.component';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-track-selection-bar',
  standalone: true,
  imports: [AddToPlaylistDialogComponent, IconComponent],
  templateUrl: './track-selection-bar.component.html',
  styleUrl: './track-selection-bar.component.scss',
})
export class TrackSelectionBarComponent {
  readonly tracks = input.required<readonly Track[]>();
  readonly excludePlaylistId = input<string>();
  readonly clear = output<void>();
  private readonly player = inject(PlayerService);
  private readonly queueActions = inject(QueueActionsService);
  readonly dialogOpen = signal(false);
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

  @HostListener('keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.isComposing || event.key !== 'Escape') return;
    event.preventDefault();
    this.clear.emit();
  }
}
