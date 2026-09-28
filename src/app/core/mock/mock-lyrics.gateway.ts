import { LyricsGateway } from '../contracts';

export class MockLyricsGateway implements LyricsGateway {
  async getLyrics(_trackId: string): Promise<string | null> {
    return '[ar:Lutsra]\n[00:00.00]A quiet moment before the music\n[00:08.00]Every note has a place to go\n[00:16.00]Follow the sound and let it flow\n[00:24.00]The story carries on';
  }

  async findTracksWithLyrics(trackIds: string[]): Promise<string[]> {
    return trackIds;
  }
}
