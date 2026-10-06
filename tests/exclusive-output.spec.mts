import '@angular/compiler';
import { describe, it, expect, vi } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
vi.mock('electron', () => ({ app: { getPath: () => '.', isPackaged: false } }));
import { validOutputMode, validExclusiveBufferMs } from '../electron/ipc/ipc-validation';
import { validSettings } from '../electron/ipc/settings-validation';
import { AudioHostService } from '../electron/services/audio-host.service';
import { DatabaseService } from '../electron/services/database.service';
import { PLAYBACK_ENGINE, SETTINGS_GATEWAY } from '../src/app/core/contracts';
import { PlayerService } from '../src/app/core/player/player.service';

describe('Exclusive IPC and persistence', () => {
  it('accepts only Phase 5 modes and the four buffer sizes', () => {
    for (const mode of ['shared', 'exclusive-dsp']) expect(validOutputMode(mode)).toBe(mode);
    for (const mode of ['exclusive-bitperfect', null, 1, 'Exclusive']) expect(() => validOutputMode(mode)).toThrow();
    for (const ms of [10,20,40,80]) expect(validExclusiveBufferMs(ms)).toBe(ms);
    for (const ms of [0,15,20.5,'20',NaN,Infinity]) expect(() => validExclusiveBufferMs(ms)).toThrow();
    expect(validSettings({ outputMode: 'exclusive-dsp', exclusiveBufferMs: 80 })).toEqual({ outputMode: 'exclusive-dsp', exclusiveBufferMs: 80 });
    expect(() => validSettings({ exclusiveBufferMs: 15 })).toThrow();
  });

  it('retains stored Exclusive settings and defaults legacy settings to Shared/20', () => {
    const service = Object.create(DatabaseService.prototype) as any;
    service.listFolders = () => [];
    let stored = { outputMode: 'exclusive-dsp', exclusiveBufferMs: 80 };
    service.db = { prepare: () => ({ get: () => ({ value: JSON.stringify(stored) }) }) };
    expect(service.getSettings()).toMatchObject(stored);
    stored = { outputMode: 'exclusive-bitperfect', exclusiveBufferMs: 15 };
    expect(service.getSettings()).toMatchObject({ outputMode: 'shared', exclusiveBufferMs: 20 });
  });

  it('rehydrates mode before device and restores the captured position without Play', async () => {
    const service = new AudioHostService({} as any, () => null) as any;
    service.currentTrackId = 'track'; service.currentPosition = 12.5; service.currentDuration = 31;
    service.broadcast = vi.fn();
    service.outputMode = 'exclusive-dsp'; service.exclusiveBufferMs = 80;
    const commands: [string, any][] = [];
    service.requestVoid = async (type: string, payload: any) => { commands.push([type,payload]); service.currentPosition = 0; };
    service.loadTrack = async (id: string) => { commands.push(['load', { id }]); service.currentPosition = 0; };
    await service.rehydratePausedSession();
    expect(commands.map(([type]) => type)).toEqual(['set-fallback','set-output-mode','select-device','set-volume','set-mute','load','seek','pause']);
    expect(commands[1][1]).toEqual({ mode: 'exclusive-dsp', bufferMs: 80 });
    expect(commands.find(([type]) => type === 'seek')![1]).toEqual({ positionSeconds: 12.5 });
    expect(service.currentPosition).toBe(12.5);
    expect(service.broadcast).toHaveBeenCalledWith('audio-host:event', { kind: 'time', value: { currentTime: 12.5, duration: 31 } });
  });

  it('a live host rejecting Exclusive recovery stays Native and paused', async () => {
    const service = new AudioHostService({} as any, () => null) as any;
    const child = {};
    service.child = child; service.state = 'ready';
    service.start = async () => { service.state = 'ready'; };
    service.rehydratePausedSession = vi.fn(async () => { throw Object.assign(new Error(), { code: 'OUTPUT_DEVICE_BUSY' }); });
    service.broadcast = vi.fn();
    await service.handleExit(child);
    expect(service.getState()).toBe('ready');
    expect(service.rehydratePausedSession).toHaveBeenCalledTimes(1);
    expect(service.broadcast).toHaveBeenCalledWith('audio-host:event', expect.objectContaining({ value: expect.objectContaining({ state: 'paused', error: expect.objectContaining({ code: 'OUTPUT_DEVICE_BUSY' }) }) }));
  });
});

function playerHarness(saved: Record<string, unknown> = {}) {
  const state = new BehaviorSubject<any>({ state: 'idle', track: null });
  let backend = 'chromium';
  const engine: any = {
    stateChange$: state, timeUpdate$: new Subject(), volumeChange$: new Subject(),
    subscribeDeviceChanges: () => () => undefined,
    setBackend: vi.fn(async (value: string) => { backend = value; }), getBackend: () => backend,
    setOutputMode: vi.fn(async () => undefined), setOutputFallbackEnabled: vi.fn(),
    setVolume: vi.fn(), setMute: vi.fn(), cancelPreparedNext: vi.fn(), prepareNext: vi.fn(async () => false),
    listOutputDevices: async () => [{ id: 'tec', name: 'TE-C', isConnected: true, supportedModes: ['shared','exclusive-dsp'] }],
    getAudioPathStatus: async () => ({ preferredDeviceId: 'tec', activeDeviceId: 'tec', isConnected: true, mode: 'shared' }),
    selectOutputDevice: vi.fn(async () => undefined), pause: vi.fn(), play: vi.fn(), dispose: vi.fn(),
  };
  const gateway = { getSettings: async () => saved, saveSettings: vi.fn(async (value: any) => value) };
  const injector = Injector.create({ providers: [{ provide: PLAYBACK_ENGINE, useValue: engine }, { provide: SETTINGS_GATEWAY, useValue: gateway }] });
  const player = runInInjectionContext(injector, () => new PlayerService());
  return { player, engine, gateway };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('Exclusive player settings', () => {
  it('allows Shared after the selected DAC disappears while still guarding Exclusive', async () => {
    const { player, engine, gateway } = playerHarness({ audioEngineBackend: 'native-shared', preferredNativeAudioOutputId: 'tec', outputMode: 'exclusive-dsp', exclusiveBufferMs: 40 });
    await flush();
    player.outputDevices.set([]);
    expect(player.exclusiveModeDisabledReason()).toBeTruthy();
    engine.setOutputMode.mockClear();
    await player.setAudioOutputMode('exclusive-dsp');
    expect(engine.setOutputMode).not.toHaveBeenCalled();
    await player.setAudioOutputMode('shared');
    expect(engine.setOutputMode).toHaveBeenCalledExactlyOnceWith('shared', 40);
    expect(player.outputMode()).toBe('shared');
    expect(gateway.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ outputMode: 'shared', exclusiveBufferMs: 40 }));
    player.ngOnDestroy();
  });

  it('restores mode and buffer before selecting the native device', async () => {
    const { player, engine } = playerHarness({ audioEngineBackend: 'native-shared', preferredNativeAudioOutputId: 'tec', outputMode: 'exclusive-dsp', exclusiveBufferMs: 40 });
    await flush();
    expect(engine.setOutputMode).toHaveBeenCalledWith('exclusive-dsp',40);
    expect(engine.setOutputMode.mock.invocationCallOrder[0]).toBeLessThan(engine.selectOutputDevice.mock.invocationCallOrder[0]);
    expect(player.outputMode()).toBe('exclusive-dsp');
    player.ngOnDestroy();
  });

  it('selecting an output does not overwrite the saved mode', async () => {
    const { player, gateway } = playerHarness({ audioEngineBackend: 'native-shared', preferredNativeAudioOutputId: 'tec', outputMode: 'exclusive-dsp' });
    await flush(); await player.selectAudioOutput('tec');
    expect(gateway.saveSettings.mock.calls.every(([value]) => !('outputMode' in value))).toBe(true);
    player.ngOnDestroy();
  });

  it('Chromium retains the Exclusive preference and explains actual Shared output', async () => {
    const { player, engine } = playerHarness({ audioEngineBackend: 'chromium', outputMode: 'exclusive-dsp', exclusiveBufferMs: 80 });
    await flush();
    expect(player.outputMode()).toBe('exclusive-dsp');
    expect(player.exclusiveBufferMs()).toBe(80);
    expect(engine.setOutputMode).not.toHaveBeenCalled();
    expect(player.playbackNotice()).toContain('Chromium Shared');
    player.ngOnDestroy();
  });

  it('failed Exclusive mode changes remain paused with no fallback or retry', async () => {
    const { player, engine } = playerHarness({ audioEngineBackend: 'native-shared', preferredNativeAudioOutputId: 'tec' });
    await flush();
    engine.setOutputMode.mockRejectedValue(Object.assign(new Error(), { code: 'OUTPUT_EXCLUSIVE_NOT_ALLOWED' }));
    await player.setAudioOutputMode('exclusive-dsp');
    expect(player.playbackState()).toBe('paused');
    expect(player.playbackNotice()).toContain('Windows blocks Exclusive');
    expect(player.audioEngineBackend()).toBe('native-shared');
    expect(player.outputMode()).toBe('shared');
    expect(engine.play).not.toHaveBeenCalled();
    player.ngOnDestroy();
  });

  it('an Exclusive error during backend activation does not fall back to Chromium', async () => {
    const { player, engine } = playerHarness({ audioEngineBackend: 'chromium', outputMode: 'exclusive-dsp' });
    await flush();
    engine.setOutputMode.mockRejectedValue(Object.assign(new Error(), { code: 'OUTPUT_DEVICE_BUSY' }));
    await player.switchAudioBackend('native-shared');
    expect(player.audioEngineBackend()).toBe('native-shared');
    expect(player.playbackState()).toBe('paused');
    expect(engine.setBackend.mock.calls.at(-1)).toEqual(['native-shared']);
    expect(engine.play).not.toHaveBeenCalled();
    player.ngOnDestroy();
  });

  it('volume events refresh actual processing reasons from Native', async () => {
    const { player, engine } = playerHarness({ audioEngineBackend: 'native-shared', preferredNativeAudioOutputId: 'tec' });
    await flush();
    engine.getAudioPathStatus = vi.fn(async () => ({ mode: 'exclusive-dsp', processingReasons: ['Exclusive DSP mode'], isConnected: true }));
    engine.volumeChange$.next({ volume: 1, isMuted: false });
    await flush();
    expect(engine.getAudioPathStatus).toHaveBeenCalledTimes(1);
    expect(player.audioPathStatus()?.processingReasons).toEqual(['Exclusive DSP mode']);
    player.ngOnDestroy();
  });
});
