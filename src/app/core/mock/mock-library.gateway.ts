import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { LibraryGateway, LibrarySnapshot } from '../contracts/library.gateway';
import { FolderNode, MusicFolder, ScanProgress, Track, TrackDetails } from '../models';
import { MOCK_ALBUMS, MOCK_ARTISTS, MOCK_FOLDERS, MOCK_FOLDER_TREES, MOCK_TRACKS } from './fixtures/mock-data';

@Injectable({ providedIn: 'root' })
export class MockLibraryGateway implements LibraryGateway {
  private tracks = [...MOCK_TRACKS];
  private albums = [...MOCK_ALBUMS];
  private artists = [...MOCK_ARTISTS];
  private folders = [...MOCK_FOLDERS];

  private readonly scanProgressSubject = new BehaviorSubject<ScanProgress>({
    isScanning: false,
    scannedFiles: 0,
    audioFiles: 0,
    currentPath: null,
  });

  readonly scanProgress$: Observable<ScanProgress> = this.scanProgressSubject.asObservable();
  private readonly changed = new Subject<void>();
  readonly libraryChanged$ = this.changed.asObservable();

  async getLibrary(): Promise<LibrarySnapshot> {
    await new Promise((resolve) => setTimeout(resolve, 40));
    return {
      tracks: [...this.tracks],
      albums: [...this.albums],
      artists: [...this.artists],
      folders: [...this.folders],
    };
  }

  async getTrackById(trackId: string): Promise<Track | null> {
    return this.tracks.find((track) => track.id === trackId) ?? null;
  }

  async getFolderTree(folderId: string): Promise<FolderNode | null> {
    await new Promise((resolve) => setTimeout(resolve, 30));
    return MOCK_FOLDER_TREES[folderId] ? JSON.parse(JSON.stringify(MOCK_FOLDER_TREES[folderId])) : null;
  }

  async getTrackDetails(trackId: string): Promise<TrackDetails> {
    await new Promise((resolve) => setTimeout(resolve, 120));
    const track = this.tracks.find((item) => item.id === trackId);
    if (!track || !track.isAvailable) throw new Error('Track not found or unavailable');
    return {
      trackId: track.id,
      metadata: {
        title: track.title || null,
        artists: track.artist ? [track.artist] : [],
        album: track.album,
        albumArtists: track.albumArtist ? [track.albumArtist] : [],
        date: track.year ? String(track.year) : null,
        year: track.year,
        composers: track.artist ? [`${track.artist} Composer`] : [],
        genres: track.genre ? [track.genre] : [],
        trackNumber: track.trackNumber,
        totalTracks: track.album ? this.tracks.filter((item) => item.album === track.album).length : null,
        discNumber: track.discNumber,
        totalDiscs: track.discNumber,
      },
      audio: {
        duration: track.duration,
        numberOfSamples: track.sampleRate ? Math.round(track.duration * track.sampleRate) : null,
        sampleRate: track.sampleRate,
        channels: track.channels,
        bitsPerSample: track.bitDepth,
        bitrate: track.bitrate,
        codec: track.codec,
        codecProfile: null,
        container: track.codec,
        lossless: track.codec ? ['FLAC', 'WAV'].includes(track.codec.toUpperCase()) : null,
        encoderTool: 'Lutsra mock metadata',
        tagTypes: track.codec?.toUpperCase() === 'FLAC' ? ['vorbis'] : ['ID3v2.4'],
        audioMd5: track.codec?.toUpperCase() === 'FLAC' ? '0123456789ABCDEFFEDCBA9876543210' : null,
      },
      file: {
        fileName: track.fileName,
        path: track.path,
        fileSize: track.fileSize,
        lastModified: track.lastModified,
      },
    };
  }

  async selectAndAddMusicFolders(): Promise<MusicFolder[]> {
    await new Promise((resolve) => setTimeout(resolve, 150));
    const paths = ['D:\\Music\\Hi-Res Collection\\Vinyl Rips', 'D:\\Music\\Soundtracks'];
    const added: MusicFolder[] = [];
    for (const path of paths) {
      if (this.folders.some((folder) => folder.path === path)) continue;
      const name = path.split('\\').pop() || 'New Folder';
      const folder: MusicFolder = { id: `folder-${Date.now()}-${added.length}`, name, path, addedAt: Date.now() };
      this.folders.push(folder);
      MOCK_FOLDER_TREES[folder.id] = { id: `node-root-${folder.id}`, name, path, isFolder: true, children: [] };
      added.push(folder);
    }
    if (added.length) {
      this.changed.next();
      void this.requestScan(added.map((folder) => folder.id));
    }
    return added;
  }

  async removeMusicFolder(folderId: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 80));
    this.folders = this.folders.filter((f) => f.id !== folderId);
    this.changed.next();
  }

  async requestScan(folderIds?: string[]): Promise<void> {
    if (this.scanProgressSubject.value.isScanning) {
      return;
    }

    const paths = folderIds && folderIds.length > 0
      ? folderIds.map((id) => this.folders.find((folder) => folder.id === id)?.path).filter((path): path is string => Boolean(path))
      : this.folders.map((f) => f.path);
    const basePath = paths[0] || 'D:\\Music';

    this.scanProgressSubject.next({
      isScanning: true,
      scannedFiles: 14,
      audioFiles: 9,
      currentPath: basePath,
    });

    const subDirs = ['Aimer', 'Classical\\Beethoven', 'Daft Punk', 'Vũ', 'Demos\\Corrupted_Check'];

    for (let i = 0; i < subDirs.length; i++) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const isCorruptedCheck = subDirs[i].includes('Corrupted');

      this.scanProgressSubject.next({
        isScanning: true,
        scannedFiles: 35 + i * 28,
        audioFiles: 22 + i * 19,
        currentPath: `${basePath}\\${subDirs[i]}`,
        error: isCorruptedCheck ? 'Warning: 1 corrupted file skipped in Demos' : null,
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 200));

    this.scanProgressSubject.next({
      isScanning: false,
      scannedFiles: 175,
      audioFiles: 125,
      currentPath: null,
      error: null,
    });
    this.changed.next();
  }
}
