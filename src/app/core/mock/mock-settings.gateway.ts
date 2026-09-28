import { Injectable } from '@angular/core';
import { SettingsGateway } from '../contracts/settings.gateway';
import { DEFAULT_LAYOUT_MODE, DEFAULT_SONG_COLUMN_ORDER, isLayoutMode, normalizeHiddenSongColumns, normalizeSongColumnOrder, Settings } from '../models';
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
      hiddenSongColumns: settings.hiddenSongColumns === undefined ? this.settings.hiddenSongColumns : normalizeHiddenSongColumns(settings.hiddenSongColumns),
      songColumnOrder: settings.songColumnOrder === undefined ? this.settings.songColumnOrder : normalizeSongColumnOrder(settings.songColumnOrder),
    };
    if (settings.layoutMode !== undefined) {
      try { localStorage.setItem('lutsra.layout.mode', this.settings.layoutMode); } catch { /* Browser storage is optional. */ }
    }
    return JSON.parse(JSON.stringify(this.settings));
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
