import { Injectable, signal } from '@angular/core';

export interface ArtworkGlowBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

@Injectable({ providedIn: 'root' })
export class ArtworkGlowPositionService {
  private readonly boundsState = signal<ArtworkGlowBounds | null>(null);
  readonly bounds = this.boundsState.asReadonly();

  setBounds(bounds: ArtworkGlowBounds): void {
    const previous = this.boundsState();
    if (previous && previous.left === bounds.left && previous.top === bounds.top &&
      previous.width === bounds.width && previous.height === bounds.height) return;
    this.boundsState.set(bounds);
  }

  clear(): void {
    this.boundsState.set(null);
  }
}
