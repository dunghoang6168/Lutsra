import { NgZone } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import type { AudioAnalysisEngine, PlaybackEngine } from '../contracts';
import type { AudioHostState, AudioOutputDevice, AudioPathStatus, OutputMode, PlaybackStateEvent, PlaybackTimeEvent, PlaybackVolumeEvent, Track } from '../models';
import { getDesktopApi, type NativeAudioHostEvent } from './desktop-api';

// Matches the host: 1024 bins on a fixed 0..24 kHz axis, like the Chromium analyser.
const SPECTRUM_BINS = 1024;

export class NativeAudioPlaybackEngine implements PlaybackEngine, AudioAnalysisEngine {
  private readonly api = getDesktopApi()?.audioHost;
  private currentTrack: Track | null = null;
  private preparedTrack: Track | null = null;
  private spectrum = new Uint8Array(SPECTRUM_BINS);
  private hostState: AudioHostState = 'stopped';
  private operationSequence = 0;
  private pendingTransition: {
    track: Track;
    resolve: (completed: boolean) => void;
    timeout: ReturnType<typeof setTimeout>;
  } | null = null;
  private readonly deviceListeners = new Set<() => void>();
  private readonly stateSubject = new BehaviorSubject<PlaybackStateEvent>({ state: 'idle', track: null });
  private readonly timeSubject = new Subject<PlaybackTimeEvent>();
  private readonly volumeSubject = new BehaviorSubject<PlaybackVolumeEvent>({ volume: 0.8, isMuted: false });
  private readonly interruptionSubject = new Subject<'device-invalidated' | 'device-busy'>();
  private readonly autoAdvanceSubject = new Subject<Track>();
  private readonly removeEventListener: () => void;
  private readonly removeStateListener: () => void;

  readonly isAnalysisSupported = true;
  readonly stateChange$: Observable<PlaybackStateEvent> = this.stateSubject.asObservable();
  readonly timeUpdate$: Observable<PlaybackTimeEvent> = this.timeSubject.asObservable();
  readonly volumeChange$: Observable<PlaybackVolumeEvent> = this.volumeSubject.asObservable();
  readonly outputInterrupted$: Observable<'device-invalidated' | 'device-busy'> = this.interruptionSubject.asObservable();
  readonly trackAutoAdvanced$: Observable<Track> = this.autoAdvanceSubject.asObservable();

  constructor(private readonly zone: NgZone) {
    if (!this.api) throw new Error('Native Audio Host bridge is unavailable.');
    this.removeEventListener = this.api.onEvent((event) => this.handleEvent(event));
    this.removeStateListener = this.api.onStateChange((state) => {
      this.zone.run(() => {
        this.hostState = state;
        if (state !== 'ready') this.settlePendingTransition(false);
        if (state === 'failed') {
          this.stateSubject.next({
            state: 'error', track: this.currentTrack,
            error: { code: 'AUDIO_HOST_UNAVAILABLE', message: 'Native Audio Host stopped after recovery failed.', trackId: this.currentTrack?.id },
          });
        }
        if (state === 'ready') for (const listener of this.deviceListeners) listener();
      });
    });
  }

  async load(track: Track): Promise<void> {
    this.operationSequence++;
    this.settlePendingTransition(false);
    this.currentTrack = track;
    this.preparedTrack = null;
    this.stateSubject.next({ state: 'loading', track });
    await this.api!.load(track.id);
  }
  async play(): Promise<void> { await this.api!.play(); }
  pause(): void { void this.api!.pause(); }
  seek(positionSeconds: number): void { void this.api!.seek(Math.max(0, positionSeconds)); }
  setVolume(volume: number): void {
    const value = Math.max(0, Math.min(1, volume));
    void this.api!.setVolume(value);
    this.volumeSubject.next({ ...this.volumeSubject.value, volume: value });
  }
  setMute(isMuted: boolean): void {
    void this.api!.setMute(isMuted);
    this.volumeSubject.next({ ...this.volumeSubject.value, isMuted });
  }
  async prepareNext(track: Track): Promise<boolean> {
    const sequence = this.operationSequence;
    const prepared = await this.api!.prepare(track.id);
    if (sequence !== this.operationSequence) return false;
    this.preparedTrack = prepared ? track : null;
    return prepared;
  }
  cancelPreparedNext(): void {
    this.operationSequence++;
    this.settlePendingTransition(false);
    this.preparedTrack = null;
    void this.api!.cancelPrepared();
  }
  async transitionTo(track: Track, crossfadeSeconds: number): Promise<boolean> {
    const sequence = this.operationSequence;
    if (this.preparedTrack?.id !== track.id && !(await this.prepareNext(track))) return false;
    if (sequence !== this.operationSequence || this.preparedTrack?.id !== track.id) return false;
    const seconds = Math.max(0, Math.min(12, crossfadeSeconds));
    this.settlePendingTransition(false);
    const completion = new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        if (this.pendingTransition?.track.id === track.id) this.settlePendingTransition(false);
      }, (seconds + 2) * 1000);
      this.pendingTransition = { track, resolve, timeout };
    });
    try {
      if (!(await this.api!.transition(seconds))) this.settlePendingTransition(false);
    } catch {
      this.settlePendingTransition(false);
    }
    return completion;
  }
  listOutputDevices(): Promise<AudioOutputDevice[]> { return this.api!.listDevices(); }
  selectOutputDevice(deviceId: string): Promise<void> { return this.api!.selectDevice(deviceId); }
  setOutputFallbackEnabled(enabled: boolean): void { void this.api!.setFallbackEnabled(enabled); }
  async setOutputMode(mode: OutputMode, bufferMs = 20): Promise<void> {
    if (mode === 'exclusive-bitperfect') throw Object.assign(new Error('Bit-perfect mode is not available yet.'), { code: 'OUTPUT_MODE_UNSUPPORTED' });
    await this.api!.setOutputMode(mode, bufferMs);
  }
  getAudioPathStatus(): Promise<AudioPathStatus> { return this.api!.getPathStatus(); }
  subscribeDeviceChanges(listener: () => void): () => void { this.deviceListeners.add(listener); return () => this.deviceListeners.delete(listener); }
  getBackend(): 'native-shared' { return 'native-shared'; }
  async setBackend(backend: 'chromium' | 'native-shared'): Promise<void> {
    if (backend !== 'native-shared') throw new Error('Backend switching is owned by the playback facade.');
    await this.api!.start();
  }
  async prepareFrequencyAnalysis(): Promise<number> { await this.api!.setSpectrumEnabled(true); return SPECTRUM_BINS; }
  readFrequencyData(target: Uint8Array<ArrayBuffer>): boolean {
    if (target.length === 0 || this.spectrum.length === 0) return false;
    for (let index = 0; index < target.length; index++) target[index] = this.spectrum[Math.min(SPECTRUM_BINS - 1, Math.floor(index * SPECTRUM_BINS / target.length))];
    return true;
  }
  dispose(): void {
    this.operationSequence++;
    this.settlePendingTransition(false);
    this.removeEventListener();
    this.removeStateListener();
    void this.api!.setSpectrumEnabled(false);
    this.stateSubject.complete(); this.timeSubject.complete(); this.volumeSubject.complete();
    this.interruptionSubject.complete();
    this.autoAdvanceSubject.complete();
  }

  private handleEvent(event: NativeAudioHostEvent): void {
    if (event.kind === 'spectrum') {
      this.spectrum = Uint8Array.from(event.bins.slice(0, SPECTRUM_BINS).map((value) => Math.max(0, Math.min(255, value))));
      return;
    }
    this.zone.run(() => {
      if (event.kind === 'state') {
        const trackId = event.value.trackId;
        const transition = this.pendingTransition;
        if (event.value.state === 'playing' && trackId && transition?.track.id === trackId) {
          this.currentTrack = transition.track;
          this.preparedTrack = null;
          this.settlePendingTransition(true);
        } else if (event.value.state === 'playing' && trackId && !transition &&
                   this.preparedTrack?.id === trackId && trackId !== this.currentTrack?.id) {
          // The host continued gaplessly into the prepared track without a transition request.
          const track = this.preparedTrack;
          this.currentTrack = track;
          this.preparedTrack = null;
          this.autoAdvanceSubject.next(track);
        }
        if (trackId && trackId !== this.currentTrack?.id) return;
        this.stateSubject.next({ state: event.value.state, track: this.currentTrack, error: event.value.error });
      }
      else if (event.kind === 'time') this.timeSubject.next(event.value);
      else if (event.kind === 'volume') this.volumeSubject.next(event.value);
      else if (event.kind === 'output-interrupted') this.interruptionSubject.next(event.value.reason);
      else if (event.kind === 'devices-changed') for (const listener of this.deviceListeners) listener();
    });
  }

  private settlePendingTransition(completed: boolean): void {
    const pending = this.pendingTransition;
    if (!pending) return;
    this.pendingTransition = null;
    clearTimeout(pending.timeout);
    pending.resolve(completed);
  }
}
