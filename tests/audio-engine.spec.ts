import '@angular/compiler';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { constantSumCrossfadeGains } from '../src/app/core/player/crossfade-gains';
import { nextPlayableQueueIndex, stateForMediaEvent } from '../src/app/core/player/playback-policy';
import { PLAYBACK_ENGINE } from '../src/app/core/contracts';
import { PlayerService } from '../src/app/core/player/player.service';
import { QueueActionsService } from '../src/app/core/player/queue-actions.service';
import { SettingsComponent } from '../src/app/features/settings/settings.component';
import { FoldersComponent } from '../src/app/features/folders/folders.component';
import { ConfirmRemoveFolderDialogComponent } from '../src/app/shared/components/confirm-remove-folder-dialog/confirm-remove-folder-dialog.component';

describe('playback state policy', () => {
  it('distinguishes initial loading from playback buffering', () => {
    expect(stateForMediaEvent('load', true)).toBe('loading');
    expect(stateForMediaEvent('waiting', false)).toBe('buffering');
    expect(stateForMediaEvent('stalled', true)).toBe('paused');
    expect(stateForMediaEvent('canplay', false)).toBe('playing');
    expect(stateForMediaEvent('canplay', true)).toBe('paused');
  });
});

describe('bounded queue recovery', () => {
  it('finds the next playable entry without wrapping when repeat-all is off', () => {
    expect(nextPlayableQueueIndex(4, 0, false, (index) => index === 3)).toBe(3);
    expect(nextPlayableQueueIndex(4, 3, false, () => true)).toBe(-1);
  });

  it('wraps at most once and stops when no entry is playable', () => {
    expect(nextPlayableQueueIndex(4, 3, true, (index) => index === 1)).toBe(1);
    expect(nextPlayableQueueIndex(4, 2, true, () => false)).toBe(-1);
  });
});

describe('crossfade headroom', () => {
  it('keeps gain constant-sum across the overlap', () => {
    for (const progress of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      const gains = constantSumCrossfadeGains(progress);
      expect(gains.outgoing + gains.incoming).toBeCloseTo(1, 12);
      expect(gains.outgoing).toBeGreaterThanOrEqual(0);
      expect(gains.incoming).toBeGreaterThanOrEqual(0);
    }
  });

  it('clamps progress and preserves full-volume endpoints', () => {
    expect(constantSumCrossfadeGains(-1)).toEqual({ outgoing: 1, incoming: 0 });
    const end = constantSumCrossfadeGains(2);
    expect(end.outgoing).toBeCloseTo(0, 12);
    expect(end.incoming).toBeCloseTo(1, 12);
  });
});

describe('Chromium output routing', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('applies the selected sink to active and standby audio and safely handles reconnects', async () => {
    const audioInstances: FakeAudio[] = [];
    let outputs = [{ kind: 'audiooutput', deviceId: 'dac-1', label: 'Test DAC', groupId: '', toJSON: () => ({}) } as MediaDeviceInfo];
    let deviceChange: (() => void) | undefined;
    const mediaDevices = {
      enumerateDevices: vi.fn(async () => outputs),
      addEventListener: vi.fn((_event: string, listener: EventListener) => { deviceChange = () => listener(new Event('devicechange')); }),
    };
    vi.stubGlobal('navigator', { mediaDevices });
    vi.stubGlobal('Audio', class extends FakeAudio { constructor() { super(); audioInstances.push(this); } });

    const { HtmlAudioPlaybackEngine } = await import('../src/app/core/desktop/html-audio-playback.engine');
    const engine = new HtmlAudioPlaybackEngine();
    await engine.selectOutputDevice('dac-1');
    expect(audioInstances[0].sinkId).toBe('dac-1');

    const prepare = engine.prepareNext(track('next'));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(audioInstances[1].sinkId).toBe('dac-1');
    expect(audioInstances[1].preload).toBe('auto');
    let preparationSettled = false;
    void prepare.then(() => { preparationSettled = true; });
    audioInstances[1].dispatchEvent(new Event('loadedmetadata'));
    await Promise.resolve();
    expect(preparationSettled).toBe(false);
    audioInstances[1].readyState = 3;
    audioInstances[1].dispatchEvent(new Event('canplay'));
    await expect(prepare).resolves.toBe(true);

    engine.setOutputFallbackEnabled(true);
    outputs = [];
    const disconnected = new Promise<void>((resolve) => engine.subscribeDeviceChanges(resolve));
    deviceChange?.();
    await disconnected;
    await Promise.resolve();
    expect((await engine.getAudioPathStatus()).activeDeviceId).toBe('system-default');
    expect((await engine.getAudioPathStatus()).isConnected).toBe(false);

    outputs = [{ kind: 'audiooutput', deviceId: 'dac-1', label: 'Test DAC', groupId: '', toJSON: () => ({}) } as MediaDeviceInfo];
    const reconnected = new Promise<void>((resolve) => engine.subscribeDeviceChanges(resolve));
    deviceChange?.();
    await reconnected;
    expect((await engine.getAudioPathStatus()).activeDeviceId).toBe('dac-1');
    expect((await engine.getAudioPathStatus()).isConnected).toBe(true);
    expect(audioInstances.every((audio) => audio.playCalls === 0)).toBe(true);
  });

  it('promotes a buffered standby element without loading the track again', async () => {
    const audioInstances: FakeAudio[] = [];
    vi.stubGlobal('navigator', { mediaDevices: { addEventListener: vi.fn() } });
    vi.stubGlobal('Audio', class extends FakeAudio { constructor() { super(); audioInstances.push(this); } });

    const { HtmlAudioPlaybackEngine } = await import('../src/app/core/desktop/html-audio-playback.engine');
    const engine = new HtmlAudioPlaybackEngine();
    const initialLoad = engine.load(track('current'));
    await Promise.resolve();
    await Promise.resolve();
    audioInstances[0].dispatchEvent(new Event('loadedmetadata'));
    await initialLoad;
    await engine.play();

    const preparation = engine.prepareNext(track('next'));
    await Promise.resolve();
    audioInstances[1].readyState = 3;
    audioInstances[1].dispatchEvent(new Event('canplay'));
    await expect(preparation).resolves.toBe(true);

    const nextUrl = audioInstances[1].src;
    await expect(engine.transitionTo(track('next'), 0)).resolves.toBe(true);
    expect(audioInstances[1].src).toBe(nextUrl);
    expect(audioInstances[1].loadCalls).toBe(1);
    expect(audioInstances[1].playCalls).toBe(1);
    expect(audioInstances[0].src).toBe('');
  });
});

describe('Native transition coordination', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('does not promote the prepared track until the host confirms it is playing', async () => {
    const bridge = fakeNativeBridge();
    vi.stubGlobal('window', { desktop: { audioHost: bridge.audioHost } });
    const { NativeAudioPlaybackEngine } = await import('../src/app/core/desktop/native-audio-playback.engine');
    const engine = new NativeAudioPlaybackEngine({ run: <T>(callback: () => T) => callback() } as any);
    const states: Array<{ state: string; trackId?: string }> = [];
    engine.stateChange$.subscribe((event) => states.push({ state: event.state, trackId: event.track?.id }));

    await engine.load(track('current'));
    await expect(engine.prepareNext(track('next'))).resolves.toBe(true);
    let settled = false;
    const transition = engine.transitionTo(track('next'), 0);
    void transition.then(() => { settled = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    bridge.emit({ kind: 'state', value: { state: 'playing', trackId: 'next' } });
    await expect(transition).resolves.toBe(true);
    expect(states.at(-1)).toEqual({ state: 'playing', trackId: 'next' });
    engine.dispose();
  });

  it('ignores a late transition event after a newer load supersedes it', async () => {
    const bridge = fakeNativeBridge();
    vi.stubGlobal('window', { desktop: { audioHost: bridge.audioHost } });
    const { NativeAudioPlaybackEngine } = await import('../src/app/core/desktop/native-audio-playback.engine');
    const engine = new NativeAudioPlaybackEngine({ run: <T>(callback: () => T) => callback() } as any);
    const states: Array<{ state: string; trackId?: string }> = [];
    engine.stateChange$.subscribe((event) => states.push({ state: event.state, trackId: event.track?.id }));

    await engine.load(track('current'));
    await engine.prepareNext(track('next'));
    const transition = engine.transitionTo(track('next'), 0);
    await Promise.resolve();
    await engine.load(track('third'));
    await expect(transition).resolves.toBe(false);
    bridge.emit({ kind: 'state', value: { state: 'playing', trackId: 'next' } });
    expect(states.at(-1)).toEqual({ state: 'loading', trackId: 'third' });
    engine.dispose();
  });
});

describe('Player queue transition coordination', () => {
  it('advances exactly once after prepared playback is confirmed, then Next loads the following entry', async () => {
    const harness = createPlayerHarness();
    harness.player.setCrossfadeEnabled(false);
    await harness.player.playCollection([track('one'), track('two'), track('three')]);
    await waitUntil(() => harness.preparedTrackId() === 'two');

    harness.emitState('ended', 'one');
    await waitUntil(() => harness.hasPendingTransition());
    expect(harness.player.currentIndex()).toBe(0);
    expect(harness.player.currentTrack()?.id).toBe('one');

    harness.completeTransition(true);
    await waitUntil(() => harness.player.currentIndex() === 1);
    expect(harness.player.currentTrack()?.id).toBe('two');

    await harness.player.next();
    expect(harness.loadedTrackId()).toBe('three');
    expect(harness.player.currentIndex()).toBe(2);
    expect(harness.player.currentTrack()?.id).toBe('three');
    harness.player.ngOnDestroy();
  });
});

describe('Clear queue Undo', () => {
  afterEach(() => vi.useRealTimers());

  it('restores entry IDs, shuffle order, original order and the selected track paused at the start', async () => {
    const { player, engine } = createPlayerHarness();
    const tracks = Array.from({ length: 12 }, (_, index) => track(`track-${index}`));
    await player.playCollection(tracks, 4);
    player.toggleShuffle();
    await player.jumpToQueueIndex(6);
    player.currentTime.set(42);
    const snapshot = player.snapshotQueue();
    player.clearQueue();
    player.setShuffle(false);
    engine.play.mockClear();

    await player.restoreQueue(snapshot);

    expect(player.queue()).toEqual(snapshot.queue);
    expect(player.queue()).not.toBe(snapshot.queue);
    expect(player.currentIndex()).toBe(6);
    expect(player.currentTrack()).toEqual(snapshot.queue[6].track);
    expect(player.isShuffle()).toBe(true);
    expect(player.currentTime()).toBe(0);
    expect(player.playbackState()).toBe('paused');
    expect(engine.play).not.toHaveBeenCalled();
    player.toggleShuffle();
    expect(player.queue()).toEqual(snapshot.originalQueue);
    expect(player.currentTrack()).toEqual(snapshot.queue[6].track);
    player.ngOnDestroy();
  });

  it('keeps restored playback stopped when loading fails instead of autoplaying another track', async () => {
    const { player, engine } = createPlayerHarness();
    await player.playCollection([track('one'), track('two')]);
    const snapshot = player.snapshotQueue();
    player.clearQueue();
    engine.play.mockClear();
    engine.load.mockRejectedValueOnce(new Error('Missing file'));

    await player.restoreQueue(snapshot);

    expect(player.currentTrack()?.id).toBe('one');
    expect(player.currentIndex()).toBe(0);
    expect(player.playbackState()).toBe('error');
    expect(engine.play).not.toHaveBeenCalled();
    player.ngOnDestroy();
  });

  it('offers Undo for six seconds and consumes the action only once', async () => {
    vi.useFakeTimers();
    const { player, engine } = createPlayerHarness();
    await player.playCollection([track('one'), track('two')], 1);
    const queue = [...player.queue()];
    const actions = createQueueActions(player);
    actions.clearWithUndo();
    expect(player.queue()).toEqual([]);
    expect(actions.notice()?.message).toBe('Queue cleared');
    vi.advanceTimersByTime(5999);
    const undo = actions.notice()?.action;
    expect(undo?.label).toBe('Undo');
    engine.play.mockClear();
    undo!.run();
    await Promise.resolve();
    expect(player.queue()).toEqual(queue);
    expect(player.currentTrack()?.id).toBe('two');
    expect(player.playbackState()).toBe('paused');
    expect(engine.play).not.toHaveBeenCalled();
    expect(actions.notice()).toBeNull();
    const loadCount = engine.load.mock.calls.length;
    undo!.run();
    expect(engine.load.mock.calls.length).toBe(loadCount);
    actions.ngOnDestroy();
    player.ngOnDestroy();
  });

  it('expires Undo without restoring the queue and preserves the ordinary three-second notice timeout', async () => {
    vi.useFakeTimers();
    const { player } = createPlayerHarness();
    await player.playCollection([track('one')]);
    const actions = createQueueActions(player);
    actions.clearWithUndo();
    const expiredUndo = actions.notice()!.action!;
    vi.advanceTimersByTime(6000);
    expect(actions.notice()).toBeNull();
    expiredUndo.run();
    expect(player.queue()).toEqual([]);
    expect(player.currentTrack()).toBeNull();
    actions.add([track('two')]);
    expect(actions.notice()?.message).toContain('two');
    expect(actions.notice()?.action).toBeUndefined();
    vi.advanceTimersByTime(3000);
    expect(actions.notice()).toBeNull();
    actions.ngOnDestroy();
    player.ngOnDestroy();
  });

  it('does not let an old Undo replace a newly started queue', async () => {
    const { player } = createPlayerHarness();
    await player.playCollection([track('one')]);
    const actions = createQueueActions(player);
    actions.clearWithUndo();
    const undo = actions.notice()!.action!;
    await player.playCollection([track('two')]);
    undo.run();
    expect(player.currentTrack()?.id).toBe('two');
    expect(player.queue().map((entry) => entry.track.id)).toEqual(['two']);
    actions.ngOnDestroy();
    player.ngOnDestroy();
  });
});

function createQueueActions(player: PlayerService): QueueActionsService {
  const injector = Injector.create({ providers: [{ provide: PlayerService, useValue: player }] });
  return runInInjectionContext(injector, () => new QueueActionsService());
}

describe('Remove folder confirmation', () => {
  function settingsHarness() {
    const context = {
      pendingRemoveFolder: signal<{ id: string; name: string } | null>({ id: 'folder-one', name: 'Music' }),
      removingFolder: signal(false),
      errorMessage: signal<string | null>(null),
      libraryGateway: { removeMusicFolder: vi.fn(async (_id: string) => undefined) },
      loadFolders: vi.fn(async () => undefined),
    };
    const confirm = () => SettingsComponent.prototype.onRemoveFolder.call(context as unknown as SettingsComponent);
    return { context, confirm };
  }

  it('does not remove anything after Cancel has cleared the pending folder', async () => {
    const { context, confirm } = settingsHarness();
    context.pendingRemoveFolder.set(null);
    await confirm();
    expect(context.libraryGateway.removeMusicFolder).not.toHaveBeenCalled();
    expect(context.loadFolders).not.toHaveBeenCalled();
  });

  it('removes the confirmed folder once and reloads Settings', async () => {
    const { context, confirm } = settingsHarness();
    await Promise.all([confirm(), confirm()]);
    expect(context.libraryGateway.removeMusicFolder).toHaveBeenCalledExactlyOnceWith('folder-one');
    expect(context.loadFolders).toHaveBeenCalledOnce();
    expect(context.pendingRemoveFolder()).toBeNull();
    expect(context.removingFolder()).toBe(false);
  });

  it('keeps the pending folder for retry when removal fails', async () => {
    const { context, confirm } = settingsHarness();
    context.libraryGateway.removeMusicFolder.mockRejectedValueOnce(new Error('Folder is busy'));
    await confirm();
    expect(context.pendingRemoveFolder()?.id).toBe('folder-one');
    expect(context.errorMessage()).toBe('Folder is busy');
    expect(context.removingFolder()).toBe(false);
    expect(context.loadFolders).not.toHaveBeenCalled();
  });

  it('requires an open confirmation on the Folders page and guards repeat submissions', async () => {
    const context = {
      selectedRootId: signal<string | null>('folder-one'),
      showRemoveDialog: signal(false),
      removingFolder: signal(false),
      errorMessage: signal<string | null>(null),
      libraryGateway: { removeMusicFolder: vi.fn(async (_id: string) => undefined) },
      loadRoots: vi.fn(async () => undefined),
    };
    const confirm = () => FoldersComponent.prototype.onConfirmRemoveRoot.call(context as unknown as FoldersComponent);
    await confirm();
    expect(context.libraryGateway.removeMusicFolder).not.toHaveBeenCalled();
    context.showRemoveDialog.set(true);
    await Promise.all([confirm(), confirm()]);
    expect(context.libraryGateway.removeMusicFolder).toHaveBeenCalledExactlyOnceWith('folder-one');
    expect(context.showRemoveDialog()).toBe(false);
    expect(context.selectedRootId()).toBeNull();
    expect(context.loadRoots).toHaveBeenCalledOnce();
  });

  it('cancels on Esc and contains global keyboard events within the dialog', () => {
    const context = {
      cancelled: { emit: vi.fn() },
      onCancel: ConfirmRemoveFolderDialogComponent.prototype.onCancel,
    };
    const escape = { key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() };
    ConfirmRemoveFolderDialogComponent.prototype.onKeyDown.call(
      context as unknown as ConfirmRemoveFolderDialogComponent, escape as unknown as KeyboardEvent,
    );
    expect(context.cancelled.emit).toHaveBeenCalledOnce();
    expect(escape.preventDefault).toHaveBeenCalledOnce();
    expect(escape.stopPropagation).toHaveBeenCalledOnce();
    const tab = { key: 'Tab', preventDefault: vi.fn(), stopPropagation: vi.fn() };
    ConfirmRemoveFolderDialogComponent.prototype.onKeyDown.call(
      context as unknown as ConfirmRemoveFolderDialogComponent, tab as unknown as KeyboardEvent,
    );
    expect(tab.preventDefault).not.toHaveBeenCalled();
    expect(tab.stopPropagation).toHaveBeenCalledOnce();
    expect(context.cancelled.emit).toHaveBeenCalledOnce();
  });

  it('closes the native dialog and restores focus to a connected opener', () => {
    const opener = { isConnected: true, focus: vi.fn() };
    const context = { dialog: { nativeElement: { close: vi.fn() } }, focusBeforeDialog: opener };
    ConfirmRemoveFolderDialogComponent.prototype.ngOnDestroy.call(context as unknown as ConfirmRemoveFolderDialogComponent);
    expect(context.dialog.nativeElement.close).toHaveBeenCalledOnce();
    expect(opener.focus).toHaveBeenCalledOnce();
    opener.isConnected = false;
    ConfirmRemoveFolderDialogComponent.prototype.ngOnDestroy.call(context as unknown as ConfirmRemoveFolderDialogComponent);
    expect(opener.focus).toHaveBeenCalledOnce();
  });
});

class FakeAudio extends EventTarget {
  crossOrigin = '';
  volume = 1;
  muted = false;
  paused = true;
  ended = false;
  currentTime = 0;
  duration = 120;
  src = '';
  preload = '';
  readyState = 0;
  sinkId = '';
  error: MediaError | null = null;
  playCalls = 0;
  loadCalls = 0;

  async setSinkId(value: string): Promise<void> { this.sinkId = value; }
  load(): void { this.loadCalls++; }
  removeAttribute(name: string): void { if (name === 'src') this.src = ''; }
  async play(): Promise<void> { this.playCalls++; this.paused = false; this.dispatchEvent(new Event('play')); }
  pause(): void { this.paused = true; this.dispatchEvent(new Event('pause')); }
}

function track(id: string) {
  return {
    id, path: '', fileName: `${id}.flac`, title: id, artist: null, albumArtist: null, album: null, genre: null,
    year: null, trackNumber: null, discNumber: null, duration: 120, codec: 'FLAC', bitrate: null,
    sampleRate: 96000, bitDepth: 24, channels: 2, artwork: null, fileSize: null, lastModified: null, isAvailable: true,
  };
}

function fakeNativeBridge() {
  let eventListener: (event: any) => void = () => undefined;
  let stateListener: (state: string) => void = () => undefined;
  const audioHost = {
    getState: vi.fn(async () => 'ready'), start: vi.fn(async () => undefined), load: vi.fn(async () => undefined),
    play: vi.fn(async () => undefined), pause: vi.fn(async () => undefined), seek: vi.fn(async () => undefined),
    setVolume: vi.fn(async () => undefined), setMute: vi.fn(async () => undefined), prepare: vi.fn(async () => true),
    cancelPrepared: vi.fn(async () => undefined), transition: vi.fn(async () => true), listDevices: vi.fn(async () => []),
    selectDevice: vi.fn(async () => undefined), setFallbackEnabled: vi.fn(async () => undefined),
    getPathStatus: vi.fn(async () => ({})), setSpectrumEnabled: vi.fn(async () => undefined),
    onEvent: vi.fn((listener: (event: any) => void) => { eventListener = listener; return () => undefined; }),
    onStateChange: vi.fn((listener: (state: string) => void) => { stateListener = listener; return () => undefined; }),
  };
  return {
    audioHost,
    emit: (event: any) => eventListener(event),
    setHostState: (state: string) => stateListener(state),
  };
}

function createPlayerHarness() {
  const state = new BehaviorSubject<any>({ state: 'idle', track: null });
  const time = new Subject<any>();
  const volume = new BehaviorSubject({ volume: 0.8, isMuted: false });
  let loaded: ReturnType<typeof track> | null = null;
  let prepared: ReturnType<typeof track> | null = null;
  let transitionResolver: ((completed: boolean) => void) | null = null;
  const engine = {
    stateChange$: state.asObservable(), timeUpdate$: time.asObservable(), volumeChange$: volume.asObservable(),
    load: vi.fn(async (next: ReturnType<typeof track>) => { loaded = next; state.next({ state: 'paused', track: next }); }),
    play: vi.fn(async () => { state.next({ state: 'playing', track: loaded }); }),
    pause: vi.fn(() => state.next({ state: 'paused', track: loaded })), seek: vi.fn(),
    setVolume: vi.fn(), setMute: vi.fn(),
    prepareNext: vi.fn(async (next: ReturnType<typeof track>) => { prepared = next; return true; }),
    cancelPreparedNext: vi.fn(() => { prepared = null; }),
    transitionTo: vi.fn((next: ReturnType<typeof track>) => new Promise<boolean>((resolve) => {
      transitionResolver = (completed) => {
        if (completed) { loaded = next; prepared = null; state.next({ state: 'playing', track: next }); }
        transitionResolver = null;
        resolve(completed);
      };
    })),
    listOutputDevices: vi.fn(async () => []), selectOutputDevice: vi.fn(async () => undefined),
    setOutputFallbackEnabled: vi.fn(), setOutputMode: vi.fn(async () => undefined),
    getAudioPathStatus: vi.fn(async () => ({ preferredDeviceId: 'system-default', activeDeviceId: 'system-default' })),
    subscribeDeviceChanges: vi.fn(() => () => undefined), getBackend: vi.fn(() => 'chromium'),
    setBackend: vi.fn(async () => undefined), dispose: vi.fn(),
  };
  const injector = Injector.create({ providers: [{ provide: PLAYBACK_ENGINE, useValue: engine }] });
  const player = runInInjectionContext(injector, () => new PlayerService());
  return {
    player,
    engine,
    emitState: (playbackState: string, trackId: string) => state.next({ state: playbackState, track: track(trackId) }),
    preparedTrackId: () => prepared?.id,
    loadedTrackId: () => loaded?.id,
    hasPendingTransition: () => transitionResolver !== null,
    completeTransition: (completed: boolean) => transitionResolver?.(completed),
  };
}

async function waitUntil(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for test condition.');
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
