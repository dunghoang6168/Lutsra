import { Injectable, inject, signal, computed, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { LIBRARY_GATEWAY, PLAYBACK_ENGINE, SETTINGS_GATEWAY } from '../contracts';
import { AudioEngineBackend, AudioOutputDevice, AudioPathStatus, PlaybackError, PlaybackState, QueueEntry, RepeatMode, Settings, SYSTEM_DEFAULT_OUTPUT_ID, Track } from '../models';
import { getDesktopApi } from '../desktop/desktop-api';
import { logPlaybackDiagnostic } from './playback-diagnostics';
import { nextPlayableQueueIndex } from './playback-policy';

export interface QueueAddResult {
  addedCount: number;
  skippedCount: number;
}

export interface QueueSnapshot {
  queue: QueueEntry[];
  originalQueue: QueueEntry[];
  currentIndex: number;
  isShuffle: boolean;
}

function normalizePlaybackFailure(error: unknown, trackId?: string): PlaybackError {
  const rawCode = typeof error === 'object' && error !== null && 'code' in error ? (error as { code?: unknown }).code : undefined;
  const codes: PlaybackError['code'][] = [
    'FILE_UNAVAILABLE', 'MEDIA_ABORTED', 'MEDIA_NETWORK', 'MEDIA_DECODE', 'MEDIA_UNSUPPORTED', 'MEDIA_UNKNOWN',
    'OUTPUT_EXCLUSIVE_NOT_ALLOWED', 'OUTPUT_DEVICE_UNAVAILABLE', 'OUTPUT_DEVICE_BUSY', 'OUTPUT_FORMAT_UNSUPPORTED',
    'OUTPUT_DEVICE_PERMISSION_DENIED', 'OUTPUT_DEVICE_UNSUPPORTED', 'OUTPUT_MODE_UNSUPPORTED',
    'AUDIO_HOST_UNAVAILABLE', 'AUDIO_HOST_PROTOCOL_ERROR', 'PLAYBACK_FAILED',
  ];
  const code: PlaybackError['code'] = typeof rawCode === 'string' && codes.includes(rawCode as PlaybackError['code'])
    ? rawCode as PlaybackError['code'] : 'PLAYBACK_FAILED';
  const knownMessages: Partial<Record<PlaybackError['code'], string>> = {
    FILE_UNAVAILABLE: 'This audio file is no longer available.',
    MEDIA_ABORTED: 'Audio loading was interrupted.',
    MEDIA_NETWORK: 'The audio file could not be read.',
    MEDIA_DECODE: 'The audio file is damaged or could not be decoded.',
    MEDIA_UNSUPPORTED: 'This audio format is not supported by the current engine.',
    OUTPUT_DEVICE_UNAVAILABLE: 'The selected audio output is disconnected.',
    OUTPUT_DEVICE_BUSY: 'The selected audio output is in use. Close the other app and try again.',
    OUTPUT_EXCLUSIVE_NOT_ALLOWED: 'Windows blocks Exclusive mode for this device. Enable it in Sound settings → Device properties → Advanced.',
    OUTPUT_FORMAT_UNSUPPORTED: 'The selected audio output format is not supported.',
    OUTPUT_DEVICE_PERMISSION_DENIED: 'Chromium denied permission to use this audio output. Restart Lutstra and try again.',
    OUTPUT_DEVICE_UNSUPPORTED: 'This runtime cannot select a specific audio output.',
    OUTPUT_MODE_UNSUPPORTED: 'This output mode requires the Native Audio Host.',
    AUDIO_HOST_UNAVAILABLE: 'Native Audio Host is unavailable. Playback has returned to Chromium and remains paused.',
    AUDIO_HOST_PROTOCOL_ERROR: 'Native Audio Host communication failed. Playback has returned to Chromium and remains paused.',
    PLAYBACK_FAILED: 'The audio file could not be played.',
  };
  return { code, message: knownMessages[code] ?? 'The audio file could not be played.', trackId };
}

@Injectable({ providedIn: 'root' })
export class PlayerService implements OnDestroy {
  private readonly engine = inject(PLAYBACK_ENGINE);
  private readonly settingsGateway = inject(SETTINGS_GATEWAY, { optional: true });
  private readonly libraryGateway = inject(LIBRARY_GATEWAY, { optional: true });
  private readonly subscriptions = new Subscription();
  private restoringSettings = false;
  private volumeSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private outputInterrupted = false;

  // Internal Request Counter for handling overlapping load requests
  private loadSequence = 0;
  private libraryRefreshVersion = 0;
  private preparedCandidateId: string | null = null;
  private preparationReady = false;
  private transitioning = false;
  private recoveringFromFailure = false;
  private readonly failedEntryIds = new Set<string>();
  private suspendSnapshot: { entryId: string; position: number; shouldResume: boolean } | null = null;
  private readonly playRequested = signal(false);

  // Primary Signals
  readonly currentTrack = signal<Track | null>(null);
  readonly queue = signal<QueueEntry[]>([]);
  readonly currentIndex = signal<number>(-1);
  readonly playbackState = signal<PlaybackState>('idle');
  readonly currentTime = signal<number>(0);
  readonly duration = signal<number>(0);
  readonly volume = signal<number>(0.8);
  readonly isMuted = signal<boolean>(false);
  readonly repeatMode = signal<RepeatMode>('off');
  readonly isShuffle = signal<boolean>(false);
  readonly crossfadeEnabled = signal<boolean>(true);
  readonly crossfadeSeconds = signal<number>(5);
  readonly error = signal<string | null>(null);
  readonly playbackNotice = signal<string | null>(null);
  readonly outputDevices = signal<AudioOutputDevice[]>([]);
  readonly audioPathStatus = signal<AudioPathStatus | null>(null);
  readonly audioEngineBackend = signal<AudioEngineBackend>('chromium');
  readonly preferredAudioOutputId = signal<string>(SYSTEM_DEFAULT_OUTPUT_ID);
  readonly preferredAudioOutputName = signal<string>('System Default');
  private readonly preferredChromiumOutputId = signal<string>(SYSTEM_DEFAULT_OUTPUT_ID);
  private readonly preferredChromiumOutputName = signal<string>('System Default');
  private readonly preferredNativeOutputId = signal<string>(SYSTEM_DEFAULT_OUTPUT_ID);
  private readonly preferredNativeOutputName = signal<string>('System Default');
  readonly outputMode = signal<'shared' | 'exclusive-dsp'>('shared');
  readonly exclusiveBufferMs = signal(20);
  readonly exclusiveModeDisabledReason = computed(() => {
    if (this.audioEngineBackend() !== 'native-shared') return 'Exclusive requires Native Shared.';
    const device = this.outputDevices().find(d => d.id === this.preferredAudioOutputId());
    return device?.supportedModes.includes('exclusive-dsp') ? null : 'The selected device does not report Exclusive support.';
  });
  readonly audioOutputFallbackEnabled = signal<boolean>(false);

  // Original queue before shuffle was toggled on
  private originalQueue: QueueEntry[] = [];

  // Derived Computed Signals
  readonly isPlaying = computed(() => this.playbackState() === 'playing');
  readonly isLoading = computed(() => this.playbackState() === 'loading');
  readonly isPlaybackActive = computed(() => this.isPlaying() || this.playbackState() === 'buffering' || (this.isLoading() && this.playRequested()));

  readonly currentQueueEntry = computed<QueueEntry | null>(() => {
    const q = this.queue();
    const idx = this.currentIndex();
    return idx >= 0 && idx < q.length ? q[idx] : null;
  });

  readonly progressPercent = computed<number>(() => {
    const d = this.duration();
    const c = this.currentTime();
    return d > 0 ? Math.min(100, Math.max(0, (c / d) * 100)) : 0;
  });

  constructor() {
    this.initEngineListeners();
    this.subscriptions.add(this.engine.subscribeDeviceChanges(() => void this.handleOutputDevicesChanged()));
    const interrupted = this.engine.outputInterrupted$;
    if (interrupted) {
      this.subscriptions.add(interrupted.subscribe((reason) => {
        this.outputInterrupted = true;
        this.playbackNotice.set(reason === 'device-busy'
          ? 'The selected audio output is in use. Playback has been paused.'
          : 'The audio output was interrupted. Lutstra is reconnecting.');
      }));
    }
    const advanced = this.engine.trackAutoAdvanced$;
    if (advanced) this.subscriptions.add(advanced.subscribe((track) => this.handleTrackAutoAdvanced(track)));
    const lifecycle = getDesktopApi()?.appLifecycle;
    if (lifecycle) {
      this.subscriptions.add(lifecycle.onSuspend(() => this.handleSuspend()));
      this.subscriptions.add(lifecycle.onResume(() => void this.handleResume()));
    }
    this.loadSavedSettings();
    let wasScanning = false;
    if (this.libraryGateway) this.subscriptions.add(this.libraryGateway.scanProgress$.subscribe((progress) => {
      const justFinished = wasScanning && !progress.isScanning;
      wasScanning = progress.isScanning;
      if (justFinished) void this.refreshArtwork();
    }));
    if (this.libraryGateway?.libraryChanged$) {
      this.subscriptions.add(this.libraryGateway.libraryChanged$.subscribe(() => void this.reconcileLibrary()));
    }
  }

  private async reconcileLibrary(): Promise<void> {
    if (!this.libraryGateway) return;
    const version = ++this.libraryRefreshVersion;
    try {
      const tracks = new Map((await this.libraryGateway.getLibrary()).tracks.map((track) => [track.id, track]));
      if (version !== this.libraryRefreshVersion) return;
      const currentEntry = this.currentQueueEntry();
      const previousIndex = this.currentIndex();
      const shouldContinue = this.isPlaybackActive();
      const keep = (entry: QueueEntry): QueueEntry | null => {
        const track = tracks.get(entry.track.id);
        return track ? { ...entry, track } : null;
      };
      const nextQueue = this.queue().flatMap((entry) => keep(entry) ?? []);
      this.originalQueue = this.originalQueue.flatMap((entry) => keep(entry) ?? []);
      this.queue.set(nextQueue);
      this.failedEntryIds.clear();
      const currentIndex = currentEntry ? nextQueue.findIndex((entry) => entry.id === currentEntry.id) : -1;
      if (currentEntry && currentIndex < 0) {
        this.loadSequence++;
        this.clearPreparedCandidate();
        this.engine.dispose();
        this.currentTime.set(0);
        this.duration.set(0);
        const replacementIndex = nextQueue.length ? Math.min(Math.max(previousIndex, 0), nextQueue.length - 1) : -1;
        this.currentIndex.set(replacementIndex);
        if (replacementIndex >= 0) {
          this.playbackNotice.set('The current track is no longer available. Moving to the next available track.');
          if (shouldContinue) await this.loadAndPlayCurrent();
          else await this.loadCurrentPaused();
        } else {
          this.playRequested.set(false);
          this.currentTrack.set(null);
          this.error.set(null);
          this.playbackState.set('idle');
        }
      } else if (currentIndex >= 0) {
        this.currentTrack.set(nextQueue[currentIndex].track);
        this.currentIndex.set(currentIndex);
        this.refreshPreparedCandidate();
      }
    } catch (error) {
      logPlaybackDiagnostic('error', { operation: 'transition', errorCode: 'PLAYBACK_FAILED' });
    }
  }

  private async refreshArtwork(): Promise<void> {
    if (!this.libraryGateway) return;
    try {
      const artworkById = new Map((await this.libraryGateway.getLibrary()).tracks.map((track) => [track.id, track.artwork]));
      const updateEntry = (entry: QueueEntry): QueueEntry => artworkById.has(entry.track.id)
        ? { ...entry, track: { ...entry.track, artwork: artworkById.get(entry.track.id) ?? null } } : entry;
      this.queue.update((entries) => entries.map(updateEntry));
      this.originalQueue = this.originalQueue.map(updateEntry);
      this.currentTrack.update((track) => track && artworkById.has(track.id)
        ? { ...track, artwork: artworkById.get(track.id) ?? null } : track);
    } catch { /* A scan refresh must not interrupt playback. */ }
  }

  ngOnDestroy(): void {
    this.loadSequence++;
    if (this.volumeSaveTimer) clearTimeout(this.volumeSaveTimer);
    this.subscriptions.unsubscribe();
    this.engine.dispose();
  }

  async loadSavedSettings(): Promise<void> {
    if (!this.settingsGateway) return;
    try {
      this.restoringSettings = true;
      const settings = await this.settingsGateway.getSettings();
      if (settings) {
        if (typeof settings.defaultVolume === 'number') {
          this.setVolume(settings.defaultVolume);
        }
        if (settings.repeatMode) {
          this.setRepeatMode(settings.repeatMode);
        }
        if (typeof settings.shuffle === 'boolean') {
          this.setShuffle(settings.shuffle);
        }
        if (typeof settings.crossfadeEnabled === 'boolean') this.setCrossfadeEnabled(settings.crossfadeEnabled);
        if (Number.isInteger(settings.crossfadeSeconds)) this.setCrossfadeSeconds(settings.crossfadeSeconds);
        this.outputMode.set(settings.outputMode === 'exclusive-dsp' ? 'exclusive-dsp' : 'shared');
        this.exclusiveBufferMs.set([10,20,40,80].includes(settings.exclusiveBufferMs) ? settings.exclusiveBufferMs : 20);
        this.audioOutputFallbackEnabled.set(settings.audioOutputFallbackEnabled === true);
        this.engine.setOutputFallbackEnabled(settings.audioOutputFallbackEnabled === true);
        this.preferredChromiumOutputId.set(settings.preferredAudioOutputId || SYSTEM_DEFAULT_OUTPUT_ID);
        this.preferredChromiumOutputName.set(settings.preferredAudioOutputName || 'System Default');
        this.preferredNativeOutputId.set(settings.preferredNativeAudioOutputId || SYSTEM_DEFAULT_OUTPUT_ID);
        this.preferredNativeOutputName.set(settings.preferredNativeAudioOutputName || 'System Default');
        try { await this.engine.setBackend(settings.audioEngineBackend === 'native-shared' ? 'native-shared' : 'chromium'); }
        catch {
          await this.engine.setBackend('chromium');
          this.playbackNotice.set('Native Audio Host is unavailable. Chromium Shared remains active.');
        }
        this.audioEngineBackend.set(this.engine.getBackend());
        await this.restoreOutputMode();
        await this.syncNativeMediaKeys();
        if (this.audioEngineBackend() === 'native-shared') await this.migrateNativeDeviceByUniqueName();
        this.syncPreferredOutputSignals();
        try {
          await this.engine.selectOutputDevice(this.preferredAudioOutputId());
        } catch {
          this.playbackNotice.set('The preferred audio output is currently unavailable.');
        }
        await this.refreshAudioOutputState();
      }
    } catch {
      // Retain default values
    } finally {
      this.restoringSettings = false;
    }
  }

  private initEngineListeners(): void {
    // 1. State change stream
    this.subscriptions.add(
      this.engine.stateChange$.subscribe((evt) => {
        // Late arrival check: if queue is empty and no current track, stay idle
        if (this.queue().length === 0 && !this.currentTrack()) {
          this.playbackState.set('idle');
          return;
        }

        this.playbackState.set(evt.state);
        if (evt.error) {
          this.playRequested.set(false);
          this.error.set(evt.error.message);
          if (evt.error.code === 'OUTPUT_DEVICE_UNAVAILABLE' || evt.error.code === 'OUTPUT_DEVICE_BUSY')
            this.outputInterrupted = false;
          if (evt.error.code === 'AUDIO_HOST_UNAVAILABLE' || evt.error.code === 'AUDIO_HOST_PROTOCOL_ERROR') void this.recoverFromNativeHostFailure(evt.error);
          else void this.handlePlaybackFailure(evt.error);
        } else if (evt.state === 'playing') {
          this.error.set(null);
          if (this.outputInterrupted) {
            this.outputInterrupted = false;
            this.playbackNotice.set(null);
          }
          this.refreshPreparedCandidate();
        }

        if (evt.state === 'playing' || evt.state === 'paused') void this.refreshAudioOutputState().catch(() => undefined);
        if (evt.state === 'ended') {
          this.handleTrackEnded();
        }
      })
    );

    // 2. Time update stream
    this.subscriptions.add(
      this.engine.timeUpdate$.subscribe((evt) => {
        if (this.queue().length === 0 && !this.currentTrack()) {
          this.currentTime.set(0);
          this.duration.set(0);
          return;
        }
        this.currentTime.set(evt.currentTime);
        this.duration.set(evt.duration);
        this.refreshPreparedCandidate();
        this.maybeStartCrossfade(evt.currentTime, evt.duration);
      })
    );

    // 3. Volume change stream
    this.subscriptions.add(
      this.engine.volumeChange$.subscribe((evt) => {
        this.volume.set(evt.volume);
        this.isMuted.set(evt.isMuted);
        if (this.audioEngineBackend() === 'native-shared') {
          void this.engine.getAudioPathStatus().then(status => {
            if (this.audioEngineBackend() === 'native-shared') this.audioPathStatus.set(status);
          }).catch(() => undefined);
        }
      })
    );
  }

  // ==========================================
  // Queue & Playback Initialization
  // ==========================================

  /**
   * Starts playing a track from a collection.
   * Replaces queue with a fresh copy of the collection with unique entry IDs.
   */
  async playCollection(tracks: Track[], startIndex: number = 0): Promise<void> {
    if (!tracks || tracks.length === 0) {
      return;
    }

    const safeIndex = Math.max(0, Math.min(startIndex, tracks.length - 1));
    const entries = this.createQueueEntries(tracks);
    this.failedEntryIds.clear();

    this.originalQueue = [...entries];

    if (this.isShuffle()) {
      const selected = entries[safeIndex];
      const others = entries.filter((_, idx) => idx !== safeIndex);
      const shuffledOthers = this.shuffleArray(others);
      const newQueue = [selected, ...shuffledOthers];
      this.queue.set(newQueue);
      this.currentIndex.set(0);
    } else {
      this.queue.set(entries);
      this.currentIndex.set(safeIndex);
    }

    await this.loadAndPlayCurrent();
  }

  /**
   * Play an individual track. If queue is empty, creates a single-track queue.
   * If already in queue, jumps to it. Otherwise appends to queue and plays it.
   */
  async playTrack(track: Track): Promise<void> {
    const q = this.queue();
    const existingIndex = q.findIndex((e) => e.track.id === track.id);

    if (existingIndex >= 0) {
      this.failedEntryIds.delete(q[existingIndex].id);
      this.currentIndex.set(existingIndex);
      await this.loadAndPlayCurrent();
      return;
    }

    const newEntry = this.createQueueEntry(track, q.length);
    this.queue.update((current) => [...current, newEntry]);
    this.originalQueue.push(newEntry);
    this.currentIndex.set(this.queue().length - 1);
    await this.loadAndPlayCurrent();
  }

  // ==========================================
  // Transport Controls
  // ==========================================

  async togglePlayPause(): Promise<void> {
    if (!this.currentTrack()) {
      const q = this.queue();
      if (q.length > 0) {
        this.currentIndex.set(0);
        await this.loadAndPlayCurrent();
      }
      return;
    }

    if (this.isPlaybackActive()) {
      this.pause();
    } else {
      await this.play();
    }
  }

  async play(): Promise<void> {
    if (this.isPlaybackActive()) return;

    if (!this.currentTrack()) {
      const q = this.queue();
      if (q.length === 0) return;
      this.currentIndex.set(0);
      await this.loadAndPlayCurrent();
      return;
    }

    this.playRequested.set(true);
    try {
      await this.engine.play();
    } catch (error) {
      this.playRequested.set(false);
      const failure = normalizePlaybackFailure(error, this.currentTrack()?.id);
      this.error.set(failure.message);
      await this.handlePlaybackFailure(failure);
    }
  }

  pause(): void {
    if (!this.isPlaybackActive()) return;
    this.playRequested.set(false);
    this.engine.pause();
    if (this.playbackState() === 'loading') this.playbackState.set('paused');
  }

  seek(positionSeconds: number): void {
    if (!Number.isFinite(positionSeconds)) return;
    const duration = this.duration();
    const upperBound = Number.isFinite(duration) && duration > 0 ? duration : Number.POSITIVE_INFINITY;
    this.engine.seek(Math.max(0, Math.min(positionSeconds, upperBound)));
  }

  seekBy(offsetSeconds: number): void {
    if (!Number.isFinite(offsetSeconds)) return;
    this.seek(this.currentTime() + offsetSeconds);
  }

  stop(): void {
    this.pause();
    if (this.currentTrack()) this.seek(0);
  }

  setVolume(newVolume: number): void {
    const clamped = Math.max(0, Math.min(1, newVolume));
    this.engine.setVolume(clamped);
    if (this.isMuted() && clamped > 0) {
      this.engine.setMute(false);
    }
    if (!this.restoringSettings) {
      if (this.volumeSaveTimer) clearTimeout(this.volumeSaveTimer);
      this.volumeSaveTimer = setTimeout(() => void this.persistSettings({ defaultVolume: clamped }), 250);
    }
  }

  toggleMute(): void {
    const nextMuted = !this.isMuted();
    this.engine.setMute(nextMuted);
  }

  setRepeatMode(mode: RepeatMode): void {
    this.repeatMode.set(mode);
    this.refreshPreparedCandidate();
    if (!this.restoringSettings) void this.persistSettings({ repeatMode: mode });
  }

  cycleRepeatMode(): void {
    const current = this.repeatMode();
    if (current === 'off') {
      this.setRepeatMode('all');
    } else if (current === 'all') {
      this.setRepeatMode('one');
    } else {
      this.setRepeatMode('off');
    }
  }

  setShuffle(enabled: boolean): void {
    if (this.isShuffle() !== enabled) {
      this.toggleShuffle();
    }
  }

  toggleShuffle(): void {
    const nextShuffle = !this.isShuffle();
    this.isShuffle.set(nextShuffle);
    if (!this.restoringSettings) void this.persistSettings({ shuffle: nextShuffle });

    const q = this.queue();
    const currentEntry = this.currentQueueEntry();

    if (nextShuffle) {
      // Turn Shuffle ON:
      this.originalQueue = [...q];
      if (currentEntry) {
        const others = q.filter((e) => e.id !== currentEntry.id);
        const shuffled = [currentEntry, ...this.shuffleArray(others)];
        this.queue.set(shuffled);
        this.currentIndex.set(0);
      } else {
        this.queue.set(this.shuffleArray(q));
      }
    } else {
      // Turn Shuffle OFF: restore original order
      if (this.originalQueue.length > 0) {
        this.queue.set([...this.originalQueue]);
        if (currentEntry) {
          const restoredIndex = this.originalQueue.findIndex((e) => e.id === currentEntry.id);
          this.currentIndex.set(restoredIndex >= 0 ? restoredIndex : 0);
        }
      }
    }
    this.refreshPreparedCandidate();
  }

  setCrossfadeEnabled(enabled: boolean): void {
    this.crossfadeEnabled.set(enabled);
    this.refreshPreparedCandidate();
    if (!this.restoringSettings) void this.persistSettings({ crossfadeEnabled: enabled });
  }

  setCrossfadeSeconds(seconds: number): void {
    if (!Number.isInteger(seconds)) return;
    const clamped = Math.max(1, Math.min(12, seconds));
    this.crossfadeSeconds.set(clamped);
    this.refreshPreparedCandidate();
    if (!this.restoringSettings) void this.persistSettings({ crossfadeSeconds: clamped });
  }

  async refreshAudioOutputState(): Promise<void> {
    const [devices, status] = await Promise.all([
      this.engine.listOutputDevices(),
      this.engine.getAudioPathStatus(),
    ]);
    const preferredId = this.preferredAudioOutputId();
    if (preferredId !== SYSTEM_DEFAULT_OUTPUT_ID && !devices.some((device) => device.id === preferredId)) {
      devices.push({
        id: preferredId,
        name: this.preferredAudioOutputName(),
        isDefault: false,
        isConnected: false,
        supportedModes: ['shared'],
        supportedFormats: null,
        mixFormat: null,
      });
    }
    this.outputDevices.set(devices);
    this.audioPathStatus.set({ ...status, preferredDeviceId: preferredId, deviceName: this.preferredAudioOutputName() });
  }

  async selectAudioOutput(deviceId: string): Promise<void> {
    const device = this.outputDevices().find((candidate) => candidate.id === deviceId);
    const previousId = this.preferredAudioOutputId();
    try {
      await this.engine.selectOutputDevice(deviceId);
      this.preferredAudioOutputId.set(deviceId);
      this.preferredAudioOutputName.set(device?.name || (deviceId === SYSTEM_DEFAULT_OUTPUT_ID ? 'System Default' : 'Audio output'));
      this.playbackNotice.set(null);
      if (this.audioEngineBackend() === 'native-shared') {
        this.preferredNativeOutputId.set(this.preferredAudioOutputId());
        this.preferredNativeOutputName.set(this.preferredAudioOutputName());
        await this.persistSettings({ preferredNativeAudioOutputId: this.preferredAudioOutputId(), preferredNativeAudioOutputName: this.preferredAudioOutputName() });
      } else {
        this.preferredChromiumOutputId.set(this.preferredAudioOutputId());
        this.preferredChromiumOutputName.set(this.preferredAudioOutputName());
        await this.persistSettings({ preferredAudioOutputId: this.preferredAudioOutputId(), preferredAudioOutputName: this.preferredAudioOutputName() });
      }
    } catch (error) {
      if (this.audioEngineBackend() !== 'native-shared') {
        try { await this.engine.selectOutputDevice(previousId); } catch { /* Keep playback paused if the previous output also disappeared. */ }
      }
      this.playbackNotice.set(normalizePlaybackFailure(error).message);
    }
    await this.refreshAudioOutputState();
  }

  private async restoreOutputMode(): Promise<void> {
    if (this.audioEngineBackend() === 'native-shared')
      await this.engine.setOutputMode(this.outputMode(), this.exclusiveBufferMs());
    else if (this.outputMode() === 'exclusive-dsp')
      this.playbackNotice.set('Exclusive requires Native Audio Host. Chromium Shared is active; your Exclusive preference is saved.');
  }

  async setAudioOutputMode(mode: 'shared' | 'exclusive-dsp', bufferMs = this.exclusiveBufferMs()): Promise<void> {
    if ((mode === 'exclusive-dsp' && this.exclusiveModeDisabledReason()) || ![10,20,40,80].includes(bufferMs)) return;
    this.clearPreparedCandidate();
    try {
      await this.engine.setOutputMode(mode, bufferMs);
      this.outputMode.set(mode);
      this.exclusiveBufferMs.set(bufferMs);
      await this.persistSettings({ outputMode: mode, exclusiveBufferMs: bufferMs });
      this.playbackNotice.set(null);
      this.refreshPreparedCandidate();
    } catch (error) {
      this.playRequested.set(false);
      this.playbackState.set('paused');
      this.playbackNotice.set(normalizePlaybackFailure(error).message);
    }
    await this.refreshAudioOutputState();
  }

  setAudioOutputFallbackEnabled(enabled: boolean): void {
    this.audioOutputFallbackEnabled.set(enabled);
    this.engine.setOutputFallbackEnabled(enabled);
    void this.persistSettings({ audioOutputFallbackEnabled: enabled });
  }

  async switchAudioBackend(backend: AudioEngineBackend, persist = true): Promise<void> {
    if (backend === this.audioEngineBackend()) return;
    const track = this.currentTrack();
    const position = this.currentTime();
    this.pause();
    this.clearPreparedCandidate();
    try {
      await this.engine.setBackend(backend);
      this.audioEngineBackend.set(backend);
      await this.restoreOutputMode();
      await this.syncNativeMediaKeys();
      if (backend === 'native-shared') await this.migrateNativeDeviceByUniqueName();
      this.syncPreferredOutputSignals();
      this.engine.setOutputFallbackEnabled(this.audioOutputFallbackEnabled());
      await this.engine.selectOutputDevice(this.preferredAudioOutputId());
      if (track) {
        await this.engine.load(track);
        this.engine.seek(position);
        this.playbackState.set('paused');
      }
      if (persist) await this.persistSettings({ audioEngineBackend: backend });
      this.playbackNotice.set(backend === 'native-shared' ? 'Native Audio Host is active. Playback remains paused.' : this.outputMode() === 'exclusive-dsp' ? 'Exclusive requires Native Audio Host. Chromium Shared is active; your Exclusive preference is saved.' : 'Chromium Shared is active. Playback remains paused.');
    } catch (error) {
      const failure = normalizePlaybackFailure(error);
      if (backend === 'native-shared' && (failure.code === 'AUDIO_HOST_UNAVAILABLE' || failure.code === 'AUDIO_HOST_PROTOCOL_ERROR')) {
        await this.engine.setBackend('chromium');
        this.audioEngineBackend.set('chromium');
        await this.syncNativeMediaKeys();
        this.syncPreferredOutputSignals();
      }
      this.playRequested.set(false);
      this.playbackState.set('paused');
      this.playbackNotice.set(this.audioEngineBackend() === 'chromium' && this.outputMode() === 'exclusive-dsp'
        ? 'Exclusive requires Native Audio Host. Chromium Shared is active; your Exclusive preference is saved.' : failure.message);
    }
    await this.refreshAudioOutputState();
  }

  private syncPreferredOutputSignals(): void {
    const native = this.audioEngineBackend() === 'native-shared';
    this.preferredAudioOutputId.set(native ? this.preferredNativeOutputId() : this.preferredChromiumOutputId());
    this.preferredAudioOutputName.set(native ? this.preferredNativeOutputName() : this.preferredChromiumOutputName());
  }

  private async migrateNativeDeviceByUniqueName(): Promise<void> {
    if (this.preferredNativeOutputId() !== SYSTEM_DEFAULT_OUTPUT_ID || this.preferredChromiumOutputId() === SYSTEM_DEFAULT_OUTPUT_ID) return;
    const chromiumName = this.preferredChromiumOutputName().trim();
    const matches = (await this.engine.listOutputDevices()).filter((device) => !device.isDefault && device.isConnected && device.name.trim() === chromiumName);
    if (matches.length === 1) {
      this.preferredNativeOutputId.set(matches[0].id);
      this.preferredNativeOutputName.set(matches[0].name);
      await this.persistSettings({ preferredNativeAudioOutputId: matches[0].id, preferredNativeAudioOutputName: matches[0].name });
    } else if (matches.length > 1) {
      this.playbackNotice.set('More than one native endpoint has the previous device name. Select the WASAPI output again.');
    }
  }

  private async recoverFromNativeHostFailure(error: PlaybackError): Promise<void> {
    if (this.audioEngineBackend() !== 'native-shared') return;
    const position = this.currentTime();
    const track = this.currentTrack();
    try {
      await this.engine.setBackend('chromium');
      this.audioEngineBackend.set('chromium');
      await this.syncNativeMediaKeys();
      this.syncPreferredOutputSignals();
      await this.engine.selectOutputDevice(this.preferredAudioOutputId());
      if (track) { await this.engine.load(track); this.engine.seek(position); this.engine.pause(); }
      await this.persistSettings({ audioEngineBackend: 'chromium' });
    } catch { /* Stay paused and require an explicit output selection. */ }
    this.playbackNotice.set(this.outputMode() === 'exclusive-dsp' ? 'Exclusive requires Native Audio Host. Chromium Shared is active; your Exclusive preference is saved.' : normalizePlaybackFailure(error).message);
    await this.refreshAudioOutputState();
  }

  private async persistSettings(value: Partial<Settings>): Promise<void> {
    if (!this.settingsGateway) return;
    try {
      await this.settingsGateway.saveSettings(value);
    } catch (error) {
      logPlaybackDiagnostic('error', { operation: 'transition', errorCode: 'PLAYBACK_FAILED' });
    }
  }

  private async syncNativeMediaKeys(): Promise<void> {
    try {
      await getDesktopApi()?.mediaKeys?.setNativeActive(this.audioEngineBackend() === 'native-shared');
    } catch {
      // Media keys remain available through Chromium Media Session when supported.
    }
  }

  /**
   * User clicks Next:
   * "Repeat one lặp khi ended; Next vẫn chuyển bài."
   * Skips unavailable tracks. Stops after 1 loop if none playable.
   */
  async next(): Promise<void> {
    const q = this.queue();
    if (q.length === 0) return;

    let nextIndex = this.currentIndex() + 1;

    if (nextIndex >= q.length) {
      if (this.repeatMode() === 'all') {
        nextIndex = 0;
      } else {
        // End of queue in repeat 'off' or 'one'
        this.pause();
        return;
      }
    }

    // Skip unavailable tracks safely (max 1 full loop)
    let attempts = 0;
    while (!this.isEntryPlayable(q[nextIndex]) && attempts < q.length) {
      nextIndex++;
      attempts++;
      if (nextIndex >= q.length) {
        if (this.repeatMode() === 'all') {
          nextIndex = 0;
        } else {
          this.pause();
          return;
        }
      }
    }

    if (attempts >= q.length) {
      this.error.set('No available tracks in queue');
      this.pause();
      return;
    }

    this.currentIndex.set(nextIndex);
    await this.loadAndPlayCurrent();
  }

  /**
   * User clicks Previous:
   * "Previous về đầu bài nếu current time trên 3 giây; nếu không, về bài trước. Ở đầu queue chỉ quay vòng khi repeat all."
   */
  async previous(): Promise<void> {
    const q = this.queue();
    if (q.length === 0) return;

    if (this.currentTime() > 3) {
      this.seek(0);
      return;
    }

    let prevIndex = this.currentIndex() - 1;

    if (prevIndex < 0) {
      if (this.repeatMode() === 'all') {
        prevIndex = q.length - 1;
      } else {
        // At start of queue: restart current track
        this.seek(0);
        return;
      }
    }

    // Skip unavailable tracks backwards
    let attempts = 0;
    while (!this.isEntryPlayable(q[prevIndex]) && attempts < q.length) {
      prevIndex--;
      attempts++;
      if (prevIndex < 0) {
        if (this.repeatMode() === 'all') {
          prevIndex = q.length - 1;
        } else {
          this.seek(0);
          return;
        }
      }
    }

    if (attempts >= q.length) {
      this.error.set('No available tracks in queue');
      return;
    }

    this.currentIndex.set(prevIndex);
    await this.loadAndPlayCurrent();
  }

  // ==========================================
  // Queue Editing Operations
  // ==========================================

  playNext(tracks: Track[]): void {
    if (!tracks || tracks.length === 0) return;

    const newEntries = this.createQueueEntries(tracks);
    const currIdx = this.currentIndex();
    const q = [...this.queue()];

    if (currIdx < 0 || q.length === 0) {
      this.queue.set(newEntries);
      this.originalQueue = [...newEntries];
      this.currentIndex.set(0);
      this.loadAndPlayCurrent();
      return;
    }

    q.splice(currIdx + 1, 0, ...newEntries);
    this.queue.set(q);
    this.originalQueue.push(...newEntries);
    this.refreshPreparedCandidate();
  }

  addToQueue(tracks: Track[]): QueueAddResult {
    if (!tracks || tracks.length === 0) return { addedCount: 0, skippedCount: 0 };

    const availableTracks = tracks.filter((track) => track.isAvailable);
    const result = {
      addedCount: availableTracks.length,
      skippedCount: tracks.length - availableTracks.length,
    };
    if (availableTracks.length === 0) return result;

    const newEntries = this.createQueueEntries(availableTracks);
    const q = this.queue();

    if (q.length === 0) {
      this.queue.set(newEntries);
      this.originalQueue = [...newEntries];
      this.currentIndex.set(0);
      void this.loadCurrentPaused();
      return result;
    }

    this.queue.update((current) => [...current, ...newEntries]);
    this.originalQueue.push(...newEntries);
    this.refreshPreparedCandidate();
    return result;
  }

  removeFromQueue(queueEntryId: string): void {
    const q = this.queue();
    const removeIdx = q.findIndex((e) => e.id === queueEntryId);
    if (removeIdx < 0) return;

    const isRemovingCurrent = removeIdx === this.currentIndex();
    const nextQueue = q.filter((e) => e.id !== queueEntryId);
    this.originalQueue = this.originalQueue.filter((e) => e.id !== queueEntryId);

    if (nextQueue.length === 0) {
      this.clearQueue();
      return;
    }

    this.queue.set(nextQueue);

    if (isRemovingCurrent) {
      // User rule: "Xóa current entry chuyển tới entry kế tiếp; không còn bài thì dừng."
      const nextIdx = removeIdx < nextQueue.length ? removeIdx : 0;
      this.currentIndex.set(nextIdx);
      this.loadAndPlayCurrent();
    } else if (removeIdx < this.currentIndex()) {
      this.currentIndex.update((idx) => idx - 1);
    }
    this.refreshPreparedCandidate();
  }

  moveQueueEntry(sourceId: string, targetId: string, placement: 'before' | 'after'): boolean {
    const current = this.queue();
    const sourceIndex = current.findIndex((entry) => entry.id === sourceId);
    if (sourceIndex < 0 || sourceId === targetId) return false;

    const currentEntryId = this.currentQueueEntry()?.id;
    const reordered = current.filter((entry) => entry.id !== sourceId);
    const targetIndex = reordered.findIndex((entry) => entry.id === targetId);
    if (targetIndex < 0) return false;

    reordered.splice(targetIndex + (placement === 'after' ? 1 : 0), 0, current[sourceIndex]);
    if (reordered.every((entry, index) => entry.id === current[index].id)) return false;

    this.queue.set(reordered);
    this.currentIndex.set(currentEntryId ? reordered.findIndex((entry) => entry.id === currentEntryId) : -1);
    this.originalQueue = [...reordered];
    this.refreshPreparedCandidate();
    return true;
  }

  snapshotQueue(): QueueSnapshot {
    return {
      queue: [...this.queue()],
      originalQueue: [...this.originalQueue],
      currentIndex: this.currentIndex(),
      isShuffle: this.isShuffle(),
    };
  }

  async restoreQueue(snapshot: QueueSnapshot): Promise<void> {
    this.clearQueue();
    this.queue.set([...snapshot.queue]);
    this.originalQueue = [...snapshot.originalQueue];
    if (this.isShuffle() !== snapshot.isShuffle) {
      this.isShuffle.set(snapshot.isShuffle);
      if (!this.restoringSettings) void this.persistSettings({ shuffle: snapshot.isShuffle });
    }
    const index = snapshot.currentIndex;
    if (index >= 0 && index < snapshot.queue.length) {
      this.currentIndex.set(index);
      await this.loadCurrentPaused(false);
    }
  }

  clearQueue(): void {
    this.loadSequence++;
    this.clearPreparedCandidate();
    this.playRequested.set(false);
    this.engine.dispose();
    this.queue.set([]);
    this.failedEntryIds.clear();
    this.originalQueue = [];
    this.currentIndex.set(-1);
    this.currentTrack.set(null);
    this.currentTime.set(0);
    this.duration.set(0);
    this.error.set(null);
    this.playbackState.set('idle');
  }

  async jumpToQueueIndex(index: number): Promise<void> {
    const q = this.queue();
    if (index >= 0 && index < q.length) {
      this.failedEntryIds.delete(q[index].id);
      this.currentIndex.set(index);
      await this.loadAndPlayCurrent();
    }
  }

  // ==========================================
  // Private Helpers
  // ==========================================

  private async loadAndPlayCurrent(): Promise<void> {
    this.clearPreparedCandidate();
    const entry = this.currentQueueEntry();
    if (!entry) {
      this.currentTrack.set(null);
      return;
    }

    const track = entry.track;
    this.currentTrack.set(track);
    this.playRequested.set(true);

    // Sequence check to prevent out-of-order race conditions
    const thisSequence = ++this.loadSequence;

    try {
      await this.engine.load(track);
      if (thisSequence === this.loadSequence && this.queue().length > 0 && this.playRequested()) {
        await this.engine.play();
      }
    } catch (err) {
      if (thisSequence === this.loadSequence && this.queue().length > 0) {
        this.playRequested.set(false);
        const failure = normalizePlaybackFailure(err, track.id);
        this.error.set(failure.message);
        await this.handlePlaybackFailure(failure);
      }
    }
  }

  private async loadCurrentPaused(recoverOnFailure = true): Promise<void> {
    this.clearPreparedCandidate();
    const entry = this.currentQueueEntry();
    if (!entry) {
      this.currentTrack.set(null);
      return;
    }

    const track = entry.track;
    this.currentTrack.set(track);
    this.playRequested.set(false);
    this.error.set(null);
    const thisSequence = ++this.loadSequence;

    try {
      await this.engine.load(track);
      if (thisSequence === this.loadSequence && this.currentQueueEntry()?.id === entry.id && !this.playRequested()) {
        this.playbackState.set('paused');
      }
    } catch (err) {
      if (thisSequence === this.loadSequence && this.currentQueueEntry()?.id === entry.id) {
        this.playRequested.set(false);
        this.playbackState.set('error');
        const failure = normalizePlaybackFailure(err, track.id);
        this.error.set(failure.message);
        if (recoverOnFailure) await this.handlePlaybackFailure(failure);
      }
    }
  }

  private handleTrackEnded(): void {
    if (this.repeatMode() === 'one') {
      this.seek(0);
      void this.play();
    } else {
      void this.advanceAfterEnded();
    }
  }

  /** The engine already continued gaplessly into the prepared track; follow it in the queue. */
  private handleTrackAutoAdvanced(track: Track): void {
    const q = this.queue();
    let nextIndex = this.preparedCandidateId ? q.findIndex((entry) => entry.id === this.preparedCandidateId) : -1;
    if (nextIndex < 0 || q[nextIndex].track.id !== track.id) {
      const current = this.currentIndex();
      nextIndex = q.findIndex((entry, index) => index > current && entry.track.id === track.id);
      if (nextIndex < 0) nextIndex = q.findIndex((entry) => entry.track.id === track.id);
    }
    this.preparedCandidateId = null;
    this.preparationReady = false;
    if (nextIndex >= 0) this.currentIndex.set(nextIndex);
    this.currentTrack.set(track);
    this.playRequested.set(true);
    this.error.set(null);
  }

  private async advanceAfterEnded(): Promise<void> {
    if (this.transitioning) return;
    const index = this.automaticNextIndex();
    const candidate = index >= 0 ? this.queue()[index] : null;
    if (!candidate) {
      await this.next();
      return;
    }

    if (this.preparationReady && this.preparedCandidateId === candidate.id) {
      this.transitioning = true;
      const originalEntryId = this.currentQueueEntry()?.id;
      try {
        const started = await this.engine.transitionTo(candidate.track, 0);
        const stillCurrent = this.currentQueueEntry()?.id === originalEntryId;
        const nextIndex = this.queue().findIndex((entry) => entry.id === candidate.id);
        if (started && stillCurrent && nextIndex >= 0) {
          this.currentIndex.set(nextIndex);
          this.currentTrack.set(candidate.track);
          this.playRequested.set(true);
          this.error.set(null);
          return;
        }
      } catch { /* Fall back to the regular load path below. */ }
      finally {
        this.transitioning = false;
        this.preparedCandidateId = null;
        this.preparationReady = false;
        this.refreshPreparedCandidate();
      }
    }

    await this.next();
  }

  private automaticNextIndex(): number {
    const q = this.queue();
    if (!q.length || this.currentIndex() < 0 || this.repeatMode() === 'one') return -1;
    for (let offset = 1; offset < q.length; offset++) {
      const index = this.currentIndex() + offset;
      if (index >= q.length && this.repeatMode() !== 'all') break;
      const candidate = index % q.length;
      if (this.isEntryPlayable(q[candidate])) return candidate;
    }
    return -1;
  }

  private automaticCandidate(): { id: string; index: number; track: Track } | null {
    const current = this.currentTrack();
    if (!current || !this.isPlaying()) return null;
    const index = this.automaticNextIndex();
    if (index < 0) return null;
    const entry = this.queue()[index];
    return { id: entry.id, index, track: entry.track };
  }

  private clearPreparedCandidate(): void {
    this.preparedCandidateId = null;
    this.preparationReady = false;
    this.engine.cancelPreparedNext();
  }

  private refreshPreparedCandidate(): void {
    if (this.transitioning) return;
    const candidate = this.automaticCandidate();
    if (!candidate) {
      if (this.preparedCandidateId) this.clearPreparedCandidate();
      return;
    }
    if (candidate.id === this.preparedCandidateId) return;
    this.clearPreparedCandidate();
    this.preparedCandidateId = candidate.id;
    void this.engine.prepareNext(candidate.track).then((ready) => {
      if (this.preparedCandidateId !== candidate.id) return;
      this.preparationReady = ready;
      if (ready) this.maybeStartCrossfade(this.currentTime(), this.duration());
    }).catch(() => { if (this.preparedCandidateId === candidate.id) this.preparationReady = false; });
  }

  private maybeStartCrossfade(time: number, duration: number): void {
    if (!this.crossfadeEnabled() || this.transitioning || !this.preparationReady || !Number.isFinite(duration) || duration <= 0) return;
    const candidate = this.automaticCandidate();
    if (!candidate || candidate.id !== this.preparedCandidateId) return;
    const seconds = Math.min(this.crossfadeSeconds(), duration / 2);
    if (duration - time > seconds) return;
    this.transitioning = true;
    const originalEntryId = this.currentQueueEntry()?.id;
    void this.engine.transitionTo(candidate.track, seconds).then((started) => {
      if (!started) return;
      const stillCurrent = this.currentQueueEntry()?.id === originalEntryId;
      const nextIndex = this.queue().findIndex((entry) => entry.id === candidate.id);
      if (stillCurrent && nextIndex >= 0) {
        this.currentIndex.set(nextIndex);
        this.currentTrack.set(candidate.track);
        this.error.set(null);
      }
    }).catch(() => { /* The current track continues until its normal end. */ }).finally(() => {
      this.transitioning = false;
      this.preparedCandidateId = null;
      this.preparationReady = false;
      this.refreshPreparedCandidate();
    });
  }

  private isEntryPlayable(entry: QueueEntry): boolean {
    return entry.track.isAvailable && !this.failedEntryIds.has(entry.id);
  }

  private async handlePlaybackFailure(failure: PlaybackError): Promise<void> {
    if (failure.code === 'OUTPUT_EXCLUSIVE_NOT_ALLOWED' || failure.code === 'OUTPUT_DEVICE_UNAVAILABLE' || failure.code === 'OUTPUT_DEVICE_BUSY' || failure.code === 'OUTPUT_FORMAT_UNSUPPORTED' || failure.code === 'OUTPUT_DEVICE_PERMISSION_DENIED' || failure.code === 'OUTPUT_DEVICE_UNSUPPORTED' || failure.code === 'OUTPUT_MODE_UNSUPPORTED') {
      this.playRequested.set(false);
      this.playbackState.set('paused');
      this.playbackNotice.set(failure.message);
      return;
    }
    const entry = this.currentQueueEntry();
    if (!entry || this.recoveringFromFailure || this.failedEntryIds.has(entry.id)) return;
    this.recoveringFromFailure = true;
    try {
      let currentFailure = failure;
      while (true) {
        const failedEntry = this.currentQueueEntry();
        if (!failedEntry) return;
        this.failedEntryIds.add(failedEntry.id);
        this.playRequested.set(false);
        this.playbackNotice.set(`${failedEntry.track.title} could not be played and was skipped.`);
        logPlaybackDiagnostic('warn', { operation: 'transition', state: 'error', errorCode: currentFailure.code, trackId: failedEntry.track.id });
        const nextIndex = this.nextPlayableIndexAfterFailure();
        if (nextIndex < 0) {
          this.playbackState.set('error');
          this.error.set('No playable tracks remain in the queue.');
          return;
        }
        this.currentIndex.set(nextIndex);
        const nextEntry = this.queue()[nextIndex];
        this.currentTrack.set(nextEntry.track);
        this.playRequested.set(true);
        const sequence = ++this.loadSequence;
        try {
          await this.engine.load(nextEntry.track);
          if (sequence !== this.loadSequence) return;
          await this.engine.play();
          this.error.set(null);
          return;
        } catch (err) {
          if (sequence !== this.loadSequence) return;
          currentFailure = normalizePlaybackFailure(err, nextEntry.track.id);
          if (currentFailure.code.startsWith('OUTPUT_')) {
            this.playRequested.set(false);
            this.playbackState.set('paused');
            this.playbackNotice.set(currentFailure.message);
            return;
          }
        }
      }
    } finally {
      this.recoveringFromFailure = false;
    }
  }

  private nextPlayableIndexAfterFailure(): number {
    const entries = this.queue();
    const start = this.currentIndex();
    return nextPlayableQueueIndex(entries.length, start, this.repeatMode() === 'all', (index) => this.isEntryPlayable(entries[index]));
  }

  private async handleOutputDevicesChanged(): Promise<void> {
    const wasConnected = this.audioPathStatus()?.isConnected ?? true;
    await this.refreshAudioOutputState();
    const status = this.audioPathStatus();
    if (status && !status.isConnected) {
      this.playRequested.set(false);
      this.playbackNotice.set(this.audioOutputFallbackEnabled() && status.activeDeviceId === SYSTEM_DEFAULT_OUTPUT_ID
        ? 'The preferred audio output was disconnected. System Default is ready; press Play to continue.'
        : 'The preferred audio output was disconnected. Playback has been paused.');
    } else if (!wasConnected) {
      this.playbackNotice.set('The preferred audio output was reconnected. Playback remains paused.');
    } else if (this.outputInterrupted && status?.isConnected) {
      this.outputInterrupted = false;
      this.playbackNotice.set('The audio output is ready. Playback remains paused.');
    }
  }

  private handleSuspend(): void {
    const entry = this.currentQueueEntry();
    if (!entry) return;
    this.suspendSnapshot = {
      entryId: entry.id,
      position: this.currentTime(),
      shouldResume: this.isPlaybackActive(),
    };
    logPlaybackDiagnostic('info', { operation: 'suspend', state: this.playbackState(), trackId: entry.track.id });
    this.pause();
  }

  private async handleResume(): Promise<void> {
    const snapshot = this.suspendSnapshot;
    this.suspendSnapshot = null;
    if (!snapshot) return;
    const index = this.queue().findIndex((entry) => entry.id === snapshot.entryId);
    if (index < 0) return;
    this.currentIndex.set(index);
    try {
      this.engine.setOutputFallbackEnabled(this.audioOutputFallbackEnabled());
      await this.engine.selectOutputDevice(this.preferredAudioOutputId());
      await this.refreshAudioOutputState();
      const sequence = ++this.loadSequence;
      const track = this.queue()[index].track;
      await this.engine.load(track);
      if (sequence !== this.loadSequence) return;
      this.currentTrack.set(track);
      this.engine.seek(snapshot.position);
      if (this.audioEngineBackend() === 'chromium' && snapshot.shouldResume && this.audioPathStatus()?.activeDeviceId) {
        this.playRequested.set(true);
        await this.engine.play();
      } else {
        this.playRequested.set(false);
        this.playbackState.set('paused');
      }
      logPlaybackDiagnostic('info', { operation: 'resume', state: snapshot.shouldResume ? 'playing' : 'paused', trackId: track.id, deviceId: this.audioPathStatus()?.activeDeviceId ?? undefined });
    } catch (err) {
      const failure = normalizePlaybackFailure(err, this.currentTrack()?.id);
      this.playRequested.set(false);
      this.playbackState.set('error');
      this.error.set(failure.message);
      this.playbackNotice.set(failure.message);
    }
  }

  private createQueueEntry(track: Track, originalIndex: number): QueueEntry {
    return {
      id: `qe-${Date.now()}-${originalIndex}-${Math.random().toString(36).substring(2, 7)}`,
      track,
      originalIndex,
    };
  }

  private createQueueEntries(tracks: Track[]): QueueEntry[] {
    return tracks.map((track, idx) => this.createQueueEntry(track, idx));
  }

  private shuffleArray<T>(array: T[]): T[] {
    const copy = [...array];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }
}
