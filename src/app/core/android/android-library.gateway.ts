import { Injectable } from '@angular/core';
import { registerPlugin } from '@capacitor/core';
import { BehaviorSubject } from 'rxjs';
import { LibraryGateway, LibrarySnapshot } from '../contracts/library.gateway';
import { Album, Artist, FolderNode, MusicFolder, ScanProgress, Track, TrackDetails } from '../models';

export interface MediaStoreTrack {
  id: string;
  uri: string;
  fileName: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  durationMs: number | null;
  mimeType: string | null;
  fileSize: number | null;
  lastModified: number | null;
  trackNumber: number | null;
  year: number | null;
  relativePath: string | null;
}

interface AndroidFolder extends MusicFolder { available: boolean }

interface NativeFoldersPlugin {
  choose(): Promise<{ folders: AndroidFolder[] }>;
  list(): Promise<{ folders: AndroidFolder[] }>;
  remove(options: { id: string }): Promise<void>;
  scan(): Promise<{ tracks: MediaStoreTrack[] }>;
}

const nativeFolders = registerPlugin<NativeFoldersPlugin>('AndroidFolders');

function known(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed !== '<unknown>' ? trimmed : null;
}

function codecFor(mime: string | null, name: string): string | null {
  const extension = name.split('.').pop()?.toLowerCase();
  if (extension === 'flac' || mime === 'audio/flac') return 'FLAC';
  if (extension === 'wav' || mime === 'audio/wav' || mime === 'audio/x-wav') return 'WAV';
  if (extension === 'mp3' || mime === 'audio/mpeg') return 'MP3';
  return extension?.toUpperCase() || null;
}

function toTrack(row: MediaStoreTrack): Track {
  const fileName = known(row.fileName) || row.id.split('/').pop() || 'Unknown audio';
  const title = known(row.title) || fileName.replace(/\.[^.]+$/, '');
  const packedTrack = row.trackNumber ?? 0;
  const trackNumber = packedTrack > 0 ? packedTrack % 1000 || null : null;
  const discNumber = packedTrack >= 1000 ? Math.floor(packedTrack / 1000) : null;
  return {
    id: row.id, path: row.uri, fileName, title,
    artist: known(row.artist), albumArtist: null, album: known(row.album),
    genre: null, year: row.year && row.year > 0 ? row.year : null,
    trackNumber, discNumber, duration: Math.max(0, (row.durationMs || 0) / 1000),
    codec: codecFor(row.mimeType, fileName), bitrate: null, sampleRate: null,
    bitDepth: null, channels: null, artwork: null, fileSize: row.fileSize,
    lastModified: row.lastModified, isAvailable: true,
  };
}

export function snapshotFrom(rows: MediaStoreTrack[], folders: MusicFolder[] = []): LibrarySnapshot {
  const tracks = [...new Map(rows.map(row => [row.id, toTrack(row)])).values()];
  const albumMap = new Map<string, Album>();
  const artistMap = new Map<string, Artist>();
  for (const track of tracks) {
    const artistName = track.artist || 'Unknown Artist';
    const artistId = `android:artist:${artistName.toLocaleLowerCase()}`;
    let artist = artistMap.get(artistId);
    if (!artist) {
      artist = { id: artistId, name: artistName, albumIds: [], trackIds: [], onlineMetadata: null, customAvatar: null };
      artistMap.set(artistId, artist);
    }
    artist.trackIds.push(track.id);
    if (track.album) {
      const albumId = `android:album:${artistId}:${track.album.toLocaleLowerCase()}`;
      let album = albumMap.get(albumId);
      if (!album) {
        album = { id: albumId, title: track.album, artist: track.artist, year: track.year, artwork: null, trackIds: [] };
        albumMap.set(albumId, album);
        artist.albumIds.push(albumId);
      }
      album.trackIds.push(track.id);
    }
  }
  return { tracks, albums: [...albumMap.values()], artists: [...artistMap.values()], folders };
}

@Injectable({ providedIn: 'root' })
export class AndroidLibraryGateway implements LibraryGateway {
  private snapshot: LibrarySnapshot = snapshotFrom([]);
  private rows: MediaStoreTrack[] = [];
  private loaded = false;
  private readonly progress = new BehaviorSubject<ScanProgress>({
    isScanning: false, scannedFiles: 0, audioFiles: 0, currentPath: null,
  });
  readonly scanProgress$ = this.progress.asObservable();

  async getLibrary(): Promise<LibrarySnapshot> {
    if (!this.loaded) await this.requestScan();
    return this.snapshot;
  }

  async requestScan(folderIds?: string[]): Promise<void> {
    if (this.progress.value.isScanning) return;
    const folders = (await nativeFolders.list()).folders;
    if (folderIds?.length && folderIds.some(id => !folders.some(folder => folder.id === id))) {
      throw new Error('Unknown Android folder');
    }
    this.progress.next({ isScanning: true, scannedFiles: 0, audioFiles: 0, currentPath: folders[0]?.path || null });
    try {
      const result = await nativeFolders.scan();
      this.rows = result.tracks;
      this.snapshot = snapshotFrom(result.tracks, folders);
      this.loaded = true;
      const count = this.snapshot.tracks.length;
      this.progress.next({ isScanning: false, scannedFiles: count, audioFiles: count, currentPath: null });
    } catch (error) {
      const message = String(error);
      this.progress.next({ isScanning: false, scannedFiles: 0, audioFiles: 0, currentPath: null, error: message });
      throw error;
    }
  }

  async getFolderTree(folderId: string): Promise<FolderNode | null> {
    const folder = this.snapshot.folders.find(item => item.id === folderId);
    if (!folder) return null;
    const root: FolderNode = {
      id: folderId, name: folder.name, path: folder.path, isFolder: true,
      children: [],
    };
    const rootDocumentId = decodeURIComponent(folderId.split('/tree/')[1] || '');
    for (const row of this.rows) {
      if (!row.uri.startsWith(`${folderId}/document/`)) continue;
      const track = this.snapshot.tracks.find(item => item.id === row.id);
      if (!track) continue;
      let node = root;
      const relative = row.relativePath?.startsWith(rootDocumentId)
        ? row.relativePath.slice(rootDocumentId.length).replace(/^\//, '') : '';
      const parts = relative.split('/').filter(Boolean);
      for (const part of parts.slice(0, -1)) {
        let child = node.children?.find(item => item.isFolder && item.name === part);
        if (!child) {
          child = { id: `${node.id}/${part}`, name: part, path: `${node.path}/${part}`, isFolder: true, children: [] };
          node.children!.push(child);
        }
        node = child;
      }
      node.children!.push({ id: track.id, name: track.fileName, path: track.path, isFolder: false, trackId: track.id });
    }
    return root;
  }

  async getTrackDetails(trackId: string): Promise<TrackDetails> {
    const track = this.snapshot.tracks.find(item => item.id === trackId);
    if (!track) throw new Error('Track not found or unavailable');
    return {
      trackId,
      metadata: {
        title: track.title, artists: track.artist ? [track.artist] : [], album: track.album,
        albumArtists: [], date: track.year ? String(track.year) : null, year: track.year,
        composers: [], genres: [], trackNumber: track.trackNumber, totalTracks: null,
        discNumber: track.discNumber, totalDiscs: null,
      },
      audio: {
        duration: track.duration, numberOfSamples: null, sampleRate: null, channels: null,
        bitsPerSample: null, bitrate: null, codec: track.codec, codecProfile: null,
        container: null, lossless: null, encoderTool: null, tagTypes: [], audioMd5: null,
      },
      file: {
        fileName: track.fileName, path: track.path, fileSize: track.fileSize,
        lastModified: track.lastModified,
      },
    };
  }

  async selectAndAddMusicFolders(): Promise<MusicFolder[]> {
    const before = new Set((await nativeFolders.list()).folders.map(folder => folder.id));
    const { folders } = await nativeFolders.choose();
    await this.requestScan();
    return folders.filter(folder => !before.has(folder.id));
  }

  async removeMusicFolder(folderId: string): Promise<void> {
    await nativeFolders.remove({ id: folderId });
    await this.requestScan();
  }
}
