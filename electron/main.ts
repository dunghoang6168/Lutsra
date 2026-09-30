import { app, BrowserWindow, Menu, session, type BrowserWindow as BrowserWindowType } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ArtworkService } from './services/artwork.service.js';
import { DatabaseService } from './services/database.service.js';
import { ScannerService } from './services/scanner.service.js';
import { TrackDetailsService } from './services/track-details.service.js';
import { ArtistMetadataService } from './services/artist-metadata.service.js';
import { LyricsService } from './services/lyrics.service.js';
import { migrateLegacyProfile } from './services/profile-migration.service.js';
import { broadcastProgress, registerIpc } from './ipc/register-ipc.js';
import { installProtocolHandlers, registerPrivilegedSchemes } from './protocols/register-protocols.js';

registerPrivilegedSchemes();

const development = process.argv.includes('--dev');
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindowType | null = null;
let database: DatabaseService | null = null;


function createWindow(): void {
  mainWindow = new BrowserWindow({
    name: 'lutsra-main',
    windowStatePersistence: true,
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: true,
    backgroundColor: '#09090b',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#f9fafb', height: 64 },
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(currentDirectory, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, target) => {
    const allowed = target.startsWith('app://lutsra/') || (development && target.startsWith('http://localhost:4200/'));
    if (!allowed) event.preventDefault();
  });
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
  registerIpc(database, scanner, trackDetails, artistMetadata, lyrics, () => mainWindow, development);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  createWindow();

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch((error) => {
  console.error('[bootstrap]', error);
  app.quit();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { database?.close(); database = null; });
