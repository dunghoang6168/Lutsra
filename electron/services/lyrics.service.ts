import { open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseService } from './database.service.js';
import { isPathInside } from '../utils/path-utils.js';

const MAX_LRC_BYTES = 1024 * 1024;

export class LyricsService {
  constructor(private readonly database: DatabaseService) {}

  async findTracksWithLyrics(trackIds: string[]): Promise<string[]> {
    const roots = this.database.listFolders().map((folder) => folder.path);
    const found: string[] = [];
    for (let offset = 0; offset < trackIds.length; offset += 32) {
      const batch = await Promise.all(trackIds.slice(offset, offset + 32).map(async (id) => {
        const track = this.database.resolveTrack(id);
        if (!track) return null;
        try {
          const audioPath = await realpath(track.path);
          if (!roots.some((root) => isPathInside(audioPath, root))) return null;
          const parsed = path.parse(audioPath);
          const lyricPath = await realpath(path.join(parsed.dir, `${parsed.name}.lrc`));
          if (!roots.some((root) => isPathInside(lyricPath, root))) return null;
          return (await stat(lyricPath)).isFile() ? id : null;
        } catch {
          return null;
        }
      }));
      found.push(...batch.filter((id): id is string => id !== null));
    }
    return found;
  }

  async get(trackId: string): Promise<string | null> {
    const track = this.database.resolveTrack(trackId);
    if (!track) return null;
    const roots = this.database.listFolders().map((folder) => folder.path);
    let audioPath: string;
    try { audioPath = await realpath(track.path); }
    catch (error) { if (isMissing(error)) return null; throw error; }
    if (!roots.some((root) => isPathInside(audioPath, root))) throw new Error('Track is outside registered music folders');

    const parsed = path.parse(audioPath);
    const lyricPath = path.join(parsed.dir, `${parsed.name}.lrc`);
    let canonicalLyricPath: string;
    try { canonicalLyricPath = await realpath(lyricPath); }
    catch (error) { if (isMissing(error)) return null; throw error; }
    if (!roots.some((root) => isPathInside(canonicalLyricPath, root))) throw new Error('Lyrics are outside registered music folders');

    const file = await open(canonicalLyricPath, 'r');
    try {
      const size = (await file.stat()).size;
      if (size > MAX_LRC_BYTES) throw new Error('Lyrics file is too large');
      const buffer = Buffer.alloc(size);
      let offset = 0;
      while (offset < size) {
        const { bytesRead } = await file.read(buffer, offset, size - offset, offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      if (offset !== size) throw new Error('Lyrics file changed while reading');
      return decodeLyrics(buffer);
    } finally { await file.close(); }
  }
}

function decodeLyrics(buffer: Buffer): string {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return new TextDecoder('utf-16le', { fatal: true }).decode(buffer.subarray(2));
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return new TextDecoder('utf-16be', { fatal: true }).decode(buffer.subarray(2));
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}
