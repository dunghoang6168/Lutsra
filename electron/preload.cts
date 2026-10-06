import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi, NativeAudioHostEvent, NativeMediaKeyAction } from '../src/app/core/desktop/desktop-api';
import type { ArtistMetadataUpdate, AudioHostState, ScanProgress } from '../src/app/core/models';

const api: DesktopApi = {
  runtime: 'electron',
  ping: () => ipcRenderer.invoke('system:ping'),
  appLifecycle: {
    onSuspend: (listener) => {
      const handler = () => listener();
      ipcRenderer.on('system:suspend', handler);
      return () => ipcRenderer.removeListener('system:suspend', handler);
    },
    onResume: (listener) => {
      const handler = () => listener();
      ipcRenderer.on('system:resume', handler);
      return () => ipcRenderer.removeListener('system:resume', handler);
    },
  },
  mediaKeys: {
    setNativeActive: (enabled) => ipcRenderer.invoke('media-keys:set-native-active', enabled),
    onAction: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, action: NativeMediaKeyAction) => listener(action);
      ipcRenderer.on('media-keys:action', handler);
      return () => ipcRenderer.removeListener('media-keys:action', handler);
    },
  },
  audioHost: {
    getState: () => ipcRenderer.invoke('audio-host:get-state'),
    start: () => ipcRenderer.invoke('audio-host:start'),
    load: (trackId) => ipcRenderer.invoke('audio-host:load', trackId),
    play: () => ipcRenderer.invoke('audio-host:play'),
    pause: () => ipcRenderer.invoke('audio-host:pause'),
    seek: (positionSeconds) => ipcRenderer.invoke('audio-host:seek', positionSeconds),
    setVolume: (volume) => ipcRenderer.invoke('audio-host:set-volume', volume),
    setMute: (isMuted) => ipcRenderer.invoke('audio-host:set-mute', isMuted),
    prepare: (trackId) => ipcRenderer.invoke('audio-host:prepare', trackId),
    cancelPrepared: () => ipcRenderer.invoke('audio-host:cancel-prepared'),
    transition: (crossfadeSeconds) => ipcRenderer.invoke('audio-host:transition', crossfadeSeconds),
    listDevices: () => ipcRenderer.invoke('audio-host:list-devices'),
    selectDevice: (deviceId) => ipcRenderer.invoke('audio-host:select-device', deviceId),
    setOutputMode: (mode, bufferMs) => ipcRenderer.invoke('audio-host:set-output-mode', mode, bufferMs),
    setFallbackEnabled: (enabled) => ipcRenderer.invoke('audio-host:set-fallback', enabled),
    getPathStatus: () => ipcRenderer.invoke('audio-host:get-path-status'),
    setSpectrumEnabled: (enabled) => ipcRenderer.invoke('audio-host:set-spectrum', enabled),
    onEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, value: NativeAudioHostEvent) => listener(value);
      ipcRenderer.on('audio-host:event', handler);
      return () => ipcRenderer.removeListener('audio-host:event', handler);
    },
    onStateChange: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, value: AudioHostState) => listener(value);
      ipcRenderer.on('audio-host:state', handler);
      return () => ipcRenderer.removeListener('audio-host:state', handler);
    },
  },
  windowControls: {
    customControls: process.platform === 'win32',
    setTitleBarAppearance: (mode) => ipcRenderer.invoke('window:set-title-bar-appearance', mode),
    getState: () => ipcRenderer.invoke('window:get-state'),
    setSnapButtonBounds: (bounds) => ipcRenderer.invoke('window:set-snap-button-bounds', bounds),
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    onStateChange: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, state: { isMaximized: boolean }) => listener(state);
      ipcRenderer.on('window:state-changed', handler);
      return () => ipcRenderer.removeListener('window:state-changed', handler);
    },
    onSnapHoverChange: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, hovered: boolean) => listener(hovered);
      ipcRenderer.on('window:snap-hover-changed', handler);
      return () => ipcRenderer.removeListener('window:snap-hover-changed', handler);
    },
  },
  library: {
    getSnapshot: () => ipcRenderer.invoke('library:get-snapshot'),
    getTrackById: (trackId) => ipcRenderer.invoke('library:get-track-by-id', trackId),
    getFolderTree: (folderId) => ipcRenderer.invoke('library:get-folder-tree', folderId),
    getTrackDetails: (trackId) => ipcRenderer.invoke('library:get-track-details', trackId),
    getLyrics: (trackId) => ipcRenderer.invoke('library:get-lyrics', trackId),
    findTracksWithLyrics: (trackIds) => ipcRenderer.invoke('library:find-tracks-with-lyrics', trackIds),
    selectAndAddFolders: () => ipcRenderer.invoke('library:select-and-add-folders'),
    removeFolder: (folderId) => ipcRenderer.invoke('library:remove-folder', folderId),
    startScan: (folderIds) => ipcRenderer.invoke('library:start-scan', folderIds),
    startFolderScan: (folderId, directoryPath) => ipcRenderer.invoke('library:scan-directory', folderId, directoryPath),
    onScanProgress: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, value: ScanProgress) => listener(value);
      ipcRenderer.on('library:scan-progress', handler);
      return () => ipcRenderer.removeListener('library:scan-progress', handler);
    },
  },
  artistMetadata: {
    refreshMissing: (force = false) => ipcRenderer.invoke('artist-metadata:refresh-missing', force),
    ensureArtist: (artistId) => ipcRenderer.invoke('artist-metadata:ensure', artistId),
    refreshArtist: (artistId) => ipcRenderer.invoke('artist-metadata:refresh', artistId),
    searchCandidates: (artistName) => ipcRenderer.invoke('artist-metadata:search', artistName),
    setArtistMatch: (artistId, musicBrainzId) => ipcRenderer.invoke('artist-metadata:set-match', artistId, musicBrainzId),
    setWikipediaOverride: (artistId, url) => ipcRenderer.invoke('artist-metadata:set-wikipedia', artistId, url),
    selectCustomAvatar: (artistId) => ipcRenderer.invoke('artist-metadata:select-avatar', artistId),
    clearCustomAvatar: (artistId) => ipcRenderer.invoke('artist-metadata:clear-avatar', artistId),
    openSource: (url) => ipcRenderer.invoke('artist-metadata:open-source', url),
    onUpdated: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, value: ArtistMetadataUpdate) => listener(value);
      ipcRenderer.on('artist-metadata:updated', handler);
      return () => ipcRenderer.removeListener('artist-metadata:updated', handler);
    },
  },
  playlists: {
    list: () => ipcRenderer.invoke('playlists:list'),
    create: (name) => ipcRenderer.invoke('playlists:create', name),
    rename: (id, name) => ipcRenderer.invoke('playlists:rename', id, name),
    delete: (id) => ipcRenderer.invoke('playlists:delete', id),
    addTracks: (playlistId, trackIds) => ipcRenderer.invoke('playlists:add-tracks', playlistId, trackIds),
    removeEntry: (playlistId, entryId) => ipcRenderer.invoke('playlists:remove-entry', playlistId, entryId),
    reorderEntries: (playlistId, entryIds) => ipcRenderer.invoke('playlists:reorder', playlistId, entryIds),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (value) => ipcRenderer.invoke('settings:save', value),
  },
};

contextBridge.exposeInMainWorld('desktop', api);
