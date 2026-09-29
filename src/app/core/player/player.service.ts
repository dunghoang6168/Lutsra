import { Injectable, inject, signal, computed, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { LIBRARY_GATEWAY, PLAYBACK_ENGINE, SETTINGS_GATEWAY } from '../contracts';
import { PlaybackState, QueueEntry, RepeatMode, Track } from '../models';

@Injectable({ providedIn: 'root' })
export class PlayerService implements OnDestroy {
  private readonly engine = inject(PLAYBACK_ENGINE);
  private readonly settingsGateway = inject(SETTINGS_GATEWAY, { optional: true });
  private readonly libraryGateway = inject(LIBRARY_GATEWAY, { optional: true });
  private readonly subscriptions = new Subscription();
  private restoringSettings = false;
  private volumeSaveTimer: ReturnType<typeof setTimeout> | null = null;

  // Internal Request Counter for handling overlapping load requests
  private loadSequence = 0;
  private libraryRefreshVersion = 0;
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
  readonly error = signal<string | null>(null);

  // Original queue before shuffle was toggled on
  private originalQueue: QueueEntry[] = [];

  // Derived Computed Signals
  readonly isPlaying = computed(() => this.playbackState() === 'playing');
  readonly isLoading = computed(() => this.playbackState() === 'loading');
  readonly isPlaybackActive = computed(() => this.isPlaying() || (this.isLoading() && this.playRequested()));

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
      const keep = (entry: QueueEntry): QueueEntry | null => {
        const track = tracks.get(entry.track.id);
        return track ? { ...entry, track } : null;
      };
      const nextQueue = this.queue().flatMap((entry) => keep(entry) ?? []);
      this.originalQueue = this.originalQueue.flatMap((entry) => keep(entry) ?? []);
      this.queue.set(nextQueue);
      const currentIndex = currentEntry ? nextQueue.findIndex((entry) => entry.id === currentEntry.id) : -1;
      if (currentEntry && currentIndex < 0) {
        this.loadSequence++;
        this.playRequested.set(false);
        this.engine.dispose();
        this.currentTrack.set(null);
        this.currentTime.set(0);
        this.duration.set(0);
        this.error.set(null);
        this.playbackState.set('idle');
      } else if (currentIndex >= 0) {
        this.currentTrack.set(nextQueue[currentIndex].track);
      }
      this.currentIndex.set(currentIndex);
    } catch (error) {
      console.error('[playback:library] Failed to reconcile queue', error);
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
        } else if (evt.state === 'playing') {
          this.error.set(null);
        }

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
      })
    );

    // 3. Volume change stream
    this.subscriptions.add(
      this.engine.volumeChange$.subscribe((evt) => {
        this.volume.set(evt.volume);
        this.isMuted.set(evt.isMuted);
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
      throw error;
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
  }

  private async persistSettings(value: { defaultVolume?: number; repeatMode?: RepeatMode; shuffle?: boolean }): Promise<void> {
    if (!this.settingsGateway) return;
    try {
      await this.settingsGateway.saveSettings(value);
    } catch (error) {
      console.error('[playback:settings] Failed to persist player settings', error);
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
    while (!q[nextIndex].track.isAvailable && attempts < q.length) {
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
    while (!q[prevIndex].track.isAvailable && attempts < q.length) {
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
  }

  addToQueue(tracks: Track[]): void {
    if (!tracks || tracks.length === 0) return;

    const newEntries = this.createQueueEntries(tracks);
    const q = this.queue();

    if (q.length === 0) {
      this.queue.set(newEntries);
      this.originalQueue = [...newEntries];
      this.currentIndex.set(0);
      this.loadAndPlayCurrent();
      return;
    }

    this.queue.update((current) => [...current, ...newEntries]);
    this.originalQueue.push(...newEntries);
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
  }

  clearQueue(): void {
    this.loadSequence++;
    this.playRequested.set(false);
    this.engine.dispose();
    this.queue.set([]);
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
      this.currentIndex.set(index);
      await this.loadAndPlayCurrent();
    }
  }

  // ==========================================
  // Private Helpers
  // ==========================================

  private async loadAndPlayCurrent(): Promise<void> {
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
        this.error.set(`Cannot play track: ${track.title}`);
        // If track is unavailable, skip to next after a moment
        if (!track.isAvailable) {
          setTimeout(() => {
            if (thisSequence === this.loadSequence && this.queue().length > 0) {
              this.next();
            }
          }, 800);
        }
      }
    }
  }

  private handleTrackEnded(): void {
    if (this.repeatMode() === 'one') {
      this.seek(0);
      this.play();
    } else {
      this.next();
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
