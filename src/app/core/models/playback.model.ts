import { Track } from './track.model';

export type PlaybackState = 'idle' | 'loading' | 'playing' | 'paused' | 'buffering' | 'ended' | 'error';

export type PlaybackErrorCode =
  | 'FILE_UNAVAILABLE'
  | 'MEDIA_ABORTED'
  | 'MEDIA_NETWORK'
  | 'MEDIA_DECODE'
  | 'MEDIA_UNSUPPORTED'
  | 'MEDIA_UNKNOWN'
  | 'OUTPUT_DEVICE_UNAVAILABLE'
  | 'OUTPUT_DEVICE_PERMISSION_DENIED'
  | 'OUTPUT_DEVICE_UNSUPPORTED'
  | 'OUTPUT_MODE_UNSUPPORTED'
  | 'AUDIO_HOST_UNAVAILABLE'
  | 'AUDIO_HOST_PROTOCOL_ERROR'
  | 'PLAYBACK_FAILED';

export interface PlaybackError {
  code: PlaybackErrorCode;
  message: string;
  trackId?: string;
}

export interface PlaybackTimeEvent {
  currentTime: number; // in seconds
  duration: number; // in seconds
}

export interface PlaybackStateEvent {
  state: PlaybackState;
  track: Track | null;
  error?: PlaybackError;
}

export interface PlaybackVolumeEvent {
  volume: number; // 0.0 to 1.0
  isMuted: boolean;
}
