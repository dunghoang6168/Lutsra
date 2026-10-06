import { signal } from '@angular/core';

/** Pointer position as a 0..1 fraction of the timeline, or null when it has no width. */
export function timelineFraction(clientX: number, rect: Pick<DOMRect, 'left' | 'width'>): number | null {
  if (rect.width <= 0) return null;
  return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
}

/**
 * Dragging only previews a position; the gesture commits exactly one seek on release.
 * Seeking on pointerdown and again on pointerup replays the audio heard in between.
 */
export class TimelineScrub {
  readonly time = signal<number | null>(null);

  get active(): boolean { return this.time() !== null; }

  preview(time: number): void { this.time.set(time); }

  /** Returns the time to seek to once, then clears the preview. */
  end(): number | null {
    const time = this.time();
    this.time.set(null);
    return time;
  }

  cancel(): void { this.time.set(null); }
}
