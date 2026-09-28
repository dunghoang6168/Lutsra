import { LyricsGateway } from '../contracts';
import { getDesktopApi } from './desktop-api';

export class ElectronLyricsGateway implements LyricsGateway {
  getLyrics(trackId: string): Promise<string | null> {
    const api = getDesktopApi();
    if (!api) return Promise.reject(new Error('Electron desktop API is unavailable'));
    return api.library.getLyrics(trackId);
  }

  findTracksWithLyrics(trackIds: string[]): Promise<string[]> {
    const api = getDesktopApi();
    if (!api) return Promise.reject(new Error('Electron desktop API is unavailable'));
    return api.library.findTracksWithLyrics(trackIds);
  }
}
