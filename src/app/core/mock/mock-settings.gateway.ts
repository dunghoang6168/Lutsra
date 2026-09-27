import { Injectable } from '@angular/core';
import { SettingsGateway } from '../contracts/settings.gateway';
import { normalizeHiddenSongColumns, Settings } from '../models';
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
    hiddenSongColumns: [],
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
      hiddenSongColumns: settings.hiddenSongColumns === undefined ? this.settings.hiddenSongColumns : normalizeHiddenSongColumns(settings.hiddenSongColumns),
    };
    return JSON.parse(JSON.stringify(this.settings));
  }
}
