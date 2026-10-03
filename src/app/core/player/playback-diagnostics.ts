export type PlaybackDiagnosticOperation =
  | 'load'
  | 'play'
  | 'pause'
  | 'seek'
  | 'transition'
  | 'device-list'
  | 'device-select'
  | 'device-change'
  | 'suspend'
  | 'resume';

export interface PlaybackDiagnosticDetail {
  operation: PlaybackDiagnosticOperation;
  state?: string;
  errorCode?: string;
  trackId?: string;
  deviceId?: string;
}

export function logPlaybackDiagnostic(level: 'info' | 'warn' | 'error', detail: PlaybackDiagnosticDetail): void {
  const safe = {
    operation: detail.operation,
    ...(detail.state ? { state: detail.state } : {}),
    ...(detail.errorCode ? { errorCode: detail.errorCode } : {}),
    ...(detail.trackId ? { trackId: detail.trackId } : {}),
    ...(detail.deviceId ? { deviceId: detail.deviceId } : {}),
  };
  console[level]('[audio]', safe);
}
