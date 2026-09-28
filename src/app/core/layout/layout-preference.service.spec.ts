import { TestBed } from '@angular/core/testing';
import { SETTINGS_GATEWAY, SettingsGateway } from '../contracts';
import { DEFAULT_LAYOUT_MODE, Settings } from '../models';
import { LayoutPreferenceService } from './layout-preference.service';

describe('LayoutPreferenceService', () => {
  let gateway: LayoutGatewayStub;
  let service: LayoutPreferenceService;

  beforeEach(() => {
    gateway = new LayoutGatewayStub();
    TestBed.configureTestingModule({ providers: [{ provide: SETTINGS_GATEWAY, useValue: gateway }] });
    service = TestBed.inject(LayoutPreferenceService);
  });

  it('defaults to Panel and restores a saved layout', async () => {
    expect(service.mode()).toBe(DEFAULT_LAYOUT_MODE);
    gateway.settings.layoutMode = 'classic';
    await service.restore();
    expect(service.mode()).toBe('classic');
  });

  it('applies immediately, persists, and rolls back when saving fails', async () => {
    await service.restore();
    const saved = service.setMode('classic');
    expect(service.mode()).toBe('classic');
    expect(service.saveState()).toBe('saving');
    await saved;
    expect(gateway.settings.layoutMode).toBe('classic');
    expect(service.saveState()).toBe('saved');

    gateway.saveError = new Error('Disk unavailable');
    await service.setMode('inset');
    expect(service.mode()).toBe('classic');
    expect(service.saveState()).toBe('error');
    expect(service.errorMessage()).toBe('Disk unavailable');
  });

  it('keeps the newest choice when changes are saved in order', async () => {
    await service.restore();
    const first = service.setMode('classic');
    const second = service.setMode('inset');
    await Promise.all([first, second]);
    expect(gateway.savedModes).toEqual(['classic', 'inset']);
    expect(service.mode()).toBe('inset');
    expect(gateway.settings.layoutMode).toBe('inset');
  });
});

class LayoutGatewayStub implements SettingsGateway {
  saveError: Error | null = null;
  savedModes: string[] = [];
  settings = { layoutMode: 'inset' } as Settings;

  async getSettings(): Promise<Settings> { return { ...this.settings }; }
  async saveSettings(value: Partial<Settings>): Promise<Settings> {
    if (this.saveError) throw this.saveError;
    this.savedModes.push(value.layoutMode!);
    this.settings = { ...this.settings, ...value };
    return { ...this.settings };
  }
}
