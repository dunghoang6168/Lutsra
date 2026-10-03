export const SYSTEM_DEFAULT_OUTPUT_ID = 'system-default';

export type AudioEngineBackend = 'chromium' | 'native-shared';
export type OutputMode = 'shared' | 'exclusive-dsp' | 'exclusive-bitperfect';
export type AudioHostState = 'unavailable' | 'stopped' | 'starting' | 'ready' | 'recovering' | 'failed';

export interface AudioFormat {
  sampleRate: number | null;
  bitDepth: number | null;
  channels: number | null;
}

export interface AudioOutputDevice {
  id: string;
  name: string;
  isDefault: boolean;
  isConnected: boolean;
  supportedModes: OutputMode[];
  supportedFormats: AudioFormat[] | null;
  mixFormat: AudioFormat | null;
}

export interface AudioPathStatus {
  preferredDeviceId: string;
  activeDeviceId: string | null;
  deviceName: string;
  mode: OutputMode;
  sourceFormat: AudioFormat | null;
  outputFormat: AudioFormat | null;
  isConnected: boolean;
  capabilitiesAvailable: boolean;
  reason: string | null;
  backend: AudioEngineBackend;
  hostState: AudioHostState;
  resamplingActive: boolean;
  channelConversionActive: boolean;
  bitPerfectEligible: boolean;
  processingReasons: string[];
}
