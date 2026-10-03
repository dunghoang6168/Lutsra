import { app, type BrowserWindow } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import net, { type Server, type Socket } from 'node:net';
import path from 'node:path';
import type { AudioHostState, AudioOutputDevice, AudioPathStatus } from '../../src/app/core/models/index.js';
import type { DatabaseService } from './database.service.js';

const PROTOCOL_VERSION = 1;
const MAX_FRAME_BYTES = 1024 * 1024;
const START_TIMEOUT_MS = 8_000;
const REQUEST_TIMEOUT_MS = 10_000;

type JsonObject = Record<string, unknown>;
type HostEnvelope = { protocolVersion: number; id?: string; type: string; payload?: unknown; ok?: boolean; error?: { code?: string; message?: string } };
type PendingRequest = { resolve(value: unknown): void; reject(error: Error): void; timeout: ReturnType<typeof setTimeout> };

export class AudioHostService {
  private state: AudioHostState = process.platform === 'win32' ? 'stopped' : 'unavailable';
  private child: ChildProcess | null = null;
  private server: Server | null = null;
  private socket: Socket | null = null;
  private receiveBuffer = Buffer.alloc(0);
  private pending = new Map<string, PendingRequest>();
  private startup: Promise<void> | null = null;
  private intentionalStop = false;
  private restartCount = 0;
  private handlingExit = false;
  private nonce = '';
  private currentTrackId: string | null = null;
  private currentPosition = 0;
  private selectedDeviceId = 'system-default';
  private volume = 0.8;
  private muted = false;
  private fallbackEnabled = false;

  constructor(
    private readonly database: DatabaseService,
    private readonly getWindow: () => BrowserWindow | null,
  ) {}

  getState(): AudioHostState { return this.state; }

  async ensureStarted(): Promise<void> {
    if (this.state === 'ready' && this.socket) return;
    if (this.startup) return this.startup;
    this.startup = this.start().catch((error) => {
      this.child?.kill();
      this.cleanupConnection(hostError('AUDIO_HOST_UNAVAILABLE', 'Native Audio Host failed to start.'));
      this.server?.close();
      this.server = null;
      this.setState(this.restartCount > 0 ? 'failed' : 'unavailable');
      throw error;
    }).finally(() => { this.startup = null; });
    return this.startup;
  }

  async loadTrack(trackId: string): Promise<void> {
    const track = this.database.resolveTrack(trackId);
    if (!track) throw hostError('FILE_UNAVAILABLE', 'The selected track is unavailable.');
    let canonicalPath: string;
    try { canonicalPath = await realpath(track.path); } catch { throw hostError('FILE_UNAVAILABLE', 'The selected track is unavailable.'); }
    await this.request('load', { trackId, path: canonicalPath });
    this.currentTrackId = trackId;
    this.currentPosition = 0;
  }

  async prepareTrack(trackId: string): Promise<boolean> {
    const track = this.database.resolveTrack(trackId);
    if (!track) return false;
    let canonicalPath: string;
    try { canonicalPath = await realpath(track.path); } catch { return false; }
    return Boolean(await this.request('prepare', { trackId, path: canonicalPath }));
  }

  play(): Promise<void> { return this.requestVoid('play'); }
  pause(): Promise<void> { return this.requestVoid('pause'); }
  seek(positionSeconds: number): Promise<void> { this.currentPosition = positionSeconds; return this.requestVoid('seek', { positionSeconds }); }
  setVolume(volume: number): Promise<void> { this.volume = volume; return this.requestVoid('set-volume', { volume }); }
  setMute(isMuted: boolean): Promise<void> { this.muted = isMuted; return this.requestVoid('set-mute', { isMuted }); }
  cancelPrepared(): Promise<void> { return this.requestVoid('cancel-prepared'); }
  transition(crossfadeSeconds: number): Promise<boolean> { return this.request('transition', { crossfadeSeconds }).then(Boolean); }
  listDevices(): Promise<AudioOutputDevice[]> { return this.request('list-devices') as Promise<AudioOutputDevice[]>; }
  async selectDevice(deviceId: string): Promise<void> { await this.requestVoid('select-device', { deviceId }); this.selectedDeviceId = deviceId; }
  setFallbackEnabled(enabled: boolean): Promise<void> { this.fallbackEnabled = enabled; return this.requestVoid('set-fallback', { enabled }); }
  getPathStatus(): Promise<AudioPathStatus> { return this.request('get-path-status') as Promise<AudioPathStatus>; }
  setSpectrumEnabled(enabled: boolean): Promise<void> { return this.requestVoid('set-spectrum', { enabled }); }

  async stop(): Promise<void> {
    this.intentionalStop = true;
    try { if (this.socket) await this.requestVoid('shutdown'); } catch { /* Process termination below is authoritative. */ }
    this.child?.kill();
    this.cleanupConnection(hostError('AUDIO_HOST_UNAVAILABLE', 'Native Audio Host stopped.'));
    await new Promise<void>((resolve) => this.server?.close(() => resolve()) ?? resolve());
    this.server = null;
    this.child = null;
    this.setState(process.platform === 'win32' ? 'stopped' : 'unavailable');
  }

  private async start(): Promise<void> {
    if (process.platform !== 'win32') throw hostError('AUDIO_HOST_UNAVAILABLE', 'Native Shared is available on Windows only.');
    const executable = this.executablePath();
    if (!existsSync(executable)) {
      this.setState('unavailable');
      throw hostError('AUDIO_HOST_UNAVAILABLE', 'Native Audio Host is not installed.');
    }
    this.intentionalStop = false;
    this.setState(this.restartCount > 0 ? 'recovering' : 'starting');
    this.nonce = randomBytes(32).toString('hex');
    const pipeName = `\\\\.\\pipe\\lutsra-audio-${randomUUID()}`;
    this.server = net.createServer((socket) => this.acceptSocket(socket));
    await new Promise<void>((resolve, reject) => {
      const server = this.server!;
      server.once('error', reject);
      server.listen(pipeName, () => { server.removeListener('error', reject); resolve(); });
    });
    const child = spawn(executable, ['--pipe', pipeName, '--nonce', this.nonce, '--protocol', String(PROTOCOL_VERSION)], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore'],
      env: { SystemRoot: process.env['SystemRoot'] ?? 'C:\\Windows' },
    });
    this.child = child;
    child.once('exit', () => void this.handleExit(child));
    child.once('error', () => void this.handleExit(child));
    await this.waitUntilReady();
  }

  private acceptSocket(socket: Socket): void {
    if (this.socket) { socket.destroy(); return; }
    this.socket = socket;
    this.server?.close();
    this.server = null;
    socket.on('data', (chunk) => this.consume(chunk));
    socket.once('error', () => this.handleDisconnect());
    socket.once('close', () => this.handleDisconnect());
  }

  private consume(chunk: Buffer): void {
    this.receiveBuffer = Buffer.concat([this.receiveBuffer, chunk]);
    while (this.receiveBuffer.length >= 4) {
      const length = this.receiveBuffer.readUInt32LE(0);
      if (length === 0 || length > MAX_FRAME_BYTES) { this.protocolFailure(); return; }
      if (this.receiveBuffer.length < length + 4) return;
      const payload = this.receiveBuffer.subarray(4, 4 + length);
      this.receiveBuffer = this.receiveBuffer.subarray(4 + length);
      try { this.handleMessage(JSON.parse(payload.toString('utf8')) as HostEnvelope); }
      catch { this.protocolFailure(); return; }
    }
  }

  private handleMessage(message: HostEnvelope): void {
    if (message.protocolVersion !== PROTOCOL_VERSION || typeof message.type !== 'string') { this.protocolFailure(); return; }
    if (message.type === 'hello') {
      const received = typeof message.payload === 'object' && message.payload ? String((message.payload as JsonObject)['nonce'] ?? '') : '';
      const expectedBuffer = Buffer.from(this.nonce);
      const receivedBuffer = Buffer.from(received);
      if (expectedBuffer.length !== receivedBuffer.length || !timingSafeEqual(expectedBuffer, receivedBuffer)) { this.protocolFailure(); return; }
      this.setState('ready');
      return;
    }
    if (message.type === 'response' && message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.ok === false) pending.reject(hostError(message.error?.code ?? 'PLAYBACK_FAILED', safeHostMessage(message.error?.message)));
      else pending.resolve(message.payload);
      return;
    }
    if (message.type === 'event') {
      if (message.payload && typeof message.payload === 'object') {
        const event = message.payload as JsonObject;
        if (event['kind'] === 'time' && event['value'] && typeof event['value'] === 'object') {
          const position = Number((event['value'] as JsonObject)['currentTime']);
          if (Number.isFinite(position)) this.currentPosition = position;
        } else if (event['kind'] === 'state' && event['value'] && typeof event['value'] === 'object') {
          const value = event['value'] as JsonObject;
          const trackId = typeof value['trackId'] === 'string' ? value['trackId'] : '';
          if (value['state'] === 'playing' && trackId && trackId !== this.currentTrackId) {
            this.currentTrackId = trackId;
            this.currentPosition = 0;
          }
        }
      }
      this.broadcast('audio-host:event', message.payload);
    }
  }

  private request<T = unknown>(type: string, payload?: JsonObject): Promise<T> {
    return this.ensureStarted().then(() => new Promise<T>((resolve, reject) => {
      if (!this.socket) { reject(hostError('AUDIO_HOST_UNAVAILABLE', 'Native Audio Host is unavailable.')); return; }
      const id = randomUUID();
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(hostError('AUDIO_HOST_PROTOCOL_ERROR', 'Native Audio Host did not respond.'));
        // A host that stops answering is hung; killing it triggers the normal restart path.
        this.protocolFailure();
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timeout });
      this.writeFrame({ protocolVersion: PROTOCOL_VERSION, id, type, payload });
    }));
  }

  private requestVoid(type: string, payload?: JsonObject): Promise<void> { return this.request(type, payload).then(() => undefined); }

  private writeFrame(message: HostEnvelope): void {
    const json = Buffer.from(JSON.stringify(message), 'utf8');
    if (json.length > MAX_FRAME_BYTES) throw hostError('AUDIO_HOST_PROTOCOL_ERROR', 'Audio Host command is too large.');
    const frame = Buffer.allocUnsafe(json.length + 4);
    frame.writeUInt32LE(json.length, 0);
    json.copy(frame, 4);
    this.socket?.write(frame);
  }

  private waitUntilReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + START_TIMEOUT_MS;
      const check = () => {
        if (this.state === 'ready') { resolve(); return; }
        if (!this.child || this.child.exitCode !== null) { reject(hostError('AUDIO_HOST_UNAVAILABLE', 'Native Audio Host failed to start.')); return; }
        if (Date.now() >= deadline) { reject(hostError('AUDIO_HOST_UNAVAILABLE', 'Native Audio Host startup timed out.')); return; }
        setTimeout(check, 25);
      };
      check();
    });
  }

  private async handleExit(exitedChild: ChildProcess): Promise<void> {
    if (this.intentionalStop || this.handlingExit || exitedChild !== this.child) return;
    this.handlingExit = true;
    this.cleanupConnection(hostError('AUDIO_HOST_UNAVAILABLE', 'Native Audio Host exited unexpectedly.'));
    this.child = null;
    if (this.restartCount < 1) {
      this.restartCount++;
      this.setState('recovering');
      const restart = this.start();
      this.startup = restart.finally(() => { this.startup = null; });
      try { await this.startup; await this.rehydratePausedSession(); } catch { this.setState('failed'); }
    } else this.setState('failed');
    this.handlingExit = false;
  }

  private handleDisconnect(): void {
    if (this.intentionalStop || this.child?.exitCode !== null) return;
    this.child?.kill();
  }

  private protocolFailure(): void {
    this.cleanupConnection(hostError('AUDIO_HOST_PROTOCOL_ERROR', 'Native Audio Host protocol error.'));
    this.child?.kill();
  }

  private cleanupConnection(error: Error): void {
    this.socket?.destroy();
    this.socket = null;
    this.receiveBuffer = Buffer.alloc(0);
    for (const pending of this.pending.values()) { clearTimeout(pending.timeout); pending.reject(error); }
    this.pending.clear();
  }

  private setState(state: AudioHostState): void {
    if (this.state === state) return;
    this.state = state;
    this.broadcast('audio-host:state', state);
  }

  private broadcast(channel: string, value: unknown): void {
    const window = this.getWindow();
    if (window && !window.isDestroyed()) window.webContents.send(channel, value);
  }

  private executablePath(): string {
    return app.isPackaged
      ? path.join(process.resourcesPath, 'audio-host', 'lutsra-audio-host.exe')
      : path.join(app.getAppPath(), 'dist-electron', 'audio-host', 'lutsra-audio-host.exe');
  }

  private async rehydratePausedSession(): Promise<void> {
    await this.requestVoid('set-fallback', { enabled: this.fallbackEnabled });
    await this.requestVoid('select-device', { deviceId: this.selectedDeviceId });
    await this.requestVoid('set-volume', { volume: this.volume });
    await this.requestVoid('set-mute', { isMuted: this.muted });
    if (this.currentTrackId) {
      const position = this.currentPosition;
      await this.loadTrack(this.currentTrackId);
      await this.requestVoid('seek', { positionSeconds: position });
      this.currentPosition = position;
      await this.requestVoid('pause');
    }
  }
}

function safeHostMessage(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) return 'Native audio operation failed.';
  return value.replace(/[A-Za-z]:\\[^\s]+/g, '[media]');
}

function hostError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}
