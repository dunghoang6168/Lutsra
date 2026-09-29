import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LIBRARY_GATEWAY, SETTINGS_GATEWAY } from '../../core/contracts';
import { AccentColor, MusicFolder, RepeatMode, ThemePreset } from '../../core/models';
import { PlayerService } from '../../core/player/player.service';
import { ThemeService } from '../../core/theme/theme.service';
import { getDesktopApi } from '../../core/desktop/desktop-api';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { SongColumnsSettingsComponent } from './song-columns-settings.component';
import { LayoutSettingsComponent } from './layout-settings.component';

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
  imports: [CommonModule, FormsModule, IconComponent, SongColumnsSettingsComponent, LayoutSettingsComponent],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss'
})
export class SettingsComponent implements OnInit {
  private readonly libraryGateway = inject(LIBRARY_GATEWAY);
  private readonly settingsGateway = inject(SETTINGS_GATEWAY);
  private readonly destroyRef = inject(DestroyRef);
  readonly themeService = inject(ThemeService);
  readonly player = inject(PlayerService);
  readonly isDesktop = Boolean(getDesktopApi());

  readonly themePresets: ThemePresetOption[] = [
    {
      id: 'dark',
      label: 'Dark',
      description: 'A calm charcoal look for focused listening',
      canvas: '#121417',
      sidebar: '#0b0d0f',
      surface: '#1a1d22',
      border: '#2e343d',
      text: '#f0f2f5',
    },
    {
      id: 'light',
      label: 'Light',
      description: 'A soft, bright look for your collection',
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
  readonly isLoading = signal<boolean>(false);
  readonly errorMessage = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    this.libraryGateway.libraryChanged$?.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => void this.loadFolders());
    await Promise.all([
      this.loadFolders(),
      this.loadSettings(),
    ]);
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
      this.errorMessage.set(err?.message || 'Failed to load settings');
    }
  }

  async loadFolders(): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set(null);
    try {
      const lib = await this.libraryGateway.getLibrary();
      this.folders.set(lib.folders);
    } catch (err: any) {
      this.errorMessage.set(err?.message || 'Failed to load library folders');
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
      this.errorMessage.set(err?.message || 'Failed to select or add folder');
    }
  }

  async onRemoveFolder(folderId: string): Promise<void> {
    this.errorMessage.set(null);
    try {
      await this.libraryGateway.removeMusicFolder(folderId);
      await this.loadFolders();
    } catch (err: any) {
      this.errorMessage.set(err?.message || 'Failed to remove folder');
    }
  }

  async onRescanLibrary(): Promise<void> {
    try {
      await this.libraryGateway.requestScan();
    } catch (err: any) {
      this.errorMessage.set(err?.message || 'Failed to request scan');
    }
  }

  async onVolumeChange(val: number): Promise<void> {
    this.player.setVolume(val);
    try {
      await this.settingsGateway.saveSettings({ defaultVolume: val });
    } catch (err: any) {
      this.errorMessage.set(err?.message || 'Failed to save volume preference');
    }
  }

  async onRepeatChange(mode: RepeatMode): Promise<void> {
    this.player.setRepeatMode(mode);
    try {
      await this.settingsGateway.saveSettings({ repeatMode: mode });
    } catch (err: any) {
      this.errorMessage.set(err?.message || 'Failed to save repeat preference');
    }
  }
}
