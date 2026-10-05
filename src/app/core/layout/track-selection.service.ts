import { Injectable, signal } from '@angular/core';
import type { Track } from '../models';

/** The track the user last selected in a list; the Console inspector follows it. */
@Injectable({ providedIn: 'root' })
export class TrackSelectionService {
  readonly selected = signal<Track | null>(null);
}
