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

export const OPTIONAL_SONG_COLUMNS = ['index', 'artist', 'album', 'duration', 'codec', 'sampleRate', 'actions'] as const;
export type SongColumn = (typeof OPTIONAL_SONG_COLUMNS)[number];

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
  themePreset: ThemePreset;
  accentColor: AccentColor;
  hiddenSongColumns: SongColumn[];
}
