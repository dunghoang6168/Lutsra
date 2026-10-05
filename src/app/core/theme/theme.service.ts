import { DOCUMENT } from '@angular/common';
import { effect, inject, Injectable, signal } from '@angular/core';
import { SETTINGS_GATEWAY } from '../contracts';
import { LayoutPreferenceService } from '../layout/layout-preference.service';
import {
  AccentColor,
  DEFAULT_ACCENT_COLOR,
  DEFAULT_THEME_PRESET,
  isAccentColor,
  normalizeThemePreset,
  ThemePreset,
} from '../models';

export type ThemeSaveState = 'idle' | 'saving' | 'saved' | 'error';

interface ThemeSelection {
  themePreset: ThemePreset;
  accentColor: AccentColor;
}

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly settingsGateway = inject(SETTINGS_GATEWAY);
  private readonly layoutPreference = inject(LayoutPreferenceService);
  private saveQueue: Promise<void> = Promise.resolve();
  private saveRevision = 0;
  private persistedSelection: ThemeSelection = {
    themePreset: DEFAULT_THEME_PRESET,
    accentColor: DEFAULT_ACCENT_COLOR,
  };

  private readonly themePresetState = signal<ThemePreset>(DEFAULT_THEME_PRESET);
  private readonly accentColorState = signal<AccentColor>(DEFAULT_ACCENT_COLOR);
  private readonly saveStateValue = signal<ThemeSaveState>('idle');
  private readonly errorMessageValue = signal<string | null>(null);

  readonly themePreset = this.themePresetState.asReadonly();
  readonly accentColor = this.accentColorState.asReadonly();
  /** Every layout follows the chosen light/dark preset and accent. */
  readonly effectiveTheme = this.themePreset;
  readonly saveState = this.saveStateValue.asReadonly();
  readonly errorMessage = this.errorMessageValue.asReadonly();

  constructor() {
    effect(() => {
      const root = this.document.documentElement;
      const themePreset = this.themePresetState();
      root.setAttribute('data-theme', themePreset);
      root.setAttribute('data-accent', this.accentColorState());
      root.setAttribute('data-layout', this.layoutPreference.mode());
      root.style.colorScheme = themePreset;
    });
  }

  async restore(): Promise<void> {
    try {
      const settings = await this.settingsGateway.getSettings();
      this.persistedSelection = this.normalize(settings.themePreset, settings.accentColor);
      this.setSelection(this.persistedSelection);
      this.saveStateValue.set('idle');
      this.errorMessageValue.set(null);
    } catch (error) {
      this.persistedSelection = this.normalize(undefined, undefined);
      this.setSelection(this.persistedSelection);
      this.saveStateValue.set('error');
      this.errorMessageValue.set(errorMessage(error, 'Failed to restore appearance settings'));
    }
  }

  setThemePreset(themePreset: ThemePreset): Promise<void> {
    this.themePresetState.set(themePreset);
    return this.persist();
  }

  setAccentColor(accentColor: AccentColor): Promise<void> {
    this.accentColorState.set(accentColor);
    return this.persist();
  }

  private persist(): Promise<void> {
    const selection = { themePreset: this.themePreset(), accentColor: this.accentColor() };
    const revision = ++this.saveRevision;
    this.saveStateValue.set('saving');
    this.errorMessageValue.set(null);

    this.saveQueue = this.saveQueue.then(async () => {
      try {
        await this.settingsGateway.saveSettings(selection);
        this.persistedSelection = selection;
        if (revision === this.saveRevision) this.saveStateValue.set('saved');
      } catch (error) {
        if (revision === this.saveRevision) {
          this.setSelection(this.persistedSelection);
          this.saveStateValue.set('error');
          this.errorMessageValue.set(errorMessage(error, 'Failed to save appearance settings'));
        }
      }
    });

    return this.saveQueue;
  }

  private setSelection(selection: ThemeSelection): void {
    this.themePresetState.set(selection.themePreset);
    this.accentColorState.set(selection.accentColor);
  }

  private normalize(themePreset: unknown, accentColor: unknown): ThemeSelection {
    return {
      themePreset: normalizeThemePreset(themePreset),
      accentColor: isAccentColor(accentColor) ? accentColor : DEFAULT_ACCENT_COLOR,
    };
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
