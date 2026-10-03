import { LibrarySnapshot } from '../contracts/library.gateway';
import { AudioHostState, AudioOutputDevice, AudioPathStatus, ArtistMatchCandidate, ArtistMetadataUpdate, ArtistOnlineMetadata, FolderNode, MusicFolder, PlaybackError, PlaybackState, PlaybackTimeEvent, PlaybackVolumeEvent, Playlist, ScanProgress, Settings, Track, TrackDetails } from '../models';

export type NativeAudioHostEvent =
  | { kind: 'state'; value: { state: PlaybackState; trackId?: string; error?: PlaybackError } }
  | { kind: 'time'; value: PlaybackTimeEvent }
  | { kind: 'volume'; value: PlaybackVolumeEvent }
  | { kind: 'devices-changed' }
  | { kind: 'spectrum'; bins: number[] };

export type NativeMediaKeyAction = 'play-pause' | 'previous' | 'next' | 'stop';

export interface DesktopApi {
  readonly runtime: 'electron';
  ping(): Promise<'pong'>;
  appLifecycle: {
    onSuspend(listener: () => void): () => void;
    onResume(listener: () => void): () => void;
  };
  mediaKeys: {
    setNativeActive(enabled: boolean): Promise<void>;
    onAction(listener: (action: NativeMediaKeyAction) => void): () => void;
  };
  audioHost: {
    getState(): Promise<AudioHostState>;
    start(): Promise<void>;
    load(trackId: string): Promise<void>;
    play(): Promise<void>;
    pause(): Promise<void>;
    seek(positionSeconds: number): Promise<void>;
    setVolume(volume: number): Promise<void>;
    setMute(isMuted: boolean): Promise<void>;
    prepare(trackId: string): Promise<boolean>;
    cancelPrepared(): Promise<void>;
    transition(crossfadeSeconds: number): Promise<boolean>;
    listDevices(): Promise<AudioOutputDevice[]>;
    selectDevice(deviceId: string): Promise<void>;
    setFallbackEnabled(enabled: boolean): Promise<void>;
    getPathStatus(): Promise<AudioPathStatus>;
    setSpectrumEnabled(enabled: boolean): Promise<void>;
    onEvent(listener: (event: NativeAudioHostEvent) => void): () => void;
    onStateChange(listener: (state: AudioHostState) => void): () => void;
  };
  windowControls: {
    readonly customControls: boolean;
    setTitleBarAppearance(mode: 'light' | 'dark'): Promise<void>;
    getState(): Promise<{ isMaximized: boolean }>;
    setSnapButtonBounds(bounds: { x: number; y: number; width: number; height: number }): Promise<boolean>;
    minimize(): Promise<void>;
    toggleMaximize(): Promise<{ isMaximized: boolean }>;
    close(): Promise<void>;
    onStateChange(listener: (state: { isMaximized: boolean }) => void): () => void;
    onSnapHoverChange(listener: (hovered: boolean) => void): () => void;
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
    startFolderScan(folderId: string, directoryPath: string): Promise<void>;
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
