import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';
import { audioHostLabel } from '../src/app/features/settings/settings.component';
import { SongColumnsSettingsComponent } from '../src/app/features/settings/song-columns-settings.component';
import { ReorderableSongColumn } from '../src/app/core/models';

describe('Audio host labels', () => {
  it.each([
    ['unavailable', 'Unavailable'], ['stopped', 'Stopped'], ['starting', 'Starting…'],
    ['ready', 'Ready'], ['recovering', 'Recovering…'], ['failed', 'Failed'],
  ])('labels %s as %s', (state, label) => expect(audioHostLabel(state)).toBe(label));
  it.each(['unexpected', '', '__proto__', 'toString'])('uses Unknown for %s', (state) => {
    expect(audioHostLabel(state)).toBe('Unknown');
  });
});

describe('Move column guards', () => {
  function setup(loading = false) {
    const moveColumn = vi.fn().mockResolvedValue(undefined);
    const stub = {
      isLoading: () => loading,
      movableColumns: () => ['artist', 'album', 'duration'].map((id) => ({ id })),
      preferences: { moveColumn },
    } as unknown as SongColumnsSettingsComponent;
    return { moveColumn, move: (id: ReorderableSongColumn, direction: -1 | 1) =>
      SongColumnsSettingsComponent.prototype.moveColumn.call(stub, id, direction) };
  }
  it.each([['artist', -1], ['duration', 1], ['lyrics', 1]] as const)(
    'does not move %s in direction %s beyond the available list', async (id, direction) => {
      const { move, moveColumn } = setup();
      await move(id, direction);
      expect(moveColumn).not.toHaveBeenCalled();
    });
  it('does not move while loading', async () => {
    const { move, moveColumn } = setup(true);
    await move('album', 1);
    await move('album', -1);
    expect(moveColumn).not.toHaveBeenCalled();
  });
  it.each([-1, 1] as const)('delegates valid direction %s', async (direction) => {
    const { move, moveColumn } = setup();
    await move('album', direction);
    expect(moveColumn).toHaveBeenCalledExactlyOnceWith('album', direction);
  });
});
