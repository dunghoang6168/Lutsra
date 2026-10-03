import { randomUUID } from 'node:crypto';
import { opendir, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseFile } from 'music-metadata';
import { ScanProgress } from '../../src/app/core/models/index.js';
import { canonicalPath, isPathInside, pathKey, stableId } from '../utils/path-utils.js';
import { ArtworkService } from './artwork.service.js';
import { DatabaseService, StoredTrack } from './database.service.js';
import { log } from '../utils/logger.js';

const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg', '.opus']);
const COVER_NAMES = ['cover', 'folder', 'front'];
const COVER_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

interface ScanTarget {
  folderId: string;
  folderName: string;
  directoryPath: string;
  scoped: boolean;
}

export class ScannerService {
  private scanning = false;
  constructor(private readonly database: DatabaseService, private readonly artwork: ArtworkService, private readonly progress: (value: ScanProgress) => void) {}

  async scan(folderIds?: string[]): Promise<void> {
    const folders = this.database.listFolders().filter((folder) => !folderIds?.length || folderIds.includes(folder.id));
    if (folderIds?.some((id) => !folders.some((folder) => folder.id === id))) throw new Error('Unknown music folder');
    await this.scanTargets(folders.map((folder) => ({ folderId: folder.id, folderName: folder.name, directoryPath: folder.path, scoped: false })));
  }

  async scanDirectory(folderId: string, directoryPath: string): Promise<void> {
    if (this.scanning) throw new Error('A library scan is already running');
    const folder = this.database.getFolder(folderId);
    if (!folder) throw new Error('Unknown music folder');
    const root = await canonicalPath(folder.path);
    const directory = await canonicalPath(directoryPath);
    if (!isPathInside(directory, root)) throw new Error('Folder is outside the music root');
    if (pathKey(directory) === pathKey(root)) return this.scan([folderId]);
    if (!this.database.hasIndexedDirectory(folderId, directory)) throw new Error('Folder is not in the indexed library');
    await this.scanTargets([{ folderId, folderName: path.basename(directory), directoryPath: directory, scoped: true }]);
  }

  private async scanTargets(targets: ScanTarget[]): Promise<void> {
    if (this.scanning) throw new Error('A library scan is already running');
    this.scanning = true;
    let scannedFiles = 0; let audioFiles = 0; let warnings = 0; let lastEmit = 0;
    log('info', 'scan', 'Scan started', { folderCount: targets.length, directory: targets.length === 1 && targets[0].scoped ? targets[0].directoryPath : undefined });
    const emit = (currentPath: string | null, error: string | null = null, force = false) => {
      const now = Date.now(); if (!force && now - lastEmit < 250) return; lastEmit = now;
      this.progress({ isScanning: true, scannedFiles, audioFiles, currentPath, error });
    };
    this.progress({ isScanning: true, scannedFiles: 0, audioFiles: 0, currentPath: targets[0]?.directoryPath ?? null });
    try {
      for (const target of targets) {
        let folderWarnings = 0;
        let traversalWarnings = 0;
        const scanId = randomUUID(); this.database.startScan(scanId, target.folderId);
        try {
          const root = await canonicalPath(target.directoryPath);
          const files: string[] = [];
          const covers = new Map<string, string[]>();
          const directories: Array<{ path: string; parentPath: string | null; name: string }> = [
            { path: root, parentPath: target.scoped ? path.dirname(root) : null, name: target.scoped ? path.basename(root) : target.folderName },
          ];
          await this.walk(root, root, files, covers, directories, () => { scannedFiles++; emit(root); }, () => { warnings++; folderWarnings++; traversalWarnings++; });
          audioFiles += files.length;
          const results = await this.readMetadata(files, covers, target.folderId, scanId, (filePath, warning) => {
            if (warning) { warnings++; folderWarnings++; log('warn', 'metadata', warning); }
            emit(filePath, warning);
          });
          for (let index = 0; index < results.length; index += 100) this.database.upsertTracks(target.folderId, scanId, results.slice(index, index + 100));
          this.database.saveDirectories(target.folderId, scanId, directories);
          // An unreadable descendant must not make its previously indexed tracks appear deleted.
          if (target.scoped) this.database.finishScopedScan(scanId, target.folderId, root, folderWarnings, traversalWarnings === 0);
          else this.database.finishScan(scanId, target.folderId, folderWarnings);
        } catch (error) {
          warnings++; folderWarnings++; this.database.failScan(scanId, folderWarnings);
          log('error', 'scan', `Scan failed for ${target.directoryPath}`, error);
          emit(target.directoryPath, errorMessage(error), true);
        }
      }
    } finally {
      this.scanning = false;
      this.progress({ isScanning: false, scannedFiles, audioFiles, currentPath: null, error: warnings ? `${warnings} file or folder warning(s) occurred` : null });
      log('info', 'scan', 'Scan finished', { scannedFiles, audioFiles, warnings });
    }
  }

  private async walk(root: string, directory: string, files: string[], covers: Map<string, string[]>, directories: Array<{ path: string; parentPath: string | null; name: string }>, onEntry: () => void, onWarning: () => void): Promise<void> {
    let handle;
    try { handle = await opendir(directory); } catch (error) { if (directory === root) throw error; onWarning(); return; }
    for await (const entry of handle) {
      onEntry(); const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        directories.push({ path: entryPath, parentPath: directory, name: entry.name });
        await this.walk(root, entryPath, files, covers, directories, onEntry, onWarning);
      } else if (entry.isFile()) {
        const extension = path.extname(entry.name).toLowerCase();
        if (AUDIO_EXTENSIONS.has(extension)) files.push(entryPath);
        else if (COVER_EXTENSIONS.includes(extension) && COVER_NAMES.includes(entry.name.slice(0, -extension.length).toLowerCase())) {
          const candidates = covers.get(directory) ?? [];
          candidates.push(entryPath);
          covers.set(directory, candidates);
        }
      }
    }
  }

  private async readMetadata(files: string[], covers: Map<string, string[]>, folderId: string, scanId: string, report: (path: string, warning: string | null) => void): Promise<StoredTrack[]> {
    const results: StoredTrack[] = []; let cursor = 0;
    const coverHashes = new Map<string, Promise<string | null>>();
    const folderCover = (directory: string): Promise<string | null> => {
      let pending = coverHashes.get(directory);
      if (!pending) {
        const candidates = (covers.get(directory) ?? []).sort((left, right) => {
          const rank = (filePath: string) => {
            const name = path.basename(filePath);
            const extension = path.extname(name).toLowerCase();
            return COVER_NAMES.indexOf(name.slice(0, -extension.length).toLowerCase()) * COVER_EXTENSIONS.length + COVER_EXTENSIONS.indexOf(extension);
          };
          return rank(left) - rank(right) || left.localeCompare(right);
        });
        pending = (async () => {
          for (const candidate of candidates) {
            try {
              const hash = await this.artwork.saveFolderCover(candidate);
              if (hash) return hash;
            } catch { /* An unreadable cover must not prevent audio import. */ }
          }
          return null;
        })();
        coverHashes.set(directory, pending);
      }
      return pending;
    };
    const worker = async () => {
      while (cursor < files.length) {
        const filePath = files[cursor++];
        try {
          const fileStat = await stat(filePath);
          const existing = this.database.getStoredTrackByPath(filePath);
          if (existing && existing.fileSize === fileStat.size && existing.lastModified === fileStat.mtimeMs) {
            if (existing.artworkSource === 'folder' || existing.artworkSource === 'none') {
              const artworkHash = await folderCover(path.dirname(filePath));
              const artworkSource = artworkHash ? 'folder' : 'none';
              if (existing.artworkHash !== artworkHash || existing.artworkSource !== artworkSource) this.database.updateTrackArtwork(existing.id, artworkHash, artworkSource);
              this.database.markExistingTrackSeen(folderId, scanId, existing); report(filePath, null); continue;
            }
            if (existing.artworkSource === 'embedded') {
              this.database.markExistingTrackSeen(folderId, scanId, existing); report(filePath, null); continue;
            }
          }
          const metadata = await parseFile(filePath, { duration: true, skipCovers: false });
          const embeddedHash = await this.artwork.save(metadata.common.picture?.[0]);
          const artworkHash = embeddedHash ?? await folderCover(path.dirname(filePath));
          const artworkSource = embeddedHash ? 'embedded' : artworkHash ? 'folder' : 'none';
          const common = metadata.common; const format = metadata.format;
          results.push({
            id: stableId('track', pathKey(filePath)), path: filePath, fileName: path.basename(filePath), title: common.title?.trim() || path.parse(filePath).name,
            artist: common.artist?.trim() || null, albumArtist: common.albumartist?.trim() || null, album: common.album?.trim() || null,
            genre: common.genre?.[0]?.trim() || null, year: common.year ?? null, trackNumber: common.track.no ?? null, discNumber: common.disk.no ?? null,
            duration: format.duration ?? 0, codec: format.codec || format.container || null, bitrate: format.bitrate == null ? null : Math.round(format.bitrate),
            sampleRate: format.sampleRate ?? null, bitDepth: format.bitsPerSample ?? null, channels: format.numberOfChannels ?? null,
            artwork: null, artworkHash, artworkSource, fileSize: fileStat.size, lastModified: fileStat.mtimeMs, isAvailable: true,
          });
          report(filePath, null);
        } catch (error) { report(filePath, `Skipped ${path.basename(filePath)}: ${errorMessage(error)}`); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, Math.max(1, files.length)) }, () => worker()));
    return results;
  }
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
