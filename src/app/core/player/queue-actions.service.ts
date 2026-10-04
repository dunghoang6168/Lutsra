import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { Track } from '../models';
import { PlayerService, QueueAddResult } from './player.service';

export interface QueueNotice {
  message: string;
  action?: { label: string; run: () => void };
}

@Injectable({ providedIn: 'root' })
export class QueueActionsService implements OnDestroy {
  private readonly player = inject(PlayerService);
  private dismissTimer: ReturnType<typeof setTimeout> | null = null;

  readonly notice = signal<QueueNotice | null>(null);

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

  clearWithUndo(): void {
    if (!this.player.queue().length) return;
    const snapshot = this.player.snapshotQueue();
    this.player.clearQueue();
    const notice = this.show('Queue cleared', {
      label: 'Undo',
      run: () => {
        if (this.notice() !== notice) return;
        this.clear();
        // A new queue started after clearing must not be replaced by an old Undo.
        if (this.player.queue().length) return;
        void this.player.restoreQueue(snapshot);
      },
    });
  }

  ngOnDestroy(): void {
    this.clear();
  }

  private show(message: string, action?: QueueNotice['action']): QueueNotice {
    if (this.dismissTimer) clearTimeout(this.dismissTimer);
    const notice = { message, action };
    this.notice.set(notice);
    this.dismissTimer = setTimeout(() => {
      this.dismissTimer = null;
      this.notice.set(null);
    }, action ? 6000 : 3000);
    return notice;
  }
}
