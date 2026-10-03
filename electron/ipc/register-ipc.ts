import { dialog, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { MusicFolder, ScanProgress } from '../../src/app/core/models/index.js';
import { canonicalPath, pathsOverlap } from '../utils/path-utils.js';
import { DatabaseService } from '../services/database.service.js';
import { ScannerService } from '../services/scanner.service.js';
import { TrackDetailsService } from '../services/track-details.service.js';
import { ArtistMetadataService } from '../services/artist-metadata.service.js';
import { LyricsService } from '../services/lyrics.service.js';
import { AudioHostService } from '../services/audio-host.service.js';
import { validSettings } from './settings-validation.js';
import { validArtistSourceUrl, validDirectoryPath, validId, validIdArray, validMusicBrainzId, validName, validTitleBarAppearance, validWikipediaOverride } from './ipc-validation.js';
import { updateWindowSnapBounds } from '../window-snap.js';

export function registerIpc(database: DatabaseService, scanner: ScannerService, trackDetails: TrackDetailsService, artistMetadata: ArtistMetadataService, lyrics: LyricsService, audioHost: AudioHostService, getWindow: () => BrowserWindow | null, development: boolean, setNativeMediaKeysActive: (enabled: boolean) => void): void {
  handle('system:ping', () => 'pong', development);
  handle('media-keys:set-native-active', (_event, enabled) => setNativeMediaKeysActive(validBoolean(enabled)), development);
  handle('audio-host:get-state', () => audioHost.getState(), development);
  handle('audio-host:start', () => audioHost.ensureStarted(), development);
  handle('audio-host:load', (_event, trackId) => audioHost.loadTrack(validId(trackId)), development);
  handle('audio-host:play', () => audioHost.play(), development);
  handle('audio-host:pause', () => audioHost.pause(), development);
  handle('audio-host:seek', (_event, seconds) => audioHost.seek(validFiniteNumber(seconds, 0, 60 * 60 * 24)), development);
  handle('audio-host:set-volume', (_event, volume) => audioHost.setVolume(validFiniteNumber(volume, 0, 1)), development);
  handle('audio-host:set-mute', (_event, muted) => audioHost.setMute(validBoolean(muted)), development);
  handle('audio-host:prepare', (_event, trackId) => audioHost.prepareTrack(validId(trackId)), development);
  handle('audio-host:cancel-prepared', () => audioHost.cancelPrepared(), development);
  handle('audio-host:transition', (_event, seconds) => audioHost.transition(validFiniteNumber(seconds, 0, 12)), development);
  handle('audio-host:list-devices', () => audioHost.listDevices(), development);
  handle('audio-host:select-device', (_event, deviceId) => audioHost.selectDevice(validAudioDeviceId(deviceId)), development);
  handle('audio-host:set-fallback', (_event, enabled) => audioHost.setFallbackEnabled(validBoolean(enabled)), development);
  handle('audio-host:get-path-status', () => audioHost.getPathStatus(), development);
  handle('audio-host:set-spectrum', (_event, enabled) => audioHost.setSpectrumEnabled(validBoolean(enabled)), development);
  handle('window:set-title-bar-appearance', (_event, mode) => {
    const appearance = validTitleBarAppearance(mode);
    const window = getWindow();
    if (process.platform === 'win32' || !window || window.isDestroyed()) return;
    window.setTitleBarOverlay({
      color: '#00000000',
      symbolColor: appearance === 'light' ? '#111827' : '#f9fafb',
      height: 64,
    });
  }, development);
  handle('window:get-state', (event) => ({ isMaximized: controlWindow(event, getWindow).isMaximized() }), development);
  handle('window:set-snap-button-bounds', (event, bounds) => updateWindowSnapBounds(controlWindow(event, getWindow), bounds), development);
  handle('window:minimize', (event) => { controlWindow(event, getWindow).minimize(); }, development);
  handle('window:toggle-maximize', (event) => {
    const window = controlWindow(event, getWindow);
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
    return { isMaximized: window.isMaximized() };
  }, development);
  handle('window:close', (event) => {
    const window = controlWindow(event, getWindow);
    setImmediate(() => { if (!window.isDestroyed()) window.close(); });
  }, development);
  handle('library:get-snapshot', () => database.getLibrary(), development);
  handle('library:get-track-by-id', (_event, trackId) => database.getTrackById(validId(trackId)), development);
  handle('library:get-folder-tree', (_event, folderId) => database.getFolderTree(validId(folderId)), development);
  handle('library:get-track-details', (_event, trackId) => trackDetails.get(validId(trackId)), development);
  handle('library:get-lyrics', (_event, trackId) => lyrics.get(validId(trackId)), development);
  handle('library:find-tracks-with-lyrics', (_event, trackIds) => lyrics.findTracksWithLyrics(validIdArray(trackIds)), development);
  handle('library:select-and-add-folders', async () => {
    const window = getWindow();
    const options: Electron.OpenDialogOptions = { properties: ['openDirectory', 'multiSelections'] };
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    if (result.canceled) return [];
    const registered = database.listFolders();
    const added: MusicFolder[] = [];
    for (const selectedPath of result.filePaths) {
      const canonical = await canonicalPath(selectedPath);
      if (registered.some((folder) => pathsOverlap(folder.path, canonical)) || added.some((folder) => pathsOverlap(folder.path, canonical))) continue;
      added.push(database.addFolder(canonical, path.basename(canonical)));
    }
    return added;
  }, development);
  handle('library:remove-folder', (_event, folderId) => database.removeFolder(validId(folderId)), development);
  handle('library:start-scan', (_event, folderIds) => {
    const ids = folderIds === undefined ? undefined : validIdArray(folderIds);
    void scanner.scan(ids).catch((error) => broadcastProgress(getWindow(), { isScanning: false, scannedFiles: 0, audioFiles: 0, currentPath: null, error: errorMessage(error) }));
  }, development);
  handle('library:scan-directory', (_event, folderId, directoryPath) => {
    void scanner.scanDirectory(validId(folderId), validDirectoryPath(directoryPath)).catch((error) => {
      if (errorMessage(error) === 'A library scan is already running') return;
      broadcastProgress(getWindow(), { isScanning: false, scannedFiles: 0, audioFiles: 0, currentPath: null, error: errorMessage(error) });
    });
  }, development);
  handle('artist-metadata:refresh-missing', (_event, force) => artistMetadata.refreshMissing(force === true), development);
  handle('artist-metadata:ensure', (_event, artistId) => artistMetadata.ensureArtist(validId(artistId)), development);
  handle('artist-metadata:refresh', (_event, artistId) => artistMetadata.refreshArtist(validId(artistId)), development);
  handle('artist-metadata:search', (_event, artistName) => artistMetadata.searchCandidates(validName(artistName)), development);
  handle('artist-metadata:set-match', (_event, artistId, mbid) => artistMetadata.setArtistMatch(validId(artistId), validMusicBrainzId(mbid)), development);
  handle('artist-metadata:set-wikipedia', (_event, artistId, url) => artistMetadata.setWikipediaOverride(validId(artistId), validWikipediaOverride(url)), development);
  handle('artist-metadata:select-avatar', async (_event, artistId) => {
    const id = validId(artistId);
    const window = getWindow();
    const options: Electron.OpenDialogOptions = { properties: ['openFile'], filters: [{ name: 'Artist image', extensions: ['jpg', 'jpeg', 'png', 'webp'] }] };
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    return result.canceled || !result.filePaths[0] ? null : artistMetadata.selectCustomAvatar(id, result.filePaths[0]);
  }, development);
  handle('artist-metadata:clear-avatar', (_event, artistId) => artistMetadata.clearCustomAvatar(validId(artistId)), development);
  handle('artist-metadata:open-source', (_event, url) => shell.openExternal(validArtistSourceUrl(url)), development);

  handle('playlists:list', () => database.listPlaylists(), development);
  handle('playlists:create', (_event, name) => database.createPlaylist(validName(name)), development);
  handle('playlists:rename', (_event, id, name) => database.renamePlaylist(validId(id), validName(name)), development);
  handle('playlists:delete', (_event, id) => database.deletePlaylist(validId(id)), development);
  handle('playlists:add-tracks', (_event, id, trackIds) => database.addPlaylistTracks(validId(id), validIdArray(trackIds)), development);
  handle('playlists:remove-entry', (_event, id, entryId) => database.removePlaylistEntry(validId(id), validId(entryId)), development);
  handle('playlists:reorder', (_event, id, entryIds) => database.reorderPlaylist(validId(id), validIdArray(entryIds)), development);
  handle('settings:get', () => database.getSettings(), development);
  handle('settings:save', (_event, value) => database.saveSettings(validSettings(value)), development);
}

export function broadcastProgress(window: BrowserWindow | null, progress: ScanProgress): void {
  if (window && !window.isDestroyed()) window.webContents.send('library:scan-progress', progress);
}

function handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown, development: boolean): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!trustedSender(event, development)) throw new Error('Untrusted IPC sender');
    try { return listener(event, ...args); } catch (error) { console.error(`[ipc:${channel}]`, error); throw error; }
  });
}

function trustedSender(event: IpcMainInvokeEvent, development: boolean): boolean {
  const url = event.senderFrame?.url ?? '';
  return url.startsWith('app://lutsra/') || (development && url.startsWith('http://localhost:4200/'));
}
function controlWindow(event: IpcMainInvokeEvent, getWindow: () => BrowserWindow | null): BrowserWindow {
  const window = getWindow();
  if (process.platform !== 'win32' || !window || window.isDestroyed() || event.sender !== window.webContents) {
    throw new Error('Window controls unavailable');
  }
  return window;
}
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function validFiniteNumber(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) throw new Error('Invalid numeric value');
  return value;
}
function validBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Invalid boolean value');
  return value;
}
function validAudioDeviceId(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 512 || /[\u0000-\u001f]/.test(value)) throw new Error('Invalid audio device ID');
  return value;
}
