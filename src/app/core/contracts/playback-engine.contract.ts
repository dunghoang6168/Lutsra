import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';
import { AudioEngineBackend, AudioOutputDevice, AudioPathStatus, OutputMode, Track, PlaybackStateEvent, PlaybackTimeEvent, PlaybackVolumeEvent } from '../models';

export interface PlaybackEngine {
  load(track: Track): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  seek(positionSeconds: number): void;
  setVolume(volume: number): void;
  setMute(isMuted: boolean): void;
  prepareNext(track: Track): Promise<boolean>;
  cancelPreparedNext(): void;
  transitionTo(track: Track, crossfadeSeconds: number): Promise<boolean>;
  listOutputDevices(): Promise<AudioOutputDevice[]>;
  selectOutputDevice(deviceId: string): Promise<void>;
  setOutputFallbackEnabled(enabled: boolean): void;
  setOutputMode(mode: OutputMode): Promise<void>;
  getAudioPathStatus(): Promise<AudioPathStatus>;
  subscribeDeviceChanges(listener: () => void): () => void;
  getBackend(): AudioEngineBackend;
  setBackend(backend: AudioEngineBackend): Promise<void>;
  dispose(): void;

  readonly stateChange$: Observable<PlaybackStateEvent>;
  readonly timeUpdate$: Observable<PlaybackTimeEvent>;
  readonly volumeChange$: Observable<PlaybackVolumeEvent>;
  readonly outputInterrupted$?: Observable<'device-invalidated' | 'device-busy'>;
  /** Emits when the engine itself continued gaplessly into the prepared track. */
  readonly trackAutoAdvanced$?: Observable<Track>;
}

export const PLAYBACK_ENGINE = new InjectionToken<PlaybackEngine>('PLAYBACK_ENGINE');
