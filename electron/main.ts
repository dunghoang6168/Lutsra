import { app, BrowserWindow, globalShortcut, Menu, powerMonitor, session, type BrowserWindow as BrowserWindowType } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ArtworkService } from './services/artwork.service.js';
import { DatabaseService } from './services/database.service.js';
import { ScannerService } from './services/scanner.service.js';
import { TrackDetailsService } from './services/track-details.service.js';
import { ArtistMetadataService } from './services/artist-metadata.service.js';
import { LyricsService } from './services/lyrics.service.js';
import { AudioHostService } from './services/audio-host.service.js';
import { migrateLegacyProfile } from './services/profile-migration.service.js';
import { broadcastProgress, registerIpc } from './ipc/register-ipc.js';
import { installProtocolHandlers, registerPrivilegedSchemes } from './protocols/register-protocols.js';
import { installWindowSnap } from './window-snap.js';

registerPrivilegedSchemes();

const development = process.argv.includes('--dev');
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindowType | null = null;
let database: DatabaseService | null = null;
let audioHost: AudioHostService | null = null;
const nativeMediaAccelerators = new Map([
  ['MediaPlayPause', 'play-pause'],
  ['MediaPreviousTrack', 'previous'],
  ['MediaNextTrack', 'next'],
  ['MediaStop', 'stop'],
] as const);


function createWindow(): void {
  const usesNativeAcrylic = process.platform === 'win32';

  mainWindow = new BrowserWindow({
    name: 'lutsra-main',
    windowStatePersistence: true,
    width: 1280,
    height: 800,
    minWidth: 500,
    minHeight: 420,
    show: true,
    backgroundColor: usesNativeAcrylic ? '#00000000' : '#eaf0f3',
    ...(usesNativeAcrylic ? {
      backgroundMaterial: 'acrylic' as const,
      roundedCorners: true,
    } : {}),
    titleBarStyle: 'hidden',
    ...(process.platform === 'win32' ? {} : {
      titleBarOverlay: { color: '#00000000', symbolColor: '#f9fafb', height: 64 },
    }),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(currentDirectory, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      transparent: usesNativeAcrylic,
    },
  });
  installWindowSnap(mainWindow);

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, target) => {
    const allowed = target.startsWith('app://lutsra/') || (development && target.startsWith('http://localhost:4200/'));
    if (!allowed) event.preventDefault();
  });
  const window = mainWindow;
  const broadcastWindowState = () => {
    if (!window.isDestroyed()) window.webContents.send('window:state-changed', { isMaximized: window.isMaximized() });
  };
  window.on('maximize', broadcastWindowState);
  window.on('unmaximize', broadcastWindowState);
  window.on('restore', broadcastWindowState);
  mainWindow.on('closed', () => { mainWindow = null; });

  if (development) void mainWindow.loadURL('http://localhost:4200/');
  else void mainWindow.loadURL('app://lutsra/index.html');
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  const userData = app.getPath('userData');
  const migratedFrom = await migrateLegacyProfile(userData, app.getPath('appData'));
  if (migratedFrom) console.info('[profile] Migrated legacy library from', migratedFrom);
  database = new DatabaseService(path.join(userData, 'lutsra.sqlite'));
  const artwork = new ArtworkService(path.join(userData, 'artwork-cache'), database);
  const scanner = new ScannerService(database, artwork, (progress) => broadcastProgress(mainWindow, progress));
  const trackDetails = new TrackDetailsService(database);
  const lyrics = new LyricsService(database);
  const artistMetadata = new ArtistMetadataService(database, artwork, (update) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('artist-metadata:updated', update);
  });
  const rendererRoot = path.join(app.getAppPath(), 'dist', 'lutsra', 'browser');

  installProtocolHandlers(database, rendererRoot, development);
  audioHost = new AudioHostService(database, () => mainWindow);
  registerIpc(database, scanner, trackDetails, artistMetadata, lyrics, audioHost, () => mainWindow, development, setNativeMediaKeysActive);
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(permission === 'speaker-selection'
      && webContents === mainWindow?.webContents
      && trustedRendererUrl(details.requestingUrl));
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (permission !== 'speaker-selection') return false;
    const trustedOrigin = [requestingOrigin, details.requestingUrl, details.securityOrigin]
      .some((value) => trustedRendererUrl(value));
    return trustedOrigin && (webContents === null || webContents === mainWindow?.webContents);
  });
  createWindow();
  powerMonitor.on('suspend', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('system:suspend');
  });
  powerMonitor.on('resume', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('system:resume');
  });

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch((error) => {
  console.error('[bootstrap]', error);
  app.quit();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  setNativeMediaKeysActive(false);
  void audioHost?.stop();
  audioHost = null;
  database?.close();
  database = null;
});

function setNativeMediaKeysActive(enabled: boolean): void {
  if (process.platform !== 'win32') return;
  for (const [accelerator, action] of nativeMediaAccelerators) {
    if (enabled) {
      if (!globalShortcut.isRegistered(accelerator)) {
        globalShortcut.register(accelerator, () => {
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('media-keys:action', action);
        });
      }
    } else if (globalShortcut.isRegistered(accelerator)) {
      globalShortcut.unregister(accelerator);
    }
  }
}

function trustedRendererUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'app:' && url.hostname === 'lutsra')
      || (development && url.origin === 'http://localhost:4200');
  } catch {
    return false;
  }
}
