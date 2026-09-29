import { Injectable } from '@angular/core';
import { SettingsGateway } from '../contracts/settings.gateway';
import { DEFAULT_AUDIO_VISUALIZATION_MODE, DEFAULT_LAYOUT_MODE, DEFAULT_SONG_COLUMN_ORDER, isAudioVisualizationMode, isLayoutMode, normalizeHiddenSongColumns, normalizeSongColumnOrder, Settings } from '../models';
import { MOCK_FOLDERS } from './fixtures/mock-data';

@Injectable({ providedIn: 'root' })
export class MockSettingsGateway implements SettingsGateway {
  private settings: Settings = {
    musicFolders: JSON.parse(JSON.stringify(MOCK_FOLDERS)),
    defaultVolume: 0.8,
    repeatMode: 'off',
    shuffle: false,
    themePreset: 'dark',
    accentColor: 'violet',
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
