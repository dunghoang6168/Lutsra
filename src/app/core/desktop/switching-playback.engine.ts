import { BehaviorSubject, Observable, Subject, Subscription } from 'rxjs';
import type { AudioAnalysisEngine, PlaybackEngine } from '../contracts';
import type { AudioEngineBackend, AudioOutputDevice, AudioPathStatus, OutputMode, PlaybackStateEvent, PlaybackTimeEvent, PlaybackVolumeEvent, Track } from '../models';

export class SwitchingPlaybackEngine implements PlaybackEngine, AudioAnalysisEngine {
  private backend: AudioEngineBackend = 'chromium';
  private volume = 0.8;
  private muted = false;
  private fallbackEnabled = false;
  private analysisRequested = false;
  private subscriptions = new Subscription();
  private readonly stateSubject = new BehaviorSubject<PlaybackStateEvent>({ state: 'idle', track: null });
  private readonly timeSubject = new Subject<PlaybackTimeEvent>();
  private readonly volumeSubject = new BehaviorSubject<PlaybackVolumeEvent>({ volume: 0.8, isMuted: false });
  private readonly interruptionSubject = new Subject<'device-invalidated' | 'device-busy'>();
  private readonly autoAdvanceSubject = new Subject<Track>();
  readonly stateChange$: Observable<PlaybackStateEvent> = this.stateSubject.asObservable();
  readonly timeUpdate$: Observable<PlaybackTimeEvent> = this.timeSubject.asObservable();
  readonly volumeChange$: Observable<PlaybackVolumeEvent> = this.volumeSubject.asObservable();
  readonly outputInterrupted$: Observable<'device-invalidated' | 'device-busy'> = this.interruptionSubject.asObservable();
  readonly trackAutoAdvanced$: Observable<Track> = this.autoAdvanceSubject.asObservable();

  constructor(
    private readonly chromium: PlaybackEngine & AudioAnalysisEngine,
    private readonly native: PlaybackEngine & AudioAnalysisEngine,
  ) { this.bindActiveEngine(); }

  get isAnalysisSupported(): boolean { return this.activeAnalysis.isAnalysisSupported; }
  getBackend(): AudioEngineBackend { return this.backend; }
  async setBackend(backend: AudioEngineBackend): Promise<void> {
    if (backend === this.backend) return;
    this.active.pause();
    await (backend === 'native-shared' ? this.native : this.chromium).setBackend(backend);
    this.backend = backend;
    this.bindActiveEngine();
    this.active.setVolume(this.volume);
    this.active.setMute(this.muted);
    // Settings restore runs before the saved backend is activated; re-apply here.
    this.active.setOutputFallbackEnabled(this.fallbackEnabled);
    if (this.analysisRequested) await this.activeAnalysis.prepareFrequencyAnalysis();
  }
  load(track: Track): Promise<void> { return this.active.load(track); }
  play(): Promise<void> { return this.active.play(); }
  pause(): void { this.active.pause(); }
  seek(seconds: number): void { this.active.seek(seconds); }
  setVolume(volume: number): void { this.volume = volume; this.active.setVolume(volume); }
  setMute(muted: boolean): void { this.muted = muted; this.active.setMute(muted); }
  prepareNext(track: Track): Promise<boolean> { return this.active.prepareNext(track); }
  cancelPreparedNext(): void { this.active.cancelPreparedNext(); }
  transitionTo(track: Track, seconds: number): Promise<boolean> { return this.active.transitionTo(track, seconds); }
  listOutputDevices(): Promise<AudioOutputDevice[]> { return this.active.listOutputDevices(); }
  selectOutputDevice(deviceId: string): Promise<void> { return this.active.selectOutputDevice(deviceId); }
  setOutputFallbackEnabled(enabled: boolean): void { this.fallbackEnabled = enabled; this.active.setOutputFallbackEnabled(enabled); }
  setOutputMode(mode: OutputMode): Promise<void> { return this.active.setOutputMode(mode); }
  getAudioPathStatus(): Promise<AudioPathStatus> { return this.active.getAudioPathStatus(); }
  subscribeDeviceChanges(listener: () => void): () => void {
    const removeChromium = this.chromium.subscribeDeviceChanges(() => { if (this.backend === 'chromium') listener(); });
    const removeNative = this.native.subscribeDeviceChanges(() => { if (this.backend === 'native-shared') listener(); });
    return () => { removeChromium(); removeNative(); };
  }
  prepareFrequencyAnalysis(): Promise<number> { this.analysisRequested = true; return this.activeAnalysis.prepareFrequencyAnalysis(); }
  readFrequencyData(target: Uint8Array<ArrayBuffer>): boolean { return this.activeAnalysis.readFrequencyData(target); }
  dispose(): void { this.subscriptions.unsubscribe(); this.chromium.dispose(); this.native.dispose(); }

  private get active(): PlaybackEngine { return this.backend === 'native-shared' ? this.native : this.chromium; }
  private get activeAnalysis(): AudioAnalysisEngine { return this.backend === 'native-shared' ? this.native : this.chromium; }
  private bindActiveEngine(): void {
    this.subscriptions.unsubscribe();
    this.subscriptions = new Subscription();
    this.subscriptions.add(this.active.stateChange$.subscribe((value) => this.stateSubject.next(value)));
    this.subscriptions.add(this.active.timeUpdate$.subscribe((value) => this.timeSubject.next(value)));
    this.subscriptions.add(this.active.volumeChange$.subscribe((value) => this.volumeSubject.next(value)));
    const interrupted = this.active.outputInterrupted$;
    if (interrupted)
      this.subscriptions.add(interrupted.subscribe((reason) => this.interruptionSubject.next(reason)));
    const advanced = this.active.trackAutoAdvanced$;
    if (advanced)
      this.subscriptions.add(advanced.subscribe((track) => this.autoAdvanceSubject.next(track)));
  }
}
