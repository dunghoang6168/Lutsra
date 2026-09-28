import { Component, OnInit, computed, inject } from '@angular/core';
import { ReorderableSongColumn, SongColumn } from '../../core/models';
import { SongColumnPreferencesService } from '../../core/settings/song-column-preferences.service';

@Component({
  selector: 'app-song-columns-settings',
  standalone: true,
  templateUrl: './song-columns-settings.component.html',
  styleUrl: './song-columns-settings.component.scss',
})
export class SongColumnsSettingsComponent implements OnInit {
  readonly preferences = inject(SongColumnPreferencesService);
  private readonly movableColumnDetails: Record<ReorderableSongColumn, { label: string; description: string }> = {
    artist: { label: 'Artist', description: 'Track artist' },
    album: { label: 'Album', description: 'Album name' },
    duration: { label: 'Time', description: 'Track duration' },
    codec: { label: 'Codec', description: 'Audio format' },
    sampleRate: { label: 'Sample Rate', description: 'Sample rate and bit depth' },
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
  moveColumn(column: ReorderableSongColumn, direction: -1 | 1): Promise<void> {
    return this.preferences.moveColumn(column, direction);
  }
}
