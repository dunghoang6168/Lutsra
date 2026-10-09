import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { AudioAnalysisEngine, PlaybackEngine } from '../contracts';
import {
  AudioOutputDevice, AudioPathStatus, OutputMode, PlaybackErrorCode, PlaybackStateEvent,
  PlaybackTimeEvent, PlaybackVolumeEvent, SYSTEM_DEFAULT_OUTPUT_ID, Track,
} from '../models';
import { constantSumCrossfadeGains } from '../player/crossfade-gains';
import { logPlaybackDiagnostic } from '../player/playback-diagnostics';
import { stateForMediaEvent } from '../player/playback-policy';

type SinkAudioElement = HTMLAudioElement & { setSinkId?: (sinkId: string) => Promise<void>; sinkId?: string };

@Injectable()
export class HtmlAudioPlaybackEngine implements PlaybackEngine, AudioAnalysisEngine {
  private audio: SinkAudioElement = new Audio();
  private standby: SinkAudioElement | null = null;
  private currentTrack: Track | null = null;
  private preparedTrack: Track | null = null;
  private preparedPromise: Promise<boolean> | null = null;
  private cancelPreparation: (() => void) | null = null;
  private loadSequence = 0;
  private prepareSequence = 0;
  private masterVolume = 0.8;
  private muted = false;
  private fade: { outgoing: SinkAudioElement; incoming: SinkAudioElement; seconds: number } | null = null;
  private fadeFrame: number | null = null;
  private fadeWaiters: Array<() => void> = [];
  private preferredOutputId = SYSTEM_DEFAULT_OUTPUT_ID;
  private preferredOutputName = 'System Default';
  private activeOutputId: string | null = SYSTEM_DEFAULT_OUTPUT_ID;
  private outputConnected = true;
  private fallbackEnabled = false;
  private deviceChangePending = false;
  private readonly deviceListeners = new Set<() => void>();
  private readonly state = new BehaviorSubject<PlaybackStateEvent>({ state: 'idle', track: null });
  private readonly time = new Subject<PlaybackTimeEvent>();
  private readonly volumeState = new BehaviorSubject<PlaybackVolumeEvent>({ volume: 0.8, isMuted: false });
  private audioContext: AudioContext | null = null;
  private readonly mediaSources = new Map<HTMLAudioElement, MediaElementAudioSourceNode>();
  private analyser: AnalyserNode | null = null;
  private analysisRequested = false;
  private analysisFailed = false;

  readonly isAnalysisSupported = typeof globalThis.AudioContext === 'function';
  readonly stateChange$: Observable<PlaybackStateEvent> = this.state.asObservable();
  readonly timeUpdate$: Observable<PlaybackTimeEvent> = this.time.asObservable();
  readonly volumeChange$: Observable<PlaybackVolumeEvent> = this.volumeState.asObservable();

  constructor() {
    this.configureAudio(this.audio);
    navigator.mediaDevices?.addEventListener?.('devicechange', this.handleDeviceChange);
  }

  private configureAudio(audio: SinkAudioElement): void {
    audio.crossOrigin = 'anonymous';
    audio.volume = this.masterVolume;
    audio.muted = this.muted;
    audio.addEventListener('play', () => { if (audio === this.audio) this.emitState(stateForMediaEvent('play', audio.paused)); });
    audio.addEventListener('pause', () => {
      if (audio === this.audio && !audio.ended && this.currentTrack && this.state.value.state !== 'error') this.emitState(stateForMediaEvent('pause', audio.paused));
    });
    audio.addEventListener('ended', () => { if (audio === this.audio) this.emitState(stateForMediaEvent('ended', audio.paused)); });
    for (const event of ['waiting', 'stalled']) {
      audio.addEventListener(event, () => { if (audio === this.audio && !audio.paused && this.currentTrack) this.emitState(stateForMediaEvent(event as 'waiting' | 'stalled', audio.paused)); });
    }
    audio.addEventListener('seeking', () => {
      if (audio === this.audio) {
        if (!audio.paused && this.currentTrack) this.emitState('buffering');
        this.emitTime();
      }
    });
    for (const event of ['playing', 'canplay', 'seeked']) {
      audio.addEventListener(event, () => {
        if (audio !== this.audio || !this.currentTrack) return;
        this.emitState(stateForMediaEvent(event === 'playing' ? 'play' : event as 'canplay' | 'seeked', audio.paused));
        this.emitTime();
      });
    }
    for (const event of ['timeupdate', 'durationchange']) audio.addEventListener(event, () => { if (audio === this.audio) this.emitTime(); });
    audio.addEventListener('error', () => {
      if (audio !== this.audio) return;
      const code = mediaErrorCode(audio.error?.code);
      logPlaybackDiagnostic('error', { operation: 'play', state: 'error', errorCode: code, trackId: this.currentTrack?.id });
      this.state.next({ state: 'error', track: this.currentTrack, error: { code, message: mediaErrorMessage(code), trackId: this.currentTrack?.id } });
    });
  }

  async load(track: Track): Promise<void> {
    const sequence = ++this.loadSequence;
    this.cancelPreparedNext();
    this.finishFade();
    this.audio.pause();
    this.currentTrack = track;
    this.emitState('loading');
    logPlaybackDiagnostic('info', { operation: 'load', state: 'loading', trackId: track.id, deviceId: this.activeOutputId ?? undefined });
    if (!track.isAvailable) throw playbackError('FILE_UNAVAILABLE', 'This audio file is no longer available.');
    await this.ensureOutputForPlayback();
    return new Promise<void>((resolve, reject) => {
      const audio = this.audio;
      const cleanup = () => { audio.removeEventListener('loadedmetadata', loaded); audio.removeEventListener('error', failed); };
      const loaded = () => {
        cleanup();
        if (sequence !== this.loadSequence || audio !== this.audio) return reject(playbackError('PLAYBACK_FAILED', 'Playback load was replaced.'));
        this.emitTime();
        this.emitState('paused');
        resolve();
      };
      const failed = () => { cleanup(); const code = mediaErrorCode(audio.error?.code); reject(playbackError(code, mediaErrorMessage(code))); };
      audio.addEventListener('loadedmetadata', loaded, { once: true });
      audio.addEventListener('error', failed, { once: true });
      audio.src = `music://track/${encodeURIComponent(track.id)}`;
      audio.load();
    });
  }

  async prepareNext(track: Track): Promise<boolean> {
    if (!track.isAvailable || (!this.outputConnected && !this.fallbackEnabled)) return false;
    if (this.fade) {
      const sequence = this.prepareSequence;
      await new Promise<void>((resolve) => this.fadeWaiters.push(resolve));
      if (sequence !== this.prepareSequence) return false;
    }
    if (this.preparedTrack?.id === track.id && this.preparedPromise) return this.preparedPromise;
    this.cancelPreparedNext();
    const standby: SinkAudioElement = this.standby ?? new Audio();
    if (!this.standby) this.configureAudio(standby);
    this.standby = standby;
    try { await this.applySink(standby, this.activeOutputId ?? SYSTEM_DEFAULT_OUTPUT_ID); } catch { return false; }
    // Metadata alone does not warm Chromium's decoder. Wait until actual audio
    // data is available so an automatic transition can reuse this element.
    standby.preload = 'auto';
    const sequence = ++this.prepareSequence;
    this.preparedTrack = track;
    this.preparedPromise = new Promise<boolean>((resolve) => {
      const cleanup = () => { standby.removeEventListener('canplay', ready); standby.removeEventListener('error', failed); this.cancelPreparation = null; };
      const ready = () => { cleanup(); resolve(sequence === this.prepareSequence); };
      const failed = () => { cleanup(); if (sequence === this.prepareSequence) this.preparedTrack = null; resolve(false); };
      this.cancelPreparation = () => { cleanup(); resolve(false); };
      standby.addEventListener('canplay', ready, { once: true });
      standby.addEventListener('error', failed, { once: true });
      standby.src = `music://track/${encodeURIComponent(track.id)}`;
      standby.load();
      if (standby.readyState >= 3) queueMicrotask(ready);
    });
    return this.preparedPromise;
  }

  cancelPreparedNext(): void {
    this.prepareSequence++;
    this.cancelPreparation?.();
    this.cancelPreparation = null;
    this.preparedTrack = null;
    this.preparedPromise = null;
    if (this.standby && !this.fade) { this.standby.pause(); this.standby.removeAttribute('src'); this.standby.load(); }
  }

  async transitionTo(track: Track, crossfadeSeconds: number): Promise<boolean> {
    if (this.fade || !this.standby || this.preparedTrack?.id !== track.id || !this.preparedPromise || !(await this.preparedPromise)) return false;
    const incoming = this.standby;
    const outgoing = this.audio;
    const shouldCrossfade = Number.isFinite(crossfadeSeconds) && crossfadeSeconds > 0;
    if (this.analysisRequested && this.analyser) this.connectForAnalysis(incoming);
    incoming.volume = shouldCrossfade ? 0 : this.masterVolume;
    incoming.muted = this.muted;
    try { await incoming.play(); } catch { this.cancelPreparedNext(); return false; }
    if (incoming !== this.standby || this.preparedTrack?.id !== track.id) { incoming.pause(); return false; }
    this.audio = incoming;
    this.standby = outgoing;
    this.currentTrack = track;
    this.preparedTrack = null;
    this.preparedPromise = null;
    if (shouldCrossfade) {
      this.fade = { outgoing, incoming, seconds: Math.max(0.1, crossfadeSeconds) };
    } else {
      outgoing.pause();
      outgoing.removeAttribute('src');
      outgoing.load();
    }
    this.emitState('playing');
    this.emitTime();
    if (shouldCrossfade) this.updateFade();
    return true;
  }

  async play(): Promise<void> {
    await this.ensureOutputForPlayback();
    if (this.analysisRequested && !this.analyser && !this.analysisFailed) {
      try { await this.prepareFrequencyAnalysis(); } catch { /* Playback remains available without analysis. */ }
    }
    if (this.analysisRequested && this.audioContext?.state === 'suspended') {
      try { await this.audioContext.resume(); } catch { /* Playback remains available without analysis. */ }
    }
    await this.audio.play();
    if (this.fade) { try { await this.fade.outgoing.play(); this.updateFade(); } catch { this.finishFade(); } }
  }

  pause(): void { this.audio.pause(); this.fade?.outgoing.pause(); this.stopFadeFrame(); }

  seek(positionSeconds: number): void {
    this.finishFade();
    const mediaDuration = Number.isFinite(this.audio.duration) && this.audio.duration > 0 ? this.audio.duration : null;
    const trackDuration = this.currentTrack && Number.isFinite(this.currentTrack.duration) && this.currentTrack.duration > 0 ? this.currentTrack.duration : 0;
    this.audio.currentTime = Math.max(0, Math.min(positionSeconds, mediaDuration ?? trackDuration));
    this.emitTime();
  }

  setVolume(volume: number): void { this.masterVolume = Math.max(0, Math.min(1, volume)); this.applyVolumes(); this.volumeState.next({ volume: this.masterVolume, isMuted: this.muted }); }
  setMute(isMuted: boolean): void { this.muted = isMuted; this.audio.muted = isMuted; if (this.standby) this.standby.muted = isMuted; this.volumeState.next({ volume: this.masterVolume, isMuted }); }

  async listOutputDevices(): Promise<AudioOutputDevice[]> {
    const devices: AudioOutputDevice[] = [{ id: SYSTEM_DEFAULT_OUTPUT_ID, name: 'System Default', isDefault: true, isConnected: true, supportedModes: ['shared'], supportedFormats: null, mixFormat: null }];
    if (navigator.mediaDevices?.enumerateDevices) {
      try {
        const outputs = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'audiooutput');
        let unnamed = 0;
        for (const device of outputs) {
          if (!device.deviceId || device.deviceId === 'default') continue;
          devices.push({ id: device.deviceId, name: device.label || `Audio output ${++unnamed}`, isDefault: false, isConnected: true, supportedModes: ['shared'], supportedFormats: null, mixFormat: null });
        }
      } catch { logPlaybackDiagnostic('warn', { operation: 'device-list', errorCode: 'OUTPUT_DEVICE_UNSUPPORTED' }); }
    }
    if (this.preferredOutputId !== SYSTEM_DEFAULT_OUTPUT_ID && !devices.some((device) => device.id === this.preferredOutputId)) {
      devices.push({ id: this.preferredOutputId, name: this.preferredOutputName || 'Unavailable audio output', isDefault: false, isConnected: false, supportedModes: ['shared'], supportedFormats: null, mixFormat: null });
    }
    return devices;
  }

  async selectOutputDevice(deviceId: string): Promise<void> {
    const requested = deviceId || SYSTEM_DEFAULT_OUTPUT_ID;
    this.preferredOutputId = requested;
    const devices = await this.listOutputDevices();
    const device = devices.find((candidate) => candidate.id === requested);
    if (!device?.isConnected) {
      this.outputConnected = false;
      this.activeOutputId = null;
      if (this.fallbackEnabled) {
        await this.applySink(this.audio, SYSTEM_DEFAULT_OUTPUT_ID);
        if (this.standby) await this.applySink(this.standby, SYSTEM_DEFAULT_OUTPUT_ID);
        this.activeOutputId = SYSTEM_DEFAULT_OUTPUT_ID;
        return;
      }
      throw playbackError('OUTPUT_DEVICE_UNAVAILABLE', 'The selected audio output is disconnected.');
    }
    await this.applySink(this.audio, requested);
    if (this.standby) await this.applySink(this.standby, requested);
    this.preferredOutputName = device.name;
    this.activeOutputId = requested;
    this.outputConnected = true;
    logPlaybackDiagnostic('info', { operation: 'device-select', deviceId: requested });
  }

  setOutputFallbackEnabled(enabled: boolean): void { this.fallbackEnabled = enabled; }

  async setOutputMode(mode: OutputMode): Promise<void> {
    if (mode !== 'shared') throw playbackError('OUTPUT_MODE_UNSUPPORTED', 'This output mode requires the Native Audio Host.');
  }

  async getAudioPathStatus(): Promise<AudioPathStatus> {
    return {
      backend: 'chromium', hostState: 'unavailable', resamplingActive: false, channelConversionActive: false,
      bitPerfectEligible: false, processingReasons: ['Chromium Shared audio pipeline'],
      preferredDeviceId: this.preferredOutputId, activeDeviceId: this.activeOutputId, deviceName: this.preferredOutputName,
      mode: 'shared', sourceFormat: this.currentTrack ? { sampleRate: this.currentTrack.sampleRate, bitDepth: this.currentTrack.bitDepth, channels: this.currentTrack.channels } : null,
      outputFormat: null, isConnected: this.outputConnected, capabilitiesAvailable: false,
      reason: 'Output format details require the Native Audio Host.',
    };
  }

  getBackend(): 'chromium' { return 'chromium'; }
  async setBackend(backend: 'chromium' | 'native-shared'): Promise<void> {
    if (backend !== 'chromium') throw playbackError('OUTPUT_MODE_UNSUPPORTED', 'Native Shared requires the Native Audio Host.');
  }

  subscribeDeviceChanges(listener: () => void): () => void { this.deviceListeners.add(listener); return () => this.deviceListeners.delete(listener); }

  private handleDeviceChange = (): void => {
    if (this.deviceChangePending) return;
    this.deviceChangePending = true;
    if (this.preferredOutputId !== SYSTEM_DEFAULT_OUTPUT_ID) this.pause();
    void this.refreshOutputConnection().finally(() => { this.deviceChangePending = false; });
  };

  private async refreshOutputConnection(): Promise<void> {
    const devices = await this.listOutputDevices();
    const preferred = devices.find((device) => device.id === this.preferredOutputId);
    if (preferred?.isConnected) {
      try {
        await this.applySink(this.audio, this.preferredOutputId);
        if (this.standby) await this.applySink(this.standby, this.preferredOutputId);
        this.activeOutputId = this.preferredOutputId;
        this.outputConnected = true;
        this.preferredOutputName = preferred.name;
      } catch { this.activeOutputId = null; this.outputConnected = false; }
    } else if (this.preferredOutputId !== SYSTEM_DEFAULT_OUTPUT_ID) {
      this.outputConnected = false;
      this.activeOutputId = null;
      if (this.fallbackEnabled) {
        try { await this.applySink(this.audio, SYSTEM_DEFAULT_OUTPUT_ID); if (this.standby) await this.applySink(this.standby, SYSTEM_DEFAULT_OUTPUT_ID); this.activeOutputId = SYSTEM_DEFAULT_OUTPUT_ID; } catch { /* Stay paused. */ }
      }
    }
    logPlaybackDiagnostic('warn', { operation: 'device-change', state: this.outputConnected ? 'connected' : 'disconnected', deviceId: this.preferredOutputId });
    for (const listener of this.deviceListeners) listener();
  }

  private async ensureOutputForPlayback(): Promise<void> {
    if (!this.outputConnected && !this.fallbackEnabled) throw playbackError('OUTPUT_DEVICE_UNAVAILABLE', 'The selected audio output is disconnected.');
    const target = this.outputConnected ? this.preferredOutputId : SYSTEM_DEFAULT_OUTPUT_ID;
    await this.applySink(this.audio, target);
    this.activeOutputId = target;
  }

  private async applySink(audio: SinkAudioElement, deviceId: string): Promise<void> {
    const sinkId = deviceId === SYSTEM_DEFAULT_OUTPUT_ID ? '' : deviceId;
    if (!audio.setSinkId) {
      if (sinkId) throw playbackError('OUTPUT_DEVICE_UNSUPPORTED', 'This runtime cannot select a specific audio output.');
      return;
    }
    if (audio.sinkId !== sinkId) {
      try { await audio.setSinkId(sinkId); }
      catch (error) {
        const failure = outputActivationError(error);
        logPlaybackDiagnostic('error', { operation: 'device-select', errorCode: failure.code, deviceId });
        throw failure;
      }
    }
  }

  private applyVolumes(): void {
    if (!this.fade) { this.audio.volume = this.masterVolume; return; }
    const gains = constantSumCrossfadeGains(this.fade.incoming.currentTime / this.fade.seconds);
    this.fade.incoming.volume = this.masterVolume * gains.incoming;
    this.fade.outgoing.volume = this.masterVolume * gains.outgoing;
  }

  private updateFade = (): void => {
    if (!this.fade) return;
    this.applyVolumes();
    if (this.fade.incoming.currentTime >= this.fade.seconds || this.fade.outgoing.ended) { this.finishFade(); return; }
    if (!this.audio.paused) this.fadeFrame = requestAnimationFrame(this.updateFade);
  };
  private stopFadeFrame(): void { if (this.fadeFrame !== null) cancelAnimationFrame(this.fadeFrame); this.fadeFrame = null; }
  private finishFade(): void {
    this.stopFadeFrame();
    if (!this.fade) return;
    const outgoing = this.fade.outgoing;
    this.fade = null;
    outgoing.pause(); outgoing.removeAttribute('src'); outgoing.load(); this.audio.volume = this.masterVolume;
    for (const resolve of this.fadeWaiters.splice(0)) resolve();
  }

  async prepareFrequencyAnalysis(): Promise<number> {
    this.analysisRequested = true;
    if (!this.isAnalysisSupported || this.analysisFailed) return 0;
    if (this.analyser && this.audioContext) {
      if (this.audioContext.state === 'suspended') { try { await this.audioContext.resume(); } catch { return 0; } }
      return this.audioContext.state === 'running' ? this.analyser.frequencyBinCount : 0;
    }
    const context = new AudioContext();
    try { if (context.state === 'suspended') await context.resume(); if (context.state !== 'running') { await context.close(); return 0; } }
    catch { try { await context.close(); } catch { /* Ignore. */ } return 0; }
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.5; analyser.minDecibels = -90; analyser.maxDecibels = -10; analyser.connect(context.destination);
    this.audioContext = context; this.analyser = analyser;
    if (!this.connectForAnalysis(this.audio)) return 0;
    if (this.fade) this.connectForAnalysis(this.fade.outgoing);
    return analyser.frequencyBinCount;
  }

  private connectForAnalysis(audio: HTMLAudioElement): boolean {
    if (!this.audioContext || !this.analyser || this.mediaSources.has(audio)) return true;
    let source: MediaElementAudioSourceNode | null = null;
    try { source = this.audioContext.createMediaElementSource(audio); source.connect(this.analyser); this.mediaSources.set(audio, source); return true; }
    catch {
      this.analysisFailed = true;
      if (source) { try { source.connect(this.audioContext.destination); this.mediaSources.set(audio, source); } catch { /* No recovery. */ } }
      return false;
    }
  }

  readFrequencyData(target: Uint8Array<ArrayBuffer>): boolean {
    if (!this.analyser || this.audioContext?.state !== 'running' || target.length < this.analyser.frequencyBinCount) return false;
    this.analyser.getByteFrequencyData(target); return true;
  }

  dispose(): void {
    this.loadSequence++; this.cancelPreparedNext(); this.finishFade(); this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load();
    for (const source of this.mediaSources.values()) { try { source.disconnect(); } catch { /* Already disconnected. */ } }
    this.mediaSources.clear(); try { this.analyser?.disconnect(); } catch { /* Already disconnected. */ }
    if (this.audioContext) void this.audioContext.close().catch(() => undefined);
    this.audioContext = null; this.analyser = null; this.currentTrack = null; this.analysisFailed = false; this.standby = null;
    this.audio = new Audio(); this.configureAudio(this.audio);
    void this.applySink(this.audio, this.activeOutputId ?? SYSTEM_DEFAULT_OUTPUT_ID).catch(() => undefined);
    this.state.next({ state: 'idle', track: null });
  }

  private emitState(state: PlaybackStateEvent['state']): void { this.state.next({ state, track: this.currentTrack }); }
  private emitTime(): void { this.time.next({ currentTime: Number.isFinite(this.audio.currentTime) ? this.audio.currentTime : 0, duration: Number.isFinite(this.audio.duration) ? this.audio.duration : (this.currentTrack?.duration ?? 0) }); }
}

function mediaErrorCode(code: number | undefined): PlaybackErrorCode {
  if (code === MediaError.MEDIA_ERR_ABORTED) return 'MEDIA_ABORTED';
  if (code === MediaError.MEDIA_ERR_NETWORK) return 'MEDIA_NETWORK';
  if (code === MediaError.MEDIA_ERR_DECODE) return 'MEDIA_DECODE';
  if (code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) return 'MEDIA_UNSUPPORTED';
  return 'MEDIA_UNKNOWN';
}

function mediaErrorMessage(code: PlaybackErrorCode): string {
  switch (code) {
    case 'MEDIA_ABORTED': return 'Audio loading was interrupted.';
    case 'MEDIA_NETWORK': return 'The audio file could not be read.';
    case 'MEDIA_DECODE': return 'The audio file is damaged or could not be decoded.';
    case 'MEDIA_UNSUPPORTED': return 'This audio format is not supported by the current engine.';
    default: return 'The audio file could not be played.';
  }
}

function playbackError(code: PlaybackErrorCode, message: string): Error & { code: PlaybackErrorCode } { return Object.assign(new Error(message), { code }); }

function outputActivationError(error: unknown): Error & { code: PlaybackErrorCode } {
  const name = error instanceof DOMException ? error.name : error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return playbackError('OUTPUT_DEVICE_PERMISSION_DENIED', 'Chromium denied permission to use this audio output. Restart Lutstra and try again.');
  }
  if (name === 'NotFoundError') {
    return playbackError('OUTPUT_DEVICE_UNAVAILABLE', 'The selected audio endpoint is no longer available.');
  }
  return playbackError('OUTPUT_DEVICE_UNAVAILABLE', 'The selected audio output could not be activated.');
}
