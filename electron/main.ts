import { app, BrowserWindow, Menu, session, type BrowserWindow as BrowserWindowType } from 'electron';
import path from 'node:path';
import { copyFile, mkdir, readdir } from 'node:fs/promises';
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

function createWindow(smokeArtworkUrl?: string, smokeTrackId?: string, smokeWorkerFile?: string, smokeDuration?: number): void {
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
      }, smokeTrackId ? 30000 : 5000);
      mainWindow?.webContents.on('page-title-updated', (_event, title) => {
        if (!title.startsWith('smoke:')) return;
        clearTimeout(timeout);
        const [pong, trackCount, artworkResult, waveformResult, cacheResult] = title.slice(6).split(':');
        if (pong !== 'pong' || artworkResult !== 'ok' || waveformResult !== 'ok' || cacheResult !== 'ok') {
          console.error('[smoke] Renderer check failed', { pong, artworkResult, waveformResult, cacheResult });
          app.exit(1);
          return;
        }
        console.info('[smoke]', { pong, trackCount: Number(trackCount), artworkResult, waveformResult, cacheResult });
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
        ${smokeTrackId ? `Promise.all([
          fetch('music://track/${smokeTrackId}').then(async (response) => response.ok && (await response.arrayBuffer()).byteLength > 0),
          new Promise((resolve) => {
            const worker = new Worker('${development ? `/` : `app://lutsra/`}${smokeWorkerFile}', { type: 'module' });
            worker.onmessage = (event) => {
              if (event.data.type === 'progress') return;
              const peaks = event.data.type === 'done' ? new Float32Array(event.data.peaks) : null;
              resolve(peaks?.length === 1024 && peaks.some((value) => value > 0));
              worker.terminate();
            };
            worker.onerror = () => { resolve(false); worker.terminate(); };
            worker.postMessage({ trackId: '${smokeTrackId}', duration: ${smokeDuration ?? 0} });
          }),
        ]).then((checks) => checks.every(Boolean) ? 'ok' : 'failed').catch(() => 'failed')` : `Promise.resolve('ok')`},
        new Promise((resolve) => {
          try {
            const request = indexedDB.open('lutsra-smoke-idb', 1);
            request.onupgradeneeded = () => request.result.createObjectStore('probe');
            request.onerror = () => resolve('failed');
            request.onsuccess = () => {
              const database = request.result;
              const write = database.transaction('probe', 'readwrite');
              write.objectStore('probe').put('ok', 'value');
              write.onerror = () => { database.close(); resolve('failed'); };
              write.oncomplete = () => {
                const read = database.transaction('probe', 'readonly').objectStore('probe').get('value');
                read.onerror = () => { database.close(); resolve('failed'); };
                read.onsuccess = () => { database.close(); resolve(read.result === 'ok' ? 'ok' : 'failed'); };
              };
            };
          } catch { resolve('failed'); }
        }),
      ]).then(([pong, snapshot, artworkResult, waveformResult, cacheResult]) => {
        document.title = 'smoke:' + pong + ':' + snapshot.tracks.length + ':' + artworkResult + ':' + waveformResult + ':' + cacheResult;
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
  let smokeTrackId: string | undefined;
  let smokeWorkerFile: string | undefined;
  let smokeDuration: number | undefined;
  const smokeFlacPath = process.env['LUTSRA_SMOKE_FLAC_PATH'];
  if (smokeTest && smokeFlacPath) {
    const musicRoot = path.join(userData, 'smoke-music');
    await mkdir(musicRoot);
    await copyFile(smokeFlacPath, path.join(musicRoot, 'waveform.flac'));
    const folder = database.addFolder(musicRoot, 'Smoke music');
    await scanner.scan([folder.id]);
    const smokeTrack = database.getLibrary().tracks[0];
    smokeTrackId = smokeTrack?.id;
    smokeDuration = smokeTrack?.duration;
    smokeWorkerFile = process.env['LUTSRA_SMOKE_WORKER_FILE']
      ?? (await readdir(rendererRoot)).find((name) => /^worker-.*\.js$/.test(name));
    if (!smokeTrackId || !smokeWorkerFile || !/^worker-[\w-]+\.js$/.test(smokeWorkerFile)) {
      throw new Error('Waveform smoke fixture or worker bundle missing');
    }
  }
  createWindow(smokeArtworkHash ? `music://artwork/${smokeArtworkHash}` : undefined, smokeTrackId, smokeWorkerFile, smokeDuration);

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch((error) => {
  console.error('[bootstrap]', error);
  app.quit();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { database?.close(); database = null; });
