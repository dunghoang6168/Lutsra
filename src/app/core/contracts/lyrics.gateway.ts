import { InjectionToken } from '@angular/core';

export interface LyricsGateway {
  getLyrics(trackId: string): Promise<string | null>;
  findTracksWithLyrics(trackIds: string[]): Promise<string[]>;
}

export const LYRICS_GATEWAY = new InjectionToken<LyricsGateway>('LYRICS_GATEWAY');
