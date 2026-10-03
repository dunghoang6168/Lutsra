import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserWindow } from 'electron';

interface SnapAddon {
  install(handle: Buffer): boolean;
  update(handle: Buffer, x: number, y: number, width: number, height: number): void;
  isHovered(handle: Buffer): boolean;
  remove(handle: Buffer): void;
}

const installedWindows = new WeakSet<BrowserWindow>();
let addon: SnapAddon | null | undefined;

function getAddon(): SnapAddon | null {
  if (process.platform !== 'win32') return null;
  if (addon !== undefined) return addon;
  try {
    const require = createRequire(import.meta.url);
    const directory = path.dirname(fileURLToPath(import.meta.url));
    addon = require(path.join(directory, 'native', 'window_snap.node')) as SnapAddon;
  } catch (error) {
    console.warn('[window-snap] Native Snap integration unavailable; maximize click remains active.', error);
    addon = null;
  }
  return addon;
}

export function installWindowSnap(window: BrowserWindow): void {
  const native = getAddon();
  if (!native) return;
  try {
    if (!native.install(window.getNativeWindowHandle())) return;
    installedWindows.add(window);
    let hovered = false;
    const hoverTimer = setInterval(() => {
      if (window.isDestroyed() || window.webContents.isDestroyed()) return;
      const next = native.isHovered(window.getNativeWindowHandle());
      if (next === hovered) return;
      hovered = next;
      window.webContents.send('window:snap-hover-changed', next);
    }, 80);
    window.once('closed', () => {
      clearInterval(hoverTimer);
      installedWindows.delete(window);
    });
  } catch (error) {
    console.warn('[window-snap] Failed to install native hit test.', error);
  }
}

export function updateWindowSnapBounds(window: BrowserWindow, bounds: unknown): boolean {
  const native = getAddon();
  if (!native || !installedWindows.has(window) || !bounds || typeof bounds !== 'object') return false;
  const value = bounds as Record<string, unknown>;
  const { x, y, width, height } = value;
  if (![x, y, width, height].every((part) => typeof part === 'number' && Number.isFinite(part)) ||
      (x as number) < 0 || (y as number) < 0 || (width as number) < 8 || (height as number) < 8 ||
      (x as number) > 16384 || (y as number) > 16384 || (width as number) > 256 || (height as number) > 256) {
    throw new Error('Invalid maximize button bounds');
  }
  native.update(window.getNativeWindowHandle(), x as number, y as number, width as number, height as number);
  return true;
}
