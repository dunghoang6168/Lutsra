import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { Track } from '../models';
import { PlayerService, QueueAddResult } from './player.service';

@Injectable({ providedIn: 'root' })
export class QueueActionsService implements OnDestroy {
  private readonly player = inject(PlayerService);
  private dismissTimer: ReturnType<typeof setTimeout> | null = null;

  readonly notice = signal<string | null>(null);

  add(tracks: Track[]): QueueAddResult {
    const result = this.player.addToQueue(tracks);
    const firstAvailable = tracks.find((track) => track.isAvailable);

    if (result.addedCount === 0) {
      this.show('No available tracks to add');
    } else if (result.addedCount === 1) {
      this.show(`Added “${firstAvailable?.title ?? 'track'}” to queue`);
    } else {
      this.show(`Added ${result.addedCount} tracks to queue`);
    }

    return result;
  }

  clear(): void {
    if (this.dismissTimer) clearTimeout(this.dismissTimer);
    this.dismissTimer = null;
    this.notice.set(null);
  }

  ngOnDestroy(): void {
    this.clear();
  }

  private show(message: string): void {
    if (this.dismissTimer) clearTimeout(this.dismissTimer);
    this.notice.set(message);
    this.dismissTimer = setTimeout(() => {
      this.dismissTimer = null;
      this.notice.set(null);
    }, 3000);
  }
}
