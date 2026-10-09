import { validOutputMode, validExclusiveBufferMs } from './ipc-validation.js';
import { isAccentColor, isAddTracksTab, isAudioVisualizationMode, isLayoutMode, isSongColumn, isSongColumnOrder, isThemePreset } from '../../src/app/core/models/index.js';

export function validSettings(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid settings');
  const input = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  if ('defaultVolume' in input) { if (typeof input['defaultVolume'] !== 'number') throw new Error('Invalid volume'); result['defaultVolume'] = input['defaultVolume']; }
  if ('repeatMode' in input) { if (!['off','one','all'].includes(String(input['repeatMode']))) throw new Error('Invalid repeat mode'); result['repeatMode'] = input['repeatMode']; }
  if ('shuffle' in input) { if (typeof input['shuffle'] !== 'boolean') throw new Error('Invalid shuffle setting'); result['shuffle'] = input['shuffle']; }
  if ('crossfadeEnabled' in input) { if (typeof input['crossfadeEnabled'] !== 'boolean') throw new Error('Invalid crossfade setting'); result['crossfadeEnabled'] = input['crossfadeEnabled']; }
  if ('crossfadeSeconds' in input) { if (typeof input['crossfadeSeconds'] !== 'number' || !Number.isInteger(input['crossfadeSeconds']) || input['crossfadeSeconds'] < 1 || input['crossfadeSeconds'] > 12) throw new Error('Invalid crossfade duration'); result['crossfadeSeconds'] = input['crossfadeSeconds']; }
  if ('audioEngineBackend' in input) { if (!['chromium','native-shared'].includes(String(input['audioEngineBackend']))) throw new Error('Invalid audio engine backend'); result['audioEngineBackend'] = input['audioEngineBackend']; }
  if ('preferredAudioOutputId' in input) { if (typeof input['preferredAudioOutputId'] !== 'string' || input['preferredAudioOutputId'].length < 1 || input['preferredAudioOutputId'].length > 512) throw new Error('Invalid audio output ID'); result['preferredAudioOutputId'] = input['preferredAudioOutputId']; }
  if ('preferredAudioOutputName' in input) { if (typeof input['preferredAudioOutputName'] !== 'string' || input['preferredAudioOutputName'].length > 256) throw new Error('Invalid audio output name'); result['preferredAudioOutputName'] = input['preferredAudioOutputName']; }
  if ('preferredNativeAudioOutputId' in input) { if (typeof input['preferredNativeAudioOutputId'] !== 'string' || input['preferredNativeAudioOutputId'].length < 1 || input['preferredNativeAudioOutputId'].length > 512) throw new Error('Invalid native audio output ID'); result['preferredNativeAudioOutputId'] = input['preferredNativeAudioOutputId']; }
  if ('preferredNativeAudioOutputName' in input) { if (typeof input['preferredNativeAudioOutputName'] !== 'string' || input['preferredNativeAudioOutputName'].length > 256) throw new Error('Invalid native audio output name'); result['preferredNativeAudioOutputName'] = input['preferredNativeAudioOutputName']; }
  if ('outputMode' in input) result['outputMode'] = validOutputMode(input['outputMode']);
  if ('exclusiveBufferMs' in input) result['exclusiveBufferMs'] = validExclusiveBufferMs(input['exclusiveBufferMs']);
  if ('audioOutputFallbackEnabled' in input) { if (typeof input['audioOutputFallbackEnabled'] !== 'boolean') throw new Error('Invalid audio fallback setting'); result['audioOutputFallbackEnabled'] = input['audioOutputFallbackEnabled']; }
  if ('themePreset' in input) { if (!isThemePreset(input['themePreset'])) throw new Error('Invalid theme preset'); result['themePreset'] = input['themePreset']; }
  if ('accentColor' in input) { if (!isAccentColor(input['accentColor'])) throw new Error('Invalid accent color'); result['accentColor'] = input['accentColor']; }
  if ('liquidGlassAccentColor' in input) { if (!isAccentColor(input['liquidGlassAccentColor'])) throw new Error('Invalid Liquid Glass accent color'); result['liquidGlassAccentColor'] = input['liquidGlassAccentColor']; }
  if ('layoutMode' in input) { if (!isLayoutMode(input['layoutMode'])) throw new Error('Invalid layout mode'); result['layoutMode'] = input['layoutMode']; }
  if ('audioVisualizationMode' in input) { if (!isAudioVisualizationMode(input['audioVisualizationMode'])) throw new Error('Invalid audio visualization mode'); result['audioVisualizationMode'] = input['audioVisualizationMode']; }
  if ('addTracksTab' in input) { if (!isAddTracksTab(input['addTracksTab'])) throw new Error('Invalid Add tracks tab'); result['addTracksTab'] = input['addTracksTab']; }
  if ('hiddenSongColumns' in input) {
    const columns = input['hiddenSongColumns'];
    if (!Array.isArray(columns) || !columns.every(isSongColumn)) throw new Error('Invalid Songs columns');
    result['hiddenSongColumns'] = [...new Set(columns)];
  }
  if ('songColumnOrder' in input) {
    if (!isSongColumnOrder(input['songColumnOrder'])) throw new Error('Invalid Songs column order');
    result['songColumnOrder'] = [...input['songColumnOrder']];
  }
  return result;
}
