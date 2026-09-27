import electronPath from 'electron';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const childEnvironment = { ...process.env };
delete childEnvironment.ELECTRON_RUN_AS_NODE;
const smokeTest = process.argv.includes('--smoke');
const smokeUserData = smokeTest ? await mkdtemp(path.join(os.tmpdir(), 'lutsra-smoke-')) : null;
if (smokeUserData) childEnvironment.LUTSRA_SMOKE_USER_DATA = smokeUserData;

const child = spawn(electronPath, ['.', ...process.argv.slice(2)], {
  env: childEnvironment,
  stdio: 'inherit',
  windowsHide: false,
});

child.on('close', async (code) => {
  if (smokeUserData) {
    try {
      await rm(smokeUserData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (error) {
      console.warn('[smoke] Could not remove temporary Electron profile', error);
    }
  }
  process.exitCode = code ?? 1;
});
child.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
