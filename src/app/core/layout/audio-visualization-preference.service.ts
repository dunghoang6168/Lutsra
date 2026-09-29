import { inject, Injectable, signal } from '@angular/core';
import { SETTINGS_GATEWAY } from '../contracts';
import { AudioVisualizationMode, DEFAULT_AUDIO_VISUALIZATION_MODE, isAudioVisualizationMode } from '../models';

@Injectable({ providedIn: 'root' })
export class AudioVisualizationPreferenceService {
  private readonly settingsGateway = inject(SETTINGS_GATEWAY);
  private readonly modeState = signal<AudioVisualizationMode>(DEFAULT_AUDIO_VISUALIZATION_MODE);
  private readonly saveStateValue = signal<'idle' | 'saving' | 'saved' | 'error'>('idle');
  private readonly errorMessageValue = signal<string | null>(null);
  private persistedMode: AudioVisualizationMode = DEFAULT_AUDIO_VISUALIZATION_MODE;
  private saveQueue: Promise<void> = Promise.resolve();
  private saveRevision = 0;

  readonly mode = this.modeState.asReadonly();
  readonly saveState = this.saveStateValue.asReadonly();
  readonly errorMessage = this.errorMessageValue.asReadonly();

  async restore(): Promise<void> {
    try {
      const settings = await this.settingsGateway.getSettings();
      this.persistedMode = isAudioVisualizationMode(settings.audioVisualizationMode)
        ? settings.audioVisualizationMode : DEFAULT_AUDIO_VISUALIZATION_MODE;
      this.modeState.set(this.persistedMode);
      this.saveStateValue.set('idle');
      this.errorMessageValue.set(null);
    } catch (error) {
      this.persistedMode = DEFAULT_AUDIO_VISUALIZATION_MODE;
      this.modeState.set(this.persistedMode);
      this.saveStateValue.set('error');
      this.errorMessageValue.set(error instanceof Error ? error.message : 'Failed to restore audio visualization');
    }
  }

  setMode(mode: AudioVisualizationMode): Promise<void> {
    if (mode === this.modeState() && this.saveState() !== 'error') return this.saveQueue;
    this.modeState.set(mode);
    this.saveStateValue.set('saving');
    this.errorMessageValue.set(null);
    const revision = ++this.saveRevision;
    this.saveQueue = this.saveQueue.then(async () => {
      try {
        await this.settingsGateway.saveSettings({ audioVisualizationMode: mode });
        this.persistedMode = mode;
        if (revision === this.saveRevision) this.saveStateValue.set('saved');
      } catch (error) {
        if (revision === this.saveRevision) {
          this.modeState.set(this.persistedMode);
          this.saveStateValue.set('error');
          this.errorMessageValue.set(error instanceof Error ? error.message : 'Failed to save audio visualization');
        }
      }
    });
    return this.saveQueue;
  }
}
