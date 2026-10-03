import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPackage from 'electron/package.json' with { type: 'json' };

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const output = path.join(root, 'dist-electron', 'native', 'window_snap.node');
const required = process.argv.includes('--required');
if (process.platform !== 'win32') process.exit(0);

rmSync(output, { force: true });
const builder = path.join(root, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js');
const nativeDirectory = path.join(root, 'native', 'window-snap');
const result = spawnSync(process.execPath, [builder, 'rebuild',
  `--directory=${nativeDirectory}`,
  `--target=${electronPackage.version}`,
  '--dist-url=https://electronjs.org/headers',
], { cwd: root, stdio: 'inherit', windowsHide: true });

const binary = path.join(nativeDirectory, 'build', 'Release', 'window_snap.node');
if (result.status === 0 && existsSync(binary)) {
  mkdirSync(path.dirname(output), { recursive: true });
  copyFileSync(binary, output);
  console.info('[window-snap] Native Windows Snap integration built.');
} else if (required) {
  console.error('[window-snap] A C++ build toolchain and Electron headers are required for Windows packaging.');
  process.exitCode = result.status || 1;
} else {
  console.warn('[window-snap] Native build unavailable; Electron will use the existing maximize button behavior.');
}
