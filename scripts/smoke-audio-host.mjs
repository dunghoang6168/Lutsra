import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const executable = path.join(root, 'dist-electron', 'audio-host', 'lutsra-audio-host.exe');
if (!existsSync(executable)) throw new Error('Native Audio Host has not been built.');
const pipeName = `\\\\.\\pipe\\lutsra-audio-smoke-${randomUUID()}`;
const nonce = randomBytes(32).toString('hex');
let socket, buffer = Buffer.alloc(0), nextId = 0;
const pending = new Map();
let helloResolve, helloReject;
const hello = new Promise((resolve, reject) => { helloResolve = resolve; helloReject = reject; });
const server = net.createServer((connection) => {
  socket = connection;
  connection.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0);
      if (!length || length > 1024 * 1024) throw new Error('Invalid host frame length.');
      if (buffer.length < length + 4) return;
      const message = JSON.parse(buffer.subarray(4, length + 4).toString('utf8'));
      buffer = buffer.subarray(length + 4);
      if (message.type === 'hello') {
        if (message.protocolVersion !== 1 || message.payload?.nonce !== nonce) helloReject(new Error('Host handshake mismatch.'));
        else helloResolve();
      } else if (message.type === 'response' && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id); pending.delete(message.id);
        message.ok === false ? reject(new Error(message.error?.code || 'Host request failed.')) : resolve(message.payload);
      }
    }
  });
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(pipeName, resolve); });
const child = spawn(executable, ['--pipe', pipeName, '--nonce', nonce, '--protocol', '1'], { windowsHide: true, stdio: 'ignore' });
const timeout = setTimeout(() => helloReject(new Error('Host handshake timed out.')), 8000);
await hello; clearTimeout(timeout);
function request(type, payload) {
  const id = `smoke-${++nextId}`;
  const json = Buffer.from(JSON.stringify({ protocolVersion: 1, id, type, payload }), 'utf8');
  const frame = Buffer.alloc(json.length + 4); frame.writeUInt32LE(json.length); json.copy(frame, 4); socket.write(frame);
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
const devices = await request('list-devices');
if (!Array.isArray(devices) || !devices.some((device) => device.id === 'system-default')) throw new Error('System Default endpoint was not returned.');
for (const device of devices) {
  console.log(JSON.stringify({ endpoint: device.name, supportedModes: device.supportedModes, supportedFormats: device.supportedFormats }, null, 2));
}
const status = await request('get-path-status');
if (status?.backend !== 'native-shared' || !status.outputFormat?.sampleRate || !status.outputFormat?.channels) throw new Error('WASAPI mix format was not reported.');
await request('shutdown');
await new Promise((resolve) => child.once('exit', resolve));
server.close();
console.log(JSON.stringify({ endpoints: devices.length, outputFormat: status.outputFormat, backend: status.backend }));
