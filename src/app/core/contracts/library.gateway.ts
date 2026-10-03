import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';
import { Track, TrackDetails, Album, Artist, MusicFolder, FolderNode, ScanProgress } from '../models';

export interface LibrarySnapshot {
  tracks: Track[];
  albums: Album[];
  artists: Artist[];
  folders: MusicFolder[];
}

export interface LibraryGateway {
  getLibrary(): Promise<LibrarySnapshot>;
  getTrackById(trackId: string): Promise<Track | null>;
  getFolderTree(folderId: string): Promise<FolderNode | null>;
  getTrackDetails(trackId: string): Promise<TrackDetails>;
  selectAndAddMusicFolders(): Promise<MusicFolder[]>;
  removeMusicFolder(folderId: string): Promise<void>;
  requestScan(folderIds?: string[]): Promise<void>;
  requestFolderScan(folderId: string, directoryPath: string): Promise<void>;
  scanProgress$: Observable<ScanProgress>;
  libraryChanged$: Observable<void>;
}

export const LIBRARY_GATEWAY = new InjectionToken<LibraryGateway>('LIBRARY_GATEWAY');
