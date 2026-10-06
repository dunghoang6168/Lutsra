export const SYSTEM_DEFAULT_OUTPUT_ID = 'system-default';

export type AudioEngineBackend = 'chromium' | 'native-shared';
export type OutputMode = 'shared' | 'exclusive-dsp' | 'exclusive-bitperfect';
export type AudioHostState = 'unavailable' | 'stopped' | 'starting' | 'ready' | 'recovering' | 'failed';

export interface AudioFormat {
  sampleRate: number | null;
  bitDepth: number | null;
  channels: number | null;
  /** PCM container width when probing Exclusive; bitDepth is the valid precision. */
  containerBits?: number;
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
  /** Format Lutstra hands to the output; in WASAPI Shared this is the engine mix format. */
  outputFormat: AudioFormat | null;
  /** Sample type of outputFormat. WASAPI Shared mixes in 32-bit float. */
  outputSampleType?: 'float' | 'integer';
  /** Format Windows sends to the hardware (Sound settings → Format), when known. */
  deviceFormat?: AudioFormat | null;
  isConnected: boolean;
  capabilitiesAvailable: boolean;
  reason: string | null;
  backend: AudioEngineBackend;
  hostState: AudioHostState;
  resamplingActive: boolean;
  channelConversionActive: boolean;
  bitPerfectEligible: boolean;
  processingReasons: string[];
  /** Actual endpoint period after driver alignment, in milliseconds. */
  bufferMs?: number;
  /** Bounded stop-fade waits that expired without a render acknowledgement. */
  stopFadeTimeouts?: number;
}
