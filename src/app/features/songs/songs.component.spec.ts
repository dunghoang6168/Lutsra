import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { LIBRARY_GATEWAY, LYRICS_GATEWAY, SETTINGS_GATEWAY } from '../../core/contracts';
import { Track } from '../../core/models';
import { PlayerService } from '../../core/player/player.service';
import { SongsComponent } from './songs.component';

describe('SongsComponent browsing', () => {
  let fixture: ComponentFixture<SongsComponent>;
  let component: SongsComponent;
  let getLibrary: jasmine.Spy;
  let getSettings: jasmine.Spy;
  let findTracksWithLyrics: jasmine.Spy;
  let scanProgress: Subject<{ isScanning: boolean }>;

  beforeEach(async () => {
    scanProgress = new Subject();
    getLibrary = jasmine.createSpy('getLibrary').and.resolveTo({ tracks: [], albums: [], artists: [], folders: [] });
    getSettings = jasmine.createSpy('getSettings').and.resolveTo({ hiddenSongColumns: [] });
    findTracksWithLyrics = jasmine.createSpy('findTracksWithLyrics').and.callFake(async (ids: string[]) => ids.filter((id) => id === 'one'));
    await TestBed.configureTestingModule({
      imports: [SongsComponent],
      providers: [
        { provide: LIBRARY_GATEWAY, useValue: { getLibrary, scanProgress$: scanProgress } },
        { provide: SETTINGS_GATEWAY, useValue: { getSettings } },
        { provide: LYRICS_GATEWAY, useValue: { findTracksWithLyrics } },
        { provide: PlayerService, useValue: { currentTrack: signal(null), isPlaying: signal(false), isShuffle: signal(false), playCollection: jasmine.createSpy('playCollection') } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(SongsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('sorts titles naturally and uses stable ties for text and numeric columns', () => {
    const tracks = [
      createTrack('ten', '10', 'Beta', 'B', 2024, 20, 48000),
      createTrack('two-b', '2', 'Alpha', 'A', 2020, 40, null),
      createTrack('two-a', '2', 'Alpha', 'A', 2022, 30, 96000),
    ];
    component.tracks.set(tracks);
    expect(trackIds(component)).toEqual(['two-a', 'two-b', 'ten']);
    component.sortDirection.set('desc');
    expect(trackIds(component)).toEqual(['ten', 'two-a', 'two-b']);
    component.sortColumn.set('artist');
    component.sortDirection.set('asc');
    expect(trackIds(component)).toEqual(['two-a', 'two-b', 'ten']);
    component.sortColumn.set('duration');
    expect(trackIds(component)).toEqual(['ten', 'two-a', 'two-b']);
    component.sortColumn.set('sampleRate');
    component.sortDirection.set('desc');
    expect(trackIds(component)).toEqual(['two-a', 'ten', 'two-b']);
    expect(component.tracks()).toEqual(tracks);
  });

  it('combines search, artist, album and year filters including unknown year', () => {
    component.tracks.set([
      createTrack('a', 'Match One', 'Artist', 'Album', null, 20, null),
      createTrack('b', 'Match Two', 'Artist', 'Album', 2024, 20, null),
      createTrack('c', 'Match Three', 'Other', 'Album', null, 20, null),
    ]);
    component.searchQuery.set('match');
    component.artistFilter.set('Artist');
    component.albumFilter.set('Album');
    component.yearFilter.set('unknown');
    expect(trackIds(component)).toEqual(['a']);
    expect(component.activeFilterCount()).toBe(3);
    component.yearFilter.set('2020');
    fixture.detectChanges();
    expect(trackIds(component)).toEqual([]);
    expect(fixture.nativeElement.querySelector('.empty-title').textContent).toContain('No songs found');
    component.clearFilters();
    expect(trackIds(component)).toEqual(['a', 'c', 'b']);
    expect(component.searchQuery()).toBe('match');
  });

  it('synchronizes column clicks with the popover and keeps choices after a scan', async () => {
    component.tracks.set([createTrack('a', 'Song', 'Artist', 'Album', 2024, 20, null)]);
    fixture.detectChanges();
    const sortButton: HTMLButtonElement = fixture.nativeElement.querySelector('.filter-trigger');
    sortButton.click();
    fixture.detectChanges();
    const sortSelect: HTMLSelectElement = fixture.nativeElement.querySelector('#song-sort');
    expect(sortSelect.value).toBe('title');
    component.toggleSort('album');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(sortSelect.value).toBe('album');
    component.artistFilter.set('Artist');
    component.yearFilter.set('2024');
    getLibrary.and.resolveTo({ tracks: [createTrack('a', 'Song', 'Artist', 'Album', 2024, 20, null)], albums: [], artists: [], folders: [] });
    scanProgress.next({ isScanning: true });
    scanProgress.next({ isScanning: false });
    await fixture.whenStable();
    expect(getLibrary).toHaveBeenCalledTimes(2);
    expect([component.sortColumn(), component.artistFilter(), component.yearFilter()]).toEqual(['album', 'Artist', '2024']);
    expect(trackIds(component)).toEqual(['a']);
  });
  it('orders album groups by name but tracks by disc and track number', () => {
    component.tracks.set([
      { ...createTrack('a3', 'Aardvark', 'Artist A', 'Album A', 2023, 20, null), discNumber: 1, trackNumber: 3 },
      { ...createTrack('b1', 'Other', 'Artist B', 'Album A', 2023, 20, null), discNumber: 1, trackNumber: 1 },
      { ...createTrack('a-disc2', 'First', 'Artist A', 'Album A', 2023, 20, null), discNumber: 2, trackNumber: 1 },
      { ...createTrack('a1', 'Zulu', 'Artist A', 'Album A', 2023, 20, null), discNumber: 1, trackNumber: 1 },
      { ...createTrack('c1', 'Song', 'Artist C', 'Album B', 2023, 20, null), discNumber: 1, trackNumber: 1 },
      { ...createTrack('a2', 'Beta', 'Artist A', 'Album A', 2023, 20, null), discNumber: 1, trackNumber: 2 },
    ]);
    component.sortColumn.set('album');
    expect(trackIds(component)).toEqual(['a1', 'a2', 'a3', 'a-disc2', 'b1', 'c1']);
    component.sortDirection.set('desc');
    expect(trackIds(component)).toEqual(['c1', 'a1', 'a2', 'a3', 'a-disc2', 'b1']);
  });

  it('keeps album names A-Z within each artist in both artist directions', () => {
    component.tracks.set([
      { ...createTrack('z1', 'Early', 'Artist A', 'Zulu Album', 2022, 20, null), trackNumber: 1 },
      { ...createTrack('a2', 'Aardvark', 'Artist A', 'Alpha Album', 2023, 20, null), trackNumber: 2 },
      { ...createTrack('b1', 'Other', 'Artist B', 'Only Album', 2024, 20, null), trackNumber: 1 },
      { ...createTrack('a1', 'Zulu', 'Artist A', 'Alpha Album', 2023, 20, null), trackNumber: 1 },
    ]);
    component.sortColumn.set('artist');
    expect(trackIds(component)).toEqual(['a1', 'a2', 'z1', 'b1']);
    component.sortDirection.set('desc');
    expect(trackIds(component)).toEqual(['b1', 'a1', 'a2', 'z1']);
  });

  it('uses album fallback for missing numbers and plays the filtered order', () => {
    component.tracks.set([
      createTrack('missing-b', 'Beta', 'Artist', 'Album', 2023, 20, null),
      { ...createTrack('other', 'Other', 'Other Artist', 'Other Album', 2023, 20, null), trackNumber: 1 },
      { ...createTrack('known', 'Zulu', 'Artist', 'Album', 2023, 20, null), trackNumber: 2 },
      createTrack('missing-a', 'Alpha', 'Artist', 'Album', 2023, 20, null),
    ]);
    component.artistFilter.set('Artist');
    component.albumFilter.set('Album');
    component.sortColumn.set('album');
    expect(trackIds(component)).toEqual(['known', 'missing-a', 'missing-b']);
    component.onPlayAll();
    expect(TestBed.inject(PlayerService).playCollection).toHaveBeenCalledWith(component.filteredTracks(), 0);
    component.searchQuery.set('Alpha');
    expect(trackIds(component)).toEqual(['missing-a']);
    expect(component.sortColumn()).toBe('album');
  });
  it('hides chosen headers and cells without changing the track list or sort', async () => {
    component.tracks.set([createTrack('one', 'First', 'Artist One', 'Album One', 2024, 20, 96000)]);
    component.songColumns.hiddenSongColumns.set(['artist', 'codec']);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('th.col-artist').classList.contains('user-hidden')).toBeTrue();
    expect(fixture.nativeElement.querySelector('td.col-artist').classList.contains('user-hidden')).toBeTrue();
    expect(fixture.nativeElement.querySelector('th.col-codec').classList.contains('user-hidden')).toBeTrue();
    expect(fixture.nativeElement.querySelector('td.col-codec').classList.contains('user-hidden')).toBeTrue();
    expect(fixture.nativeElement.querySelector('th.col-title').classList.contains('user-hidden')).toBeFalse();
    expect(trackIds(component)).toEqual(['one']);
    expect(component.sortColumn()).toBe('title');
  });

  it('shows a Lyrics check for matching files and hides the column when disabled', async () => {
    component.tracks.set([
      createTrack('one', 'First', 'Artist', 'Album', 2024, 20, null),
      createTrack('two', 'Second', 'Artist', 'Album', 2024, 20, null),
    ]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const rows = Array.from(fixture.nativeElement.querySelectorAll('.song-row') as NodeListOf<HTMLElement>);
    expect(findTracksWithLyrics).toHaveBeenCalledWith(['one', 'two']);
    expect(rows.map((row) => Boolean(row.querySelector('.lyrics-check')))).toEqual([true, false]);
    expect(rows[0].querySelector('.col-lyrics')?.getAttribute('aria-label')).toBe('Lyrics available');
    expect(rows[1].querySelector('.col-lyrics')?.getAttribute('aria-label')).toBe('No lyrics');
    const swatch = document.createElement('span');
    swatch.style.color = 'var(--accent-primary)';
    fixture.nativeElement.append(swatch);
    expect(getComputedStyle(rows[0].querySelector('.lyrics-check')!).color).toBe(getComputedStyle(swatch).color);

    component.songColumns.hiddenSongColumns.set(['lyrics']);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('th.col-lyrics').classList.contains('user-hidden')).toBeTrue();
    expect(rows[0].querySelector('.col-lyrics')?.classList.contains('user-hidden')).toBeTrue();
  });

  it('keeps headers and cells aligned after reordering, including hidden columns', async () => {
    component.tracks.set([createTrack('one', 'First', 'Artist One', 'Album One', 2024, 20, 96000)]);
    component.songColumns.songColumnOrder.set(['lyrics', 'sampleRate', 'codec', 'duration', 'album', 'artist']);
    component.songColumns.hiddenSongColumns.set(['codec']);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const headers = Array.from(fixture.nativeElement.querySelectorAll('thead th') as NodeListOf<HTMLElement>);
    const cells = Array.from(fixture.nativeElement.querySelectorAll('.song-row td') as NodeListOf<HTMLElement>);
    expect(headers.map((element) => element.classList[0])).toEqual([
      'col-index', 'col-title', 'col-lyrics', 'col-quality', 'col-codec', 'col-duration', 'col-album', 'col-artist', 'col-actions',
    ]);
    expect(cells.map((element) => element.classList[0])).toEqual(headers.map((element) => element.classList[0]));
    expect(headers[4].classList.contains('user-hidden')).toBeTrue();
    expect(cells[4].classList.contains('user-hidden')).toBeTrue();
    component.songColumns.hiddenSongColumns.set([]);
    fixture.detectChanges();
    expect(headers[4].classList.contains('user-hidden')).toBeFalse();
    (headers[7] as HTMLElement).click();
    expect(component.sortColumn()).toBe('artist');
  });

  it('applies searchable artist and album choices to the visible songs', () => {
    component.tracks.set([
      createTrack('one', 'First', 'Artist One', 'Album One', 2024, 20, null),
      createTrack('two', 'Second', 'Artist Two', 'Album Two', 2024, 20, null),
    ]);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.filter-trigger') as HTMLButtonElement).click();
    const selectors: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('app-searchable-filter-select');
    (selectors[0].querySelector('.select-trigger') as HTMLButtonElement).click();
    fixture.detectChanges();
    ([...selectors[0].querySelectorAll('.option-item')].find((item) => item.textContent?.includes('Artist Two')) as HTMLButtonElement).click();
    fixture.detectChanges();
    (selectors[1].querySelector('.select-trigger') as HTMLButtonElement).click();
    fixture.detectChanges();
    ([...selectors[1].querySelectorAll('.option-item')].find((item) => item.textContent?.includes('Album Two')) as HTMLButtonElement).click();
    expect([component.artistFilter(), component.albumFilter()]).toEqual(['Artist Two', 'Album Two']);
    expect(trackIds(component)).toEqual(['two']);
    expect(component.sortColumn()).toBe('title');
  });
});

function trackIds(component: SongsComponent): string[] {
  return component.filteredTracks().map((track) => track.id);
}

function createTrack(id: string, title: string, artist: string | null, album: string | null, year: number | null, duration: number, sampleRate: number | null): Track {
  return {
    id, title, artist, album, year, duration, sampleRate,
    path: id, fileName: id, albumArtist: artist, genre: null, trackNumber: null, discNumber: null,
    codec: 'FLAC', bitrate: null, bitDepth: null, channels: null, artwork: null,
    fileSize: null, lastModified: null, isAvailable: true,
  };
}
