import { Injectable, inject, signal } from '@angular/core';
import { SETTINGS_GATEWAY } from '../contracts';
import { DEFAULT_SONG_COLUMN_ORDER, normalizeHiddenSongColumns, normalizeSongColumnOrder, ReorderableSongColumn, SongColumn } from '../models';

@Injectable({ providedIn: 'root' })
export class SongColumnPreferencesService {
  private readonly settingsGateway = inject(SETTINGS_GATEWAY);
  readonly hiddenSongColumns = signal<SongColumn[]>([]);
  readonly songColumnOrder = signal<ReorderableSongColumn[]>([...DEFAULT_SONG_COLUMN_ORDER]);
  readonly isLoading = signal(true);
  readonly errorMessage = signal<string | null>(null);
  private loadPromise: Promise<void> | null = null;
  private saveQueue = Promise.resolve();
  private lastSavedColumns: SongColumn[] = [];
  private lastSavedOrder: ReorderableSongColumn[] = [...DEFAULT_SONG_COLUMN_ORDER];

  load(): Promise<void> {
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = (async () => {
      try {
        const settings = await this.settingsGateway.getSettings();
        const hidden = normalizeHiddenSongColumns(settings.hiddenSongColumns);
        const order = normalizeSongColumnOrder(settings.songColumnOrder);
        this.hiddenSongColumns.set(hidden);
        this.songColumnOrder.set(order);
        this.lastSavedColumns = hidden;
        this.lastSavedOrder = order;
      } catch (error: any) {
        this.errorMessage.set(error?.message || 'Failed to load Songs column preferences');
      } finally {
        this.isLoading.set(false);
      }
    })();
    return this.loadPromise;
  }

  isHidden(column: SongColumn): boolean {
    return this.hiddenSongColumns().includes(column);
  }

  async setVisible(column: SongColumn, visible: boolean): Promise<void> {
    if (this.isLoading()) await this.load();
    const previous = this.hiddenSongColumns();
    const next = visible ? previous.filter((item) => item !== column)
      : [...new Set([...previous, column])];
    if (next.length === previous.length && next.every((item, index) => item === previous[index])) return;
    this.hiddenSongColumns.set(next);
    this.errorMessage.set(null);
    const save = this.saveQueue.then(() => this.settingsGateway.saveSettings({ hiddenSongColumns: next }));
    this.saveQueue = save.then(() => undefined, () => undefined);
    try {
      await save;
      this.lastSavedColumns = next;
    } catch (error: any) {
      if (this.hiddenSongColumns() === next) this.hiddenSongColumns.set(this.lastSavedColumns);
      this.errorMessage.set(error?.message || 'Failed to save Songs column preferences');
    }
  }

  async moveColumn(column: ReorderableSongColumn, direction: -1 | 1): Promise<void> {
    if (this.isLoading()) await this.load();
    const previous = this.songColumnOrder();
    const index = previous.indexOf(column);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= previous.length) return;
    const next = [...previous];
    [next[index], next[target]] = [next[target], next[index]];
    this.songColumnOrder.set(next);
    this.errorMessage.set(null);
    const save = this.saveQueue.then(() => this.settingsGateway.saveSettings({ songColumnOrder: next }));
    this.saveQueue = save.then(() => undefined, () => undefined);
    try {
      await save;
      this.lastSavedOrder = next;
    } catch (error: any) {
      if (this.songColumnOrder() === next) this.songColumnOrder.set(this.lastSavedOrder);
      this.errorMessage.set(error?.message || 'Failed to save Songs column order');
    }
  }
}
