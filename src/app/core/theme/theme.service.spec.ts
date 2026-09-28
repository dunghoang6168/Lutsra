import { TestBed } from '@angular/core/testing';
import { SETTINGS_GATEWAY, SettingsGateway } from '../contracts';
import { Settings, ThemePreset } from '../models';
import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  let gateway: SettingsGatewayStub;
  let service: ThemeService;

  beforeEach(() => {
    gateway = new SettingsGatewayStub();
    TestBed.configureTestingModule({ providers: [{ provide: SETTINGS_GATEWAY, useValue: gateway }] });
    service = TestBed.inject(ThemeService);
    TestBed.tick();
  });

  it('restores the saved theme and accent on the document root', async () => {
    gateway.settings.themePreset = 'light';
    gateway.settings.accentColor = 'cyan';

    await service.restore();
    TestBed.tick();

    expect(service.themePreset()).toBe('light');
    expect(service.accentColor()).toBe('cyan');
    expect(document.documentElement.dataset['theme']).toBe('light');
    expect(document.documentElement.dataset['accent']).toBe('cyan');
    expect(service.saveState()).toBe('idle');
  });

  it('falls back to dark and violet for missing legacy values', async () => {
    gateway.settings = { ...gateway.settings, themePreset: undefined, accentColor: undefined } as unknown as Settings;

    await service.restore();
    TestBed.tick();

    expect(service.themePreset()).toBe('dark');
    expect(service.accentColor()).toBe('violet');
  });

  it('maps saved legacy palettes to the corresponding dark or light theme', async () => {
    gateway.settings = { ...gateway.settings, themePreset: 'ocean' } as unknown as Settings;
    await service.restore();
    TestBed.tick();
    expect(service.themePreset()).toBe('dark');

    gateway.settings = { ...gateway.settings, themePreset: 'sage' } as unknown as Settings;
    await service.restore();
    TestBed.tick();
    expect(service.themePreset()).toBe('light');
  });

  it('applies and persists theme changes', async () => {
    await service.setThemePreset('light');
    await service.setAccentColor('amber');
    TestBed.tick();

    expect(document.documentElement.dataset['theme']).toBe('light');
    expect(document.documentElement.dataset['accent']).toBe('amber');
    expect(gateway.settings.themePreset).toBe('light');
    expect(gateway.settings.accentColor).toBe('amber');
    expect(service.saveState()).toBe('saved');
    expect(service.errorMessage()).toBeNull();
  });

  it('persists rapid theme changes in order', async () => {
    const themeSave = service.setThemePreset('dark');
    const accentSave = service.setAccentColor('rose');

    await Promise.all([themeSave, accentSave]);
    TestBed.tick();

    expect(gateway.savedValues).toEqual([
      { themePreset: 'dark', accentColor: 'violet' },
      { themePreset: 'dark', accentColor: 'rose' },
    ]);
    expect(service.saveState()).toBe('saved');
  });

  it('rolls back the latest selection when persistence fails', async () => {
    gateway.settings.themePreset = 'dark';
    gateway.settings.accentColor = 'cyan';
    await service.restore();
    gateway.saveError = new Error('Settings storage is unavailable');

    await service.setThemePreset('light');
    TestBed.tick();

    expect(service.themePreset()).toBe('dark');
    expect(service.accentColor()).toBe('cyan');
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(service.saveState()).toBe('error');
    expect(service.errorMessage()).toBe('Settings storage is unavailable');
  });

  it('applies the semantic canvas and color scheme for every preset', async () => {
    const palettes: Record<ThemePreset, { canvas: string; colorScheme: 'dark' | 'light' }> = {
      dark: { canvas: '#111214', colorScheme: 'dark' },
      light: { canvas: '#f1f4f8', colorScheme: 'light' },
    };

    for (const [themePreset, expected] of Object.entries(palettes) as Array<[ThemePreset, typeof palettes[ThemePreset]]>) {
      await service.setThemePreset(themePreset);
      TestBed.tick();

      const root = document.documentElement;
      const styles = getComputedStyle(root);
      expect(root.dataset['theme']).toBe(themePreset);
      expect(root.style.colorScheme).toBe(expected.colorScheme);
      expect(styles.getPropertyValue('--color-canvas').trim().toLowerCase()).toBe(expected.canvas);
    }
  });
});

class SettingsGatewayStub implements SettingsGateway {
  saveError: Error | null = null;
  savedValues: Partial<Settings>[] = [];
  settings: Settings = {
    musicFolders: [],
    defaultVolume: 0.8,
    repeatMode: 'off',
    shuffle: false,
    themePreset: 'dark',
    accentColor: 'violet',
    layoutMode: 'inset',
    hiddenSongColumns: [],
    songColumnOrder: ['artist', 'album', 'duration', 'codec', 'sampleRate', 'lyrics'],
  };

  async getSettings(): Promise<Settings> {
    return { ...this.settings };
  }

  async saveSettings(settings: Partial<Settings>): Promise<Settings> {
    if (this.saveError) throw this.saveError;
    this.savedValues.push({ ...settings });
    this.settings = { ...this.settings, ...settings };
    return { ...this.settings };
  }
}
