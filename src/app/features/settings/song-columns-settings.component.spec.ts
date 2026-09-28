import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SETTINGS_GATEWAY } from '../../core/contracts';
import { SongColumnsSettingsComponent } from './song-columns-settings.component';

describe('SongColumnsSettingsComponent', () => {
  let fixture: ComponentFixture<SongColumnsSettingsComponent>;
  let getSettings: jasmine.Spy;
  let saveSettings: jasmine.Spy;

  beforeEach(async () => {
    getSettings = jasmine.createSpy('getSettings').and.resolveTo({ hiddenSongColumns: ['artist'] });
    saveSettings = jasmine.createSpy('saveSettings').and.resolveTo({ hiddenSongColumns: [] });
    await TestBed.configureTestingModule({
      imports: [SongColumnsSettingsComponent],
      providers: [{ provide: SETTINGS_GATEWAY, useValue: { getSettings, saveSettings } }],
    }).compileComponents();
    fixture = TestBed.createComponent(SongColumnsSettingsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('shows Title as locked and restores saved column choices', () => {
    const section = fixture.nativeElement.querySelector('[aria-labelledby="songs-settings-title"]') as HTMLElement;
    expect(section.querySelector('h2')?.textContent?.trim()).toBe('Songs');
    const title = section.querySelector('input[aria-label="Show Title column (always visible)"]') as HTMLInputElement;
    const artist = section.querySelector('input[aria-label="Show Artist column"]') as HTMLInputElement;
    const album = section.querySelector('input[aria-label="Show Album column"]') as HTMLInputElement;
    const lyrics = section.querySelector('input[aria-label="Show Lyrics column"]') as HTMLInputElement;
    expect(title.checked).toBeTrue();
    expect(title.disabled).toBeTrue();
    expect(artist.checked).toBeFalse();
    expect(album.checked).toBeTrue();
    expect(lyrics.checked).toBeTrue();
    expect(section.querySelectorAll('input[type="checkbox"]').length).toBe(9);
  });

  it('persists the Lyrics column choice', async () => {
    const lyrics = fixture.nativeElement.querySelector('input[aria-label="Show Lyrics column"]') as HTMLInputElement;
    lyrics.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(saveSettings).toHaveBeenCalledOnceWith({ hiddenSongColumns: ['artist', 'lyrics'] });
    expect(lyrics.checked).toBeFalse();
  });

  it('numbers hidden columns and moves only the six middle columns', async () => {
    const cards = () => Array.from(fixture.nativeElement.querySelectorAll('.song-column-option') as NodeListOf<HTMLElement>);
    expect(cards().map((card) => card.dataset['column'])).toEqual([
      'index', 'title', 'artist', 'album', 'duration', 'codec', 'sampleRate', 'lyrics', 'actions',
    ]);
    expect(cards().map((card) => card.querySelector('.song-column-position')?.textContent?.trim()))
      .toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
    expect(cards()[2].querySelector('input')?.checked).toBeFalse();
    expect((fixture.nativeElement.querySelector('[aria-label="Move Artist column earlier"]') as HTMLButtonElement).disabled).toBeTrue();
    expect((fixture.nativeElement.querySelector('[aria-label="Move Lyrics column later"]') as HTMLButtonElement).disabled).toBeTrue();

    (fixture.nativeElement.querySelector('[aria-label="Move Album column earlier"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(cards().map((card) => card.dataset['column'])).toEqual([
      'index', 'title', 'album', 'artist', 'duration', 'codec', 'sampleRate', 'lyrics', 'actions',
    ]);
    expect(saveSettings).toHaveBeenCalledOnceWith({ songColumnOrder: ['album', 'artist', 'duration', 'codec', 'sampleRate', 'lyrics'] });
    expect(cards()[3].querySelector('input')?.checked).toBeFalse();
  });

  it('saves a column switch immediately and updates its checked state', async () => {
    const artist = fixture.nativeElement.querySelector('input[aria-label="Show Artist column"]') as HTMLInputElement;
    artist.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(saveSettings).toHaveBeenCalledOnceWith({ hiddenSongColumns: [] });
    expect(artist.checked).toBeTrue();
    expect(fixture.componentInstance.hiddenSongColumns()).toEqual([]);
  });

  it('restores the last confirmed choices if saving fails', async () => {
    saveSettings.and.rejectWith(new Error('Storage unavailable'));
    await fixture.componentInstance.onSongColumnChange('artist', true);
    fixture.detectChanges();
    const artist = fixture.nativeElement.querySelector('input[aria-label="Show Artist column"]') as HTMLInputElement;
    expect(artist.checked).toBeFalse();
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain('Storage unavailable');
  });
});
