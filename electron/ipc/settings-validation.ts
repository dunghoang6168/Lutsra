import { isAccentColor, isLayoutMode, isSongColumn, isSongColumnOrder, isThemePreset } from '../../src/app/core/models/index.js';

export function validSettings(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid settings');
  const input = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  if ('defaultVolume' in input) { if (typeof input['defaultVolume'] !== 'number') throw new Error('Invalid volume'); result['defaultVolume'] = input['defaultVolume']; }
  if ('repeatMode' in input) { if (!['off','one','all'].includes(String(input['repeatMode']))) throw new Error('Invalid repeat mode'); result['repeatMode'] = input['repeatMode']; }
  if ('shuffle' in input) { if (typeof input['shuffle'] !== 'boolean') throw new Error('Invalid shuffle setting'); result['shuffle'] = input['shuffle']; }
  if ('themePreset' in input) { if (!isThemePreset(input['themePreset'])) throw new Error('Invalid theme preset'); result['themePreset'] = input['themePreset']; }
  if ('accentColor' in input) { if (!isAccentColor(input['accentColor'])) throw new Error('Invalid accent color'); result['accentColor'] = input['accentColor']; }
  if ('layoutMode' in input) { if (!isLayoutMode(input['layoutMode'])) throw new Error('Invalid layout mode'); result['layoutMode'] = input['layoutMode']; }
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
