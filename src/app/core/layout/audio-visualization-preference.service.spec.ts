import { TestBed } from '@angular/core/testing';
import { SETTINGS_GATEWAY, SettingsGateway } from '../contracts';
import { Settings } from '../models';
import { AudioVisualizationPreferenceService } from './audio-visualization-preference.service';

describe('AudioVisualizationPreferenceService', () => {
  it('defaults legacy settings to Spectrum and persists a Waveform selection', async () => {
    const settings = { layoutMode: 'inset' } as Settings;
    const gateway: SettingsGateway = {
      getSettings: async () => settings,
      saveSettings: async (patch) => Object.assign(settings, patch),
    };
    TestBed.configureTestingModule({ providers: [{ provide: SETTINGS_GATEWAY, useValue: gateway }] });
    const preference = TestBed.inject(AudioVisualizationPreferenceService);

    await preference.restore();
    expect(preference.mode()).toBe('spectrum');
    await preference.setMode('waveform');
    expect(preference.mode()).toBe('waveform');
    expect(settings.audioVisualizationMode).toBe('waveform');
  });
});
