import { DOCUMENT } from '@angular/common';
import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { SETTINGS_GATEWAY } from '../contracts';
import { LayoutPreferenceService } from '../layout/layout-preference.service';
import {
  AccentColor,
  DEFAULT_ACCENT_COLOR,
  DEFAULT_LIQUID_GLASS_ACCENT_COLOR,
  DEFAULT_THEME_PRESET,
  isAccentColor,
  normalizeThemePreset,
  ThemePreset,
} from '../models';

export type ThemeSaveState = 'idle' | 'saving' | 'saved' | 'error';
export type EffectiveTheme = ThemePreset | 'liquid-glass';

interface ThemeSelection {
  themePreset: ThemePreset;
  accentColor: AccentColor;
  liquidGlassAccentColor: AccentColor;
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
    liquidGlassAccentColor: DEFAULT_LIQUID_GLASS_ACCENT_COLOR,
  };

  private readonly themePresetState = signal<ThemePreset>(DEFAULT_THEME_PRESET);
  private readonly accentColorState = signal<AccentColor>(DEFAULT_ACCENT_COLOR);
  private readonly liquidGlassAccentColorState = signal<AccentColor>(DEFAULT_LIQUID_GLASS_ACCENT_COLOR);
  private readonly saveStateValue = signal<ThemeSaveState>('idle');
  private readonly errorMessageValue = signal<string | null>(null);

  readonly themePreset = this.themePresetState.asReadonly();
  readonly accentColor = this.accentColorState.asReadonly();
  readonly liquidGlassAccentColor = this.liquidGlassAccentColorState.asReadonly();
  readonly effectiveTheme = computed<EffectiveTheme>(() =>
    this.layoutPreference.mode() === 'liquid-glass' ? 'liquid-glass' : this.themePresetState());
  readonly effectiveAccentColor = computed<AccentColor>(() =>
    this.layoutPreference.mode() === 'liquid-glass' ? this.liquidGlassAccentColorState() : this.accentColorState());
  readonly saveState = this.saveStateValue.asReadonly();
  readonly errorMessage = this.errorMessageValue.asReadonly();

  constructor() {
    effect(() => {
      const themePreset = this.effectiveTheme();
      const accentColor = this.effectiveAccentColor();
      const root = this.document.documentElement;
      root.setAttribute('data-theme', themePreset);
      root.setAttribute('data-accent', accentColor);
      root.style.colorScheme = themePreset === 'dark' ? 'dark' : 'light';
    });
  }

  async restore(): Promise<void> {
    try {
      const settings = await this.settingsGateway.getSettings();
      this.persistedSelection = this.normalize(
        settings.themePreset,
        settings.accentColor,
        settings.liquidGlassAccentColor,
      );
      this.setSelection(this.persistedSelection);
      this.saveStateValue.set('idle');
      this.errorMessageValue.set(null);
    } catch (error) {
      this.persistedSelection = this.normalize(undefined, undefined, undefined);
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

  setLiquidGlassAccentColor(accentColor: AccentColor): Promise<void> {
    this.liquidGlassAccentColorState.set(accentColor);
    return this.persist();
  }

  private persist(): Promise<void> {
    const selection = {
      themePreset: this.themePreset(),
      accentColor: this.accentColor(),
      liquidGlassAccentColor: this.liquidGlassAccentColor(),
    };
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
    this.liquidGlassAccentColorState.set(selection.liquidGlassAccentColor);
  }

  private normalize(themePreset: unknown, accentColor: unknown, liquidGlassAccentColor: unknown): ThemeSelection {
    return {
      themePreset: normalizeThemePreset(themePreset),
      accentColor: isAccentColor(accentColor) ? accentColor : DEFAULT_ACCENT_COLOR,
      liquidGlassAccentColor: isAccentColor(liquidGlassAccentColor)
        ? liquidGlassAccentColor
        : DEFAULT_LIQUID_GLASS_ACCENT_COLOR,
    };
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
