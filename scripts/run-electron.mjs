import electronPath from 'electron';
import { spawn } from 'node:child_process';

const childEnvironment = { ...process.env };
delete childEnvironment.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ['.', ...process.argv.slice(2)], {
  env: childEnvironment,
  stdio: 'inherit',
  windowsHide: false,
});

child.on('close', (code) => {
  process.exitCode = code ?? 1;
});
child.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
