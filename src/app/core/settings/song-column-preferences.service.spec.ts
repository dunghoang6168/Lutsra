import { TestBed } from '@angular/core/testing';
import { SETTINGS_GATEWAY } from '../contracts';
import { DEFAULT_SONG_COLUMN_ORDER, ReorderableSongColumn } from '../models';
import { SongColumnPreferencesService } from './song-column-preferences.service';

describe('SongColumnPreferencesService', () => {
  let service: SongColumnPreferencesService;
  let getSettings: jasmine.Spy;
  let saveSettings: jasmine.Spy;

  beforeEach(() => {
    getSettings = jasmine.createSpy('getSettings').and.resolveTo({ hiddenSongColumns: ['codec'] });
    saveSettings = jasmine.createSpy('saveSettings').and.resolveTo({ hiddenSongColumns: ['codec'] });
    TestBed.configureTestingModule({
      providers: [{ provide: SETTINGS_GATEWAY, useValue: { getSettings, saveSettings } }],
    });
    service = TestBed.inject(SongColumnPreferencesService);
  });

  it('loads saved choices once for every consumer', async () => {
    await Promise.all([service.load(), service.load()]);
    expect(getSettings).toHaveBeenCalledTimes(1);
    expect(service.isHidden('codec')).toBeTrue();
    expect(service.isHidden('artist')).toBeFalse();
    expect(service.songColumnOrder()).toEqual([...DEFAULT_SONG_COLUMN_ORDER]);
  });

  it('shares a changed column immediately while its save is still pending', async () => {
    await service.load();
    let completeSave!: (value: unknown) => void;
    saveSettings.and.callFake(() => new Promise((resolve) => { completeSave = resolve; }));
    const pending = service.setVisible('artist', false);
    expect(service.isHidden('artist')).toBeTrue();
    expect(TestBed.inject(SongColumnPreferencesService).isHidden('artist')).toBeTrue();
    await Promise.resolve();
    expect(saveSettings).toHaveBeenCalledOnceWith({ hiddenSongColumns: ['codec', 'artist'] });
    completeSave({ hiddenSongColumns: ['codec', 'artist'] });
    await pending;
  });

  it('moves a column immediately, saves the order, and restores it if a later save fails', async () => {
    await service.load();
    await service.moveColumn('lyrics', -1);
    const moved: ReorderableSongColumn[] = ['artist', 'album', 'duration', 'codec', 'lyrics', 'sampleRate'];
    expect(service.songColumnOrder()).toEqual(moved);
    expect(saveSettings).toHaveBeenCalledOnceWith({ songColumnOrder: moved });
    saveSettings.and.rejectWith(new Error('Storage unavailable'));
    await service.moveColumn('lyrics', -1);
    expect(service.songColumnOrder()).toEqual(moved);
    expect(service.errorMessage()).toContain('Storage unavailable');
  });

  it('does not move a column past either fixed boundary', async () => {
    await service.load();
    await service.moveColumn('artist', -1);
    await service.moveColumn('lyrics', 1);
    expect(service.songColumnOrder()).toEqual([...DEFAULT_SONG_COLUMN_ORDER]);
    expect(saveSettings).not.toHaveBeenCalled();
  });
});
