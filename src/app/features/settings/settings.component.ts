import { SearchableFilterSelectComponent } from '../../shared/components/searchable-filter-select/searchable-filter-select.component';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { LIBRARY_GATEWAY, SETTINGS_GATEWAY } from '../../core/contracts';
import { AccentColor, AudioEngineBackend, AudioHostState, MusicFolder, RepeatMode, ThemePreset } from '../../core/models';
import { PlayerService } from '../../core/player/player.service';
import { ThemeService } from '../../core/theme/theme.service';
import { LayoutPreferenceService } from '../../core/layout/layout-preference.service';
import { getDesktopApi } from '../../core/desktop/desktop-api';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { RangeSliderComponent } from '../../shared/components/range-slider/range-slider.component';
import { SongColumnsSettingsComponent } from './song-columns-settings.component';
import { LayoutSettingsComponent } from './layout-settings.component';
import { ConfirmRemoveFolderDialogComponent } from '../../shared/components/confirm-remove-folder-dialog/confirm-remove-folder-dialog.component';

export const AUDIO_HOST_LABELS: Record<AudioHostState, string> = {
  unavailable: 'Unavailable',
  stopped: 'Stopped',
  starting: 'Starting…',
  ready: 'Ready',
  recovering: 'Recovering…',
  failed: 'Failed',
};

export function audioHostLabel(state: string): string {
  return Object.prototype.hasOwnProperty.call(AUDIO_HOST_LABELS, state)
    ? AUDIO_HOST_LABELS[state as AudioHostState]
    : 'Unknown';
}

export interface ThemePresetOption {
  id: ThemePreset;
  label: string;
  description: string;
  canvas: string;
  sidebar: string;
  surface: string;
  border: string;
  text: string;
}

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, IconComponent, RangeSliderComponent, SongColumnsSettingsComponent, LayoutSettingsComponent, SearchableFilterSelectComponent, ConfirmRemoveFolderDialogComponent],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss'
})
export class SettingsComponent implements OnInit {
  readonly audioHostLabel = audioHostLabel;
  readonly repeatOptions = [
    { value: 'off', label: 'Off: stop at the end of the queue' },
    { value: 'all', label: 'All: repeat the queue' },
    { value: 'one', label: 'One: repeat the current track' },
  ] as const;
  readonly audioEngineOptions = [
    { value: 'native-shared', label: 'Native Shared (recommended)' },
    { value: 'chromium', label: 'Chromium Shared (fallback)' },
  ] as const;

  private readonly libraryGateway = inject(LIBRARY_GATEWAY);
  private readonly settingsGateway = inject(SETTINGS_GATEWAY);
  private readonly destroyRef = inject(DestroyRef);
  readonly themeService = inject(ThemeService);
  readonly layoutPreference = inject(LayoutPreferenceService);
  readonly player = inject(PlayerService);
  readonly isDesktop = Boolean(getDesktopApi());

  readonly themePresets: ThemePresetOption[] = [
    {
      id: 'dark',
      label: 'Dark',
      description: 'Easier on the eyes in dim rooms',
      canvas: '#121417',
      sidebar: '#0b0d0f',
      surface: '#1a1d22',
      border: '#2e343d',
      text: '#f0f2f5',
    },
    {
      id: 'light',
      label: 'Light',
      description: 'Easier to read in bright rooms',
      canvas: '#f8fafc',
      sidebar: '#f1f5f9',
      surface: '#ffffff',
      border: '#cbd5e1',
      text: '#1e293b',
    },
  ];

  readonly accentColors: { id: AccentColor; label: string; hex: string }[] = [
    { id: 'violet', label: 'Violet', hex: '#8b5cf6' },
    { id: 'blue', label: 'Blue', hex: '#3b82f6' },
    { id: 'cyan', label: 'Cyan', hex: '#06b6d4' },
    { id: 'emerald', label: 'Emerald', hex: '#10b981' },
    { id: 'amber', label: 'Amber', hex: '#f59e0b' },
    { id: 'rose', label: 'Rose', hex: '#f43f5e' },
  ];

  readonly folders = signal<MusicFolder[]>([]);
  readonly pendingRemoveFolder = signal<MusicFolder | null>(null);
  readonly removingFolder = signal(false);
  readonly isLoading = signal<boolean>(false);
  readonly errorMessage = signal<string | null>(null);
  readonly audioOutputOptions = computed(() => this.player.outputDevices().map((device) => ({
    value: device.id,
    label: `${device.name}${device.isConnected ? '' : ' (Disconnected)'}`,
  })));

  async ngOnInit(): Promise<void> {
    this.libraryGateway.libraryChanged$?.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => void this.loadFolders());
    await Promise.all([
      this.loadFolders(),
      this.loadSettings(),
    ]);
    await this.player.refreshAudioOutputState();
  }

  async loadSettings(): Promise<void> {
    try {
      const s = await this.settingsGateway.getSettings();
      if (s) {
        if (typeof s.defaultVolume === 'number') {
          this.player.setVolume(s.defaultVolume);
        }
        if (s.repeatMode) {
          this.player.setRepeatMode(s.repeatMode);
        }
        if (typeof s.shuffle === 'boolean') {
          this.player.setShuffle(s.shuffle);
        }
      }
    } catch (err: any) {
      this.errorMessage.set(err?.message || 'Couldn’t load your settings. Restart Lutstra to try again.');
    }
  }

  async loadFolders(): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set(null);
    try {
      const lib = await this.libraryGateway.getLibrary();
      this.folders.set(lib.folders);
    } catch (err: any) {
      this.errorMessage.set(err?.message || 'Couldn’t load your library folders.');
    } finally {
      this.isLoading.set(false);
    }
  }

  async onAddFolder(): Promise<void> {
    this.errorMessage.set(null);
    try {
      const selected = await this.libraryGateway.selectAndAddMusicFolders();
      if (selected && selected.length > 0) {
        await this.loadFolders();
      }
    } catch (err: any) {
      this.errorMessage.set(err?.message || 'Couldn’t add that folder. Check that it still exists and try again.');
    }
  }

  async onRemoveFolder(): Promise<void> {
    const folder = this.pendingRemoveFolder();
    if (!folder || this.removingFolder()) return;
    this.removingFolder.set(true);
    this.errorMessage.set(null);
    try {
      await this.libraryGateway.removeMusicFolder(folder.id);
      this.pendingRemoveFolder.set(null);
      await this.loadFolders();
    } catch (err: any) {
      this.errorMessage.set(err?.message || 'Couldn’t remove the folder. Try again.');
    } finally {
      this.removingFolder.set(false);
    }
  }

  async onRescanLibrary(): Promise<void> {
    try {
      await this.libraryGateway.requestScan();
    } catch (err: any) {
      this.errorMessage.set(err?.message || 'Couldn’t start the rescan. Try again.');
    }
  }

  async onVolumeChange(val: number): Promise<void> {
    this.player.setVolume(val);
    try {
      await this.settingsGateway.saveSettings({ defaultVolume: val });
    } catch (err: any) {
      this.errorMessage.set(err?.message || 'Couldn’t save the volume.');
    }
  }

  async onRepeatChange(mode: RepeatMode): Promise<void> {
    this.player.setRepeatMode(mode);
    try {
      await this.settingsGateway.saveSettings({ repeatMode: mode });
    } catch (err: any) {
      this.errorMessage.set(err?.message || 'Couldn’t save the repeat setting.');
    }
  }

  async onAudioOutputChange(deviceId: string): Promise<void> {
    await this.player.selectAudioOutput(deviceId);
  }

  async onAudioBackendChange(backend: string): Promise<void> {
    if (backend === 'chromium' || backend === 'native-shared') await this.player.switchAudioBackend(backend as AudioEngineBackend);
  }
}
