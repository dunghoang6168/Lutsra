import { LibrarySnapshot } from '../contracts/library.gateway';
import { ArtistMatchCandidate, ArtistMetadataUpdate, ArtistOnlineMetadata, FolderNode, MusicFolder, Playlist, ScanProgress, Settings, Track, TrackDetails } from '../models';

export interface DesktopApi {
  readonly runtime: 'electron';
  ping(): Promise<'pong'>;
  windowControls: {
    setTitleBarAppearance(mode: 'light' | 'dark'): Promise<void>;
  };
  library: {
    getSnapshot(): Promise<LibrarySnapshot>;
    getTrackById(trackId: string): Promise<Track | null>;
    getFolderTree(folderId: string): Promise<FolderNode | null>;
    getTrackDetails(trackId: string): Promise<TrackDetails>;
    getLyrics(trackId: string): Promise<string | null>;
    findTracksWithLyrics(trackIds: string[]): Promise<string[]>;
    selectAndAddFolders(): Promise<MusicFolder[]>;
    removeFolder(folderId: string): Promise<void>;
    startScan(folderIds?: string[]): Promise<void>;
    onScanProgress(listener: (progress: ScanProgress) => void): () => void;
  };
  artistMetadata: {
    refreshMissing(force?: boolean): Promise<void>;
    ensureArtist(artistId: string): Promise<void>;
    refreshArtist(artistId: string): Promise<ArtistOnlineMetadata | null>;
    searchCandidates(artistName: string): Promise<ArtistMatchCandidate[]>;
    setArtistMatch(artistId: string, musicBrainzId: string): Promise<ArtistOnlineMetadata | null>;
    setWikipediaOverride(artistId: string, url: string | null): Promise<ArtistOnlineMetadata | null>;
    selectCustomAvatar(artistId: string): Promise<string | null>;
    clearCustomAvatar(artistId: string): Promise<void>;
    openSource(url: string): Promise<void>;
    onUpdated(listener: (update: ArtistMetadataUpdate) => void): () => void;
  };
  playlists: {
    list(): Promise<Playlist[]>;
    create(name: string): Promise<Playlist>;
    rename(id: string, name: string): Promise<Playlist>;
    delete(id: string): Promise<void>;
    addTracks(playlistId: string, trackIds: string[]): Promise<Playlist>;
    removeEntry(playlistId: string, entryId: string): Promise<Playlist>;
    reorderEntries(playlistId: string, entryIds: string[]): Promise<Playlist>;
  };
  settings: {
    get(): Promise<Settings>;
    save(value: Partial<Settings>): Promise<Settings>;
  };
}

export function getDesktopApi(): DesktopApi | undefined {
  return typeof window !== 'undefined' ? window.desktop : undefined;
}
