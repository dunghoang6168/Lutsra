import { MusicFolder } from './folder.model';

export type RepeatMode = 'off' | 'one' | 'all';

export const DARK_THEME_PRESETS = ['dark'] as const;

export const LIGHT_THEME_PRESETS = ['light'] as const;

export const THEME_PRESETS = [...DARK_THEME_PRESETS, ...LIGHT_THEME_PRESETS] as const;
export type ThemePreset = (typeof THEME_PRESETS)[number];

export const ACCENT_COLORS = ['violet', 'blue', 'cyan', 'emerald', 'amber', 'rose'] as const;
export type AccentColor = (typeof ACCENT_COLORS)[number];

export const DEFAULT_THEME_PRESET: ThemePreset = 'dark';
export const DEFAULT_ACCENT_COLOR: AccentColor = 'violet';
export const DEFAULT_LIQUID_GLASS_ACCENT_COLOR: AccentColor = 'rose';

export const LAYOUT_MODES = ['inset', 'classic', 'liquid-glass'] as const;
export type LayoutMode = (typeof LAYOUT_MODES)[number];
export const DEFAULT_LAYOUT_MODE: LayoutMode = 'inset';

export const AUDIO_VISUALIZATION_MODES = ['spectrum', 'waveform'] as const;
export type AudioVisualizationMode = (typeof AUDIO_VISUALIZATION_MODES)[number];
export const DEFAULT_AUDIO_VISUALIZATION_MODE: AudioVisualizationMode = 'spectrum';

export function isAudioVisualizationMode(value: unknown): value is AudioVisualizationMode {
  return typeof value === 'string' && (AUDIO_VISUALIZATION_MODES as readonly string[]).includes(value);
}

export function isLayoutMode(value: unknown): value is LayoutMode {
  return typeof value === 'string' && (LAYOUT_MODES as readonly string[]).includes(value);
}

export function isThemePreset(value: unknown): value is ThemePreset {
  return typeof value === 'string' && (THEME_PRESETS as readonly string[]).includes(value);
}

export function normalizeThemePreset(value: unknown): ThemePreset {
  if (isThemePreset(value)) return value;
  if (typeof value === 'string') {
    if (['midnight', 'graphite', 'ocean', 'forest'].includes(value)) return 'dark';
    if (['porcelain', 'cloud', 'sky', 'sage'].includes(value)) return 'light';
  }
  return DEFAULT_THEME_PRESET;
}

export function isAccentColor(value: unknown): value is AccentColor {
  return typeof value === 'string' && (ACCENT_COLORS as readonly string[]).includes(value);
}

export const OPTIONAL_SONG_COLUMNS = ['index', 'artist', 'album', 'duration', 'codec', 'sampleRate', 'lyrics', 'actions'] as const;
export type SongColumn = (typeof OPTIONAL_SONG_COLUMNS)[number];
export const DEFAULT_SONG_COLUMN_ORDER = ['artist', 'album', 'duration', 'codec', 'sampleRate', 'lyrics'] as const;
export type ReorderableSongColumn = (typeof DEFAULT_SONG_COLUMN_ORDER)[number];

export function isReorderableSongColumn(value: unknown): value is ReorderableSongColumn {
  return typeof value === 'string' && (DEFAULT_SONG_COLUMN_ORDER as readonly string[]).includes(value);
}

export function normalizeSongColumnOrder(value: unknown): ReorderableSongColumn[] {
  const selected = Array.isArray(value) ? [...new Set(value.filter(isReorderableSongColumn))] : [];
  return [...selected, ...DEFAULT_SONG_COLUMN_ORDER.filter((column) => !selected.includes(column))];
}

export function isSongColumnOrder(value: unknown): value is ReorderableSongColumn[] {
  return Array.isArray(value) && value.length === DEFAULT_SONG_COLUMN_ORDER.length
    && value.every(isReorderableSongColumn) && new Set(value).size === value.length;
}

export function isSongColumn(value: unknown): value is SongColumn {
  return typeof value === 'string' && (OPTIONAL_SONG_COLUMNS as readonly string[]).includes(value);
}

export function normalizeHiddenSongColumns(value: unknown): SongColumn[] {
  return Array.isArray(value) ? [...new Set(value.filter(isSongColumn))] : [];
}

export interface Settings {
  musicFolders: MusicFolder[];
  defaultVolume: number; // 0.0 to 1.0
  repeatMode: RepeatMode;
  shuffle: boolean;
  crossfadeEnabled: boolean;
  crossfadeSeconds: number;
  preferredAudioOutputId: string;
  preferredAudioOutputName: string;
  outputMode: 'shared';
  audioOutputFallbackEnabled: boolean;
  audioEngineBackend: 'chromium' | 'native-shared';
  preferredNativeAudioOutputId: string;
  preferredNativeAudioOutputName: string;
  themePreset: ThemePreset;
  accentColor: AccentColor;
  liquidGlassAccentColor: AccentColor;
  layoutMode: LayoutMode;
  audioVisualizationMode: AudioVisualizationMode;
  hiddenSongColumns: SongColumn[];
  songColumnOrder: ReorderableSongColumn[];
}
