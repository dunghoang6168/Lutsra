import { Component, Injector, OnInit, afterNextRender, computed, inject } from '@angular/core';
import { ReorderableSongColumn, SongColumn } from '../../core/models';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { SongColumnPreferencesService } from '../../core/settings/song-column-preferences.service';

@Component({
  selector: 'app-song-columns-settings',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './song-columns-settings.component.html',
  styleUrl: './song-columns-settings.component.scss',
})
export class SongColumnsSettingsComponent implements OnInit {
  readonly preferences = inject(SongColumnPreferencesService);
  private readonly injector = inject(Injector);
  private readonly movableColumnDetails: Record<ReorderableSongColumn, { label: string; description: string }> = {
    artist: { label: 'Artist', description: 'Track artist' },
    album: { label: 'Album', description: 'Album name' },
    duration: { label: 'Time', description: 'Track duration' },
    codec: { label: 'Codec', description: 'Audio format' },
    sampleRate: { label: 'Sample rate', description: 'Sample rate and bit depth' },
    lyrics: { label: 'Lyrics', description: 'Matching .lrc file' },
  };
  readonly movableColumns = computed(() => this.preferences.songColumnOrder().map((id) => ({
    id, ...this.movableColumnDetails[id],
  })));
  readonly hiddenSongColumns = this.preferences.hiddenSongColumns;
  readonly isLoading = this.preferences.isLoading;
  readonly errorMessage = this.preferences.errorMessage;

  ngOnInit(): Promise<void> { return this.preferences.load(); }
  isSongColumnVisible(column: SongColumn): boolean { return !this.preferences.isHidden(column); }
  onSongColumnChange(column: SongColumn, visible: boolean): Promise<void> {
    return this.preferences.setVisible(column, visible);
  }
  async moveColumn(column: ReorderableSongColumn, direction: -1 | 1, event?: MouseEvent): Promise<void> {
    if (this.isLoading()) return;
    const columns = this.movableColumns();
    const index = columns.findIndex((item) => item.id === column);
    if (index < 0 || index + direction < 0 || index + direction >= columns.length) return;
    const button = event?.currentTarget;
    const restoreFocus = Boolean(event) && button instanceof HTMLElement && document.activeElement === button;
    const move = this.preferences.moveColumn(column, direction);
    if (restoreFocus) {
      afterNextRender(() => {
        if (button.isConnected && (document.activeElement === document.body || document.activeElement === button)) {
          button.focus({ preventScroll: true });
        }
      }, { injector: this.injector });
    }
    await move;
  }
}
