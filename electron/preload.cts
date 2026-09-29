import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi } from '../src/app/core/desktop/desktop-api';
import type { ArtistMetadataUpdate, ScanProgress } from '../src/app/core/models';

const api: DesktopApi = {
  runtime: 'electron',
  ping: () => ipcRenderer.invoke('system:ping'),
  windowControls: {
    setTitleBarAppearance: (mode) => ipcRenderer.invoke('window:set-title-bar-appearance', mode),
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
