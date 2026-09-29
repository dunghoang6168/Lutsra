import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { LibraryGateway, LibrarySnapshot } from '../contracts/library.gateway';
import { FolderNode, MusicFolder, ScanProgress, Track, TrackDetails } from '../models';
import { getDesktopApi } from './desktop-api';

@Injectable()
export class ElectronLibraryGateway implements LibraryGateway {
  private readonly api = getDesktopApi();
  private readonly progress = new BehaviorSubject<ScanProgress>({ isScanning: false, scannedFiles: 0, audioFiles: 0, currentPath: null });
  readonly scanProgress$ = this.progress.asObservable();
  private readonly changed = new Subject<void>();
  readonly libraryChanged$ = this.changed.asObservable();

  constructor() {
    this.requireApi().library.onScanProgress((value) => {
      const justFinished = this.progress.value.isScanning && !value.isScanning;
      this.progress.next(value);
      if (justFinished) this.changed.next();
    });
  }
  getLibrary(): Promise<LibrarySnapshot> { return this.requireApi().library.getSnapshot(); }
  getTrackById(trackId: string): Promise<Track | null> { return this.requireApi().library.getTrackById(trackId); }
  getFolderTree(folderId: string): Promise<FolderNode | null> { return this.requireApi().library.getFolderTree(folderId); }
  getTrackDetails(trackId: string): Promise<TrackDetails> { return this.requireApi().library.getTrackDetails(trackId); }
  async selectAndAddMusicFolders(): Promise<MusicFolder[]> {
    const added = await this.requireApi().library.selectAndAddFolders();
    if (added.length) {
      this.changed.next();
      await this.requestScan(added.map((folder) => folder.id));
    }
    return added;
  }
  async removeMusicFolder(folderId: string): Promise<void> {
    await this.requireApi().library.removeFolder(folderId);
    this.changed.next();
  }
  requestScan(folderIds?: string[]): Promise<void> { return this.requireApi().library.startScan(folderIds); }

  private requireApi() {
    if (!this.api) throw new Error('Electron desktop API is unavailable');
    return this.api;
  }
}
