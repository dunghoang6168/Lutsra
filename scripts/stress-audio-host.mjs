import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const executable = path.join(root, 'dist-electron', 'audio-host', 'lutsra-audio-host.exe');
const musicDir = process.env.LUTSRA_STRESS_MUSIC_DIR;
if (!musicDir || !existsSync(musicDir)) throw new Error('Set LUTSRA_STRESS_MUSIC_DIR to an existing music directory.');
if (!existsSync(executable)) throw new Error('Build the native audio host first.');
const extensions = new Set(['.flac', '.wav', '.mp3', '.m4a', '.aac', '.ogg', '.opus']);
const files = readdirSync(musicDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase()))
  .map((entry) => path.join(musicDir, entry.name));
if (files.length < 3) throw new Error('The music directory needs at least three supported audio files.');

const pipeName = `\\\\.\\pipe\\lutsra-audio-stress-${randomUUID()}`;
const nonce = randomBytes(32).toString('hex');
const pending = new Map();
const playingTracks = new Set();
let socket, child, receiveBuffer = Buffer.alloc(0), nextId = 0, responses = 0;
let helloResolve, helloReject;
const hello = new Promise((resolve, reject) => { helloResolve = resolve; helloReject = reject; });
const server = net.createServer((connection) => {
  socket = connection;
  connection.on('data', (chunk) => {
    receiveBuffer = Buffer.concat([receiveBuffer, chunk]);
    while (receiveBuffer.length >= 4) {
      const length = receiveBuffer.readUInt32LE(0);
      if (!length || length > 1024 * 1024) {
        connection.destroy(new Error('Invalid frame length.'));
        return;
      }
      if (receiveBuffer.length < length + 4) break;
      const message = JSON.parse(receiveBuffer.subarray(4, length + 4).toString('utf8'));
      receiveBuffer = receiveBuffer.subarray(length + 4);
      if (message.type === 'hello') {
        message.protocolVersion === 1 && message.payload?.nonce === nonce
          ? helloResolve() : helloReject(new Error('Host handshake failed.'));
      } else if (message.type === 'response') {
        const request = pending.get(message.id);
        if (!request) continue;
        pending.delete(message.id);
        clearTimeout(request.timeout);
        responses++;
        message.ok === false
          ? request.reject(new Error(message.error?.code || 'Host request failed.'))
          : request.resolve(message.payload);
      } else if (message.type === 'event' && message.payload?.kind === 'state' &&
                 message.payload.value?.state === 'playing') {
        playingTracks.add(message.payload.value.trackId);
      }
    }
  });
  connection.on('error', (error) => {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  });
});

function request(type, payload = {}) {
  if (!socket || child?.exitCode !== null) return Promise.reject(new Error('Host is unavailable.'));
  const id = `stress-${++nextId}`;
  const json = Buffer.from(JSON.stringify({ protocolVersion: 1, id, type, payload }));
  const frame = Buffer.allocUnsafe(json.length + 4);
  frame.writeUInt32LE(json.length, 0);
  json.copy(frame, 4);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`No response for ${type}.`));
    }, 10_000);
    pending.set(id, { resolve, reject, timeout });
    socket.write(frame);
  });
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomDelay = () => 20 + Math.floor(Math.random() * 281);
const track = (index) => ({ trackId: `stress-${index}`, path: files[index % files.length] });

try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(pipeName, resolve); });
  child = spawn(executable, ['--pipe', pipeName, '--nonce', nonce],
                { windowsHide: true, stdio: 'ignore' });
  child.once('exit', () => {
    helloReject(new Error('Host exited before handshake.'));
    for (const entry of pending.values()) entry.reject(new Error('Host exited.'));
    pending.clear();
  });
  await Promise.race([hello, sleep(8_000).then(() => { throw new Error('Host handshake timed out.'); })]);
  const devices = await request('list-devices');
  // Stress audio is noise; stay muted unless LUTSRA_STRESS_AUDIBLE=1.
  await request('set-mute', { isMuted: process.env.LUTSRA_STRESS_AUDIBLE !== '1' });

  for (let i = 0; i < 50; i++) {
    await request('load', track(i));
    await request('play');
    await sleep(randomDelay());
  }
  // Unawaited bursts mirror Electron issuing commands while earlier ones are still running.
  const burst = [];
  for (let i = 0; i < 40; i++) {
    burst.push(request('load', track(100 + i)), request('cancel-prepared'),
               request('prepare', track(101 + i)), request('seek', { positionSeconds: 1 }),
               request('play'));
  }
  const hung = (await Promise.allSettled(burst))
    .filter((result) => result.status === 'rejected' && /No response|Host exited/.test(result.reason?.message));
  if (hung.length) throw new Error(`Host stopped answering during burst: ${hung[0].reason.message}`);

  for (let i = 0; i < 200; i++)
    await request('seek', { positionSeconds: Math.random() * 3 });

  await request('load', track(50));
  await request('play');
  if (await request('prepare', track(51))) {
    await request('transition', { crossfadeSeconds: 3 });
    await sleep(100);
    await request('load', track(52));
    await request('play');
  }

  const physical = devices.filter((device) => device.id !== 'system-default' && device.isConnected);
  if (physical.length >= 2) {
    for (let i = 0; i < 10; i++) {
      await request('select-device', { deviceId: physical[i % 2].id });
      await request('play');
    }
  }

  const finalTrack = track(53);
  await request('load', finalTrack);
  await request('play');
  const deadline = Date.now() + 5_000;
  while (!playingTracks.has(finalTrack.trackId) && Date.now() < deadline)
    await sleep(50);
  if (!playingTracks.has(finalTrack.trackId)) throw new Error('The final track did not emit playing.');
  if (pending.size || responses !== nextId) throw new Error('Some requests did not receive responses.');
  if (child.exitCode !== null) throw new Error('Host exited during stress run.');
  await request('shutdown');
  console.log(JSON.stringify({ requests: nextId, responses, endpointSwitches: physical.length >= 2 ? 10 : 0 }));
} finally {
  socket?.destroy();
  server.close();
  if (child?.exitCode === null) child.kill();
}