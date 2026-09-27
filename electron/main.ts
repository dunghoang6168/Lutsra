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
const smokeTest = process.argv.includes('--smoke');
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindowType | null = null;
let database: DatabaseService | null = null;

if (smokeTest) {
  const smokeUserData = process.env['LUTSRA_SMOKE_USER_DATA'];
  if (!smokeUserData) throw new Error('Smoke test userData path was not provided by the launcher');
  app.setPath('userData', smokeUserData);
}

function createWindow(smokeArtworkUrl?: string): void {
  mainWindow = new BrowserWindow({
    name: 'lutsra-main',
    windowStatePersistence: true,
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: !smokeTest,
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

  if (smokeTest) {
    mainWindow.webContents.once('did-finish-load', () => {
      const timeout = setTimeout(() => {
        console.error('[smoke] Timed out waiting for renderer IPC');
        app.exit(1);
      }, 5000);
      mainWindow?.webContents.on('page-title-updated', (_event, title) => {
        if (!title.startsWith('smoke:')) return;
        clearTimeout(timeout);
        const [pong, trackCount, artworkResult] = title.slice(6).split(':');
        if (pong !== 'pong' || artworkResult !== 'ok') {
          console.error('[smoke] IPC or artwork Canvas check failed', { pong, artworkResult });
          app.exit(1);
          return;
        }
        console.info('[smoke]', { pong, trackCount: Number(trackCount), artworkResult });
        app.quit();
      });
      void mainWindow?.webContents.executeJavaScript(`Promise.all([
        window.desktop.ping(),
        window.desktop.library.getSnapshot(),
        new Promise((resolve) => {
          const image = new Image();
          image.crossOrigin = 'anonymous';
          image.onload = () => {
            try {
              const canvas = document.createElement('canvas');
              canvas.width = canvas.height = 1;
              const context = canvas.getContext('2d');
              if (!context) throw new Error('Canvas 2D is unavailable');
              context.drawImage(image, 0, 0, 1, 1);
              context.getImageData(0, 0, 1, 1);
              resolve('ok');
            } catch { resolve('failed'); }
          };
          image.onerror = () => resolve('failed');
          image.src = '${smokeArtworkUrl}';
        }),
      ]).then(([pong, snapshot, artworkResult]) => {
        document.title = 'smoke:' + pong + ':' + snapshot.tracks.length + ':' + artworkResult;
      })`);
    });
  }
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  const userData = app.getPath('userData');
  if (!smokeTest) {
    const migratedFrom = await migrateLegacyProfile(userData, app.getPath('appData'));
    if (migratedFrom) console.info('[profile] Migrated legacy library from', migratedFrom);
  }
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
  const smokeArtworkHash = smokeTest
    ? await artwork.saveBuffer(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6dssAAAAASUVORK5CYII=', 'base64'), 'image/png')
    : null;
  createWindow(smokeArtworkHash ? `music://artwork/${smokeArtworkHash}` : undefined);

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch((error) => {
  console.error('[bootstrap]', error);
  app.quit();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { database?.close(); database = null; });
