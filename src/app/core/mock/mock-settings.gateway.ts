import { Injectable } from '@angular/core';
import { SettingsGateway } from '../contracts/settings.gateway';
import { DEFAULT_AUDIO_VISUALIZATION_MODE, DEFAULT_LAYOUT_MODE, DEFAULT_LIQUID_GLASS_ACCENT_COLOR, DEFAULT_SONG_COLUMN_ORDER, isAccentColor, isAudioVisualizationMode, isLayoutMode, normalizeHiddenSongColumns, normalizeSongColumnOrder, Settings } from '../models';
import { MOCK_FOLDERS } from './fixtures/mock-data';

@Injectable({ providedIn: 'root' })
export class MockSettingsGateway implements SettingsGateway {
  private settings: Settings = {
    musicFolders: JSON.parse(JSON.stringify(MOCK_FOLDERS)),
    defaultVolume: 0.8,
    repeatMode: 'off',
    shuffle: false,
    crossfadeEnabled: true,
    crossfadeSeconds: 5,
    audioEngineBackend: 'chromium',
    preferredAudioOutputId: 'system-default',
    preferredAudioOutputName: 'System Default',
    preferredNativeAudioOutputId: 'system-default',
    preferredNativeAudioOutputName: 'System Default',
    outputMode: 'shared',
    exclusiveBufferMs: 20,
    audioOutputFallbackEnabled: false,
    themePreset: 'dark',
    accentColor: 'violet',
    liquidGlassAccentColor: DEFAULT_LIQUID_GLASS_ACCENT_COLOR,
    layoutMode: readLayoutMode(),
    audioVisualizationMode: readAudioVisualizationMode(),
    hiddenSongColumns: [],
    songColumnOrder: [...DEFAULT_SONG_COLUMN_ORDER],
  };

  async getSettings(): Promise<Settings> {
    await new Promise((resolve) => setTimeout(resolve, 30));
    return JSON.parse(JSON.stringify(this.settings));
  }

  async saveSettings(settings: Partial<Settings>): Promise<Settings> {
    await new Promise((resolve) => setTimeout(resolve, 30));
    this.settings = {
      ...this.settings,
      ...settings,
      crossfadeEnabled: typeof settings.crossfadeEnabled === 'boolean' ? settings.crossfadeEnabled : this.settings.crossfadeEnabled,
      crossfadeSeconds: Number.isInteger(settings.crossfadeSeconds) && settings.crossfadeSeconds! >= 1 && settings.crossfadeSeconds! <= 12 ? settings.crossfadeSeconds! : this.settings.crossfadeSeconds,
      accentColor: isAccentColor(settings.accentColor) ? settings.accentColor : this.settings.accentColor,
      liquidGlassAccentColor: isAccentColor(settings.liquidGlassAccentColor) ? settings.liquidGlassAccentColor : this.settings.liquidGlassAccentColor,
      layoutMode: isLayoutMode(settings.layoutMode) ? settings.layoutMode : this.settings.layoutMode,
      audioVisualizationMode: isAudioVisualizationMode(settings.audioVisualizationMode) ? settings.audioVisualizationMode : this.settings.audioVisualizationMode,
      hiddenSongColumns: settings.hiddenSongColumns === undefined ? this.settings.hiddenSongColumns : normalizeHiddenSongColumns(settings.hiddenSongColumns),
      songColumnOrder: settings.songColumnOrder === undefined ? this.settings.songColumnOrder : normalizeSongColumnOrder(settings.songColumnOrder),
    };
    if (settings.layoutMode !== undefined) {
      try { localStorage.setItem('lutsra.layout.mode', this.settings.layoutMode); } catch { /* Browser storage is optional. */ }
    }
    if (settings.audioVisualizationMode !== undefined) {
      try { localStorage.setItem('lutsra.audio.visualization', this.settings.audioVisualizationMode); } catch { /* Browser storage is optional. */ }
    }
    return JSON.parse(JSON.stringify(this.settings));
  }
}

function readAudioVisualizationMode(): Settings['audioVisualizationMode'] {
  try {
    const mode = localStorage.getItem('lutsra.audio.visualization');
    return isAudioVisualizationMode(mode) ? mode : DEFAULT_AUDIO_VISUALIZATION_MODE;
  } catch {
    return DEFAULT_AUDIO_VISUALIZATION_MODE;
  }
}

function readLayoutMode(): Settings['layoutMode'] {
  try {
    const mode = localStorage.getItem('lutsra.layout.mode');
    return isLayoutMode(mode) ? mode : DEFAULT_LAYOUT_MODE;
  } catch {
    return DEFAULT_LAYOUT_MODE;
  }
}
