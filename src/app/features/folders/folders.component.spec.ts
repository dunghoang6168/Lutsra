import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Subject } from 'rxjs';
import { LIBRARY_GATEWAY, LYRICS_GATEWAY } from '../../core/contracts';
import { FolderNode, MusicFolder, ScanProgress, Track } from '../../core/models';
import { PlayerService } from '../../core/player/player.service';
import { FoldersComponent } from './folders.component';

describe('FoldersComponent file order', () => {
  let fixture: ComponentFixture<any>;
  let component: FoldersComponent;
  let tree: FolderNode;
  let tracks: Track[];
  let player: { playCollection: jasmine.Spy };
  const root: MusicFolder = { id: 'root', name: 'Music', path: 'C:/Music', addedAt: 1 };

  beforeEach(async () => {
    tree = folder('root-node', 'Music', [
      file('ten', '10. Finale.flac', 'C:/Music/10. Finale.flac'),
      file('two', '2. Second.flac', 'C:/Music/2. Second.flac'),
      file('alpha-b', 'alpha.flac', 'C:/Music/B/alpha.flac'),
      file('one', '1. First.flac', 'C:/Music/1. First.flac'),
      file('alpha-a', 'Alpha.flac', 'C:/Music/A/Alpha.flac'),
    ]);
    tracks = ['ten', 'two', 'alpha-b', 'one', 'alpha-a'].map((id, index) => track(id, 5 - index));
    player = { playCollection: jasmine.createSpy('playCollection') };
    const scanProgress = new Subject<ScanProgress>();
    await TestBed.configureTestingModule({
      imports: [FoldersComponent],
      providers: [
        provideRouter([{ path: 'folders', component: FoldersComponent }]),
        { provide: PlayerService, useValue: player },
        { provide: LYRICS_GATEWAY, useValue: { findTracksWithLyrics: async () => ['two', 'alpha-a'] } },
        { provide: LIBRARY_GATEWAY, useValue: {
          getLibrary: async () => ({ tracks, albums: [], artists: [], folders: [root] }),
          getFolderTree: async () => tree,
          scanProgress$: scanProgress,
        } },
      ],
    }).compileComponents();
    const harness = await RouterTestingHarness.create();
    component = await harness.navigateByUrl('/folders', FoldersComponent);
    fixture = harness.fixture;
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('shows a natural file-name order without changing the folder tree', () => {
    expect(fileIds(component)).toEqual(['one', 'two', 'ten', 'alpha-a', 'alpha-b']);
    const renderedNames = Array.from(fixture.nativeElement.querySelectorAll('.file-title') as NodeListOf<HTMLElement>)
      .map((element) => element.textContent?.trim());
    expect(renderedNames).toEqual(['one', 'two', 'ten', 'alpha-a', 'alpha-b']);
    expect(tree.children?.map((child) => child.trackId)).toEqual(['ten', 'two', 'alpha-b', 'one', 'alpha-a']);
  });

  it('shows metadata titles and Songs-style codec badges with a filename fallback', () => {
    component.allTracks.set([
      { ...tracks.find((track) => track.id === 'one')!, title: 'Metadata title', codec: 'MP3', sampleRate: 96000 },
      ...tracks.filter((track) => track.id !== 'one' && track.id !== 'two'),
    ]);
    fixture.detectChanges();
    const headers = Array.from(fixture.nativeElement.querySelectorAll('.files-table th') as NodeListOf<HTMLElement>);
    expect(headers.map((header) => header.textContent?.trim())).toEqual(['#', 'Title', 'Codec', 'Lyrics', 'Duration']);
    const rows = Array.from(fixture.nativeElement.querySelectorAll('.file-row') as NodeListOf<HTMLElement>);
    expect(rows[0].querySelector('.file-title')?.textContent?.trim()).toBe('Metadata title');
    expect(rows[0].querySelector('.file-title')?.getAttribute('title')).toBe('Metadata title');
    expect(rows[0].querySelector('.badge-codec')?.textContent?.trim()).toBe('MP3');
    expect(rows[0].querySelector('.badge-codec')?.classList.contains('hi-res')).toBeTrue();
    expect(rows[1].querySelector('.file-title')?.textContent?.trim()).toBe('2. Second.flac');
    expect(rows[1].querySelector('.badge-codec')?.textContent?.trim()).toBe('UNKNOWN');
    expect(fileIds(component)).toEqual(['one', 'two', 'ten', 'alpha-a', 'alpha-b']);
  });

  it('shows an accent-colored check only for files with a matching lyric file', async () => {
    await fixture.whenStable();
    fixture.detectChanges();
    const rows = Array.from(fixture.nativeElement.querySelectorAll('.file-row') as NodeListOf<HTMLElement>);
    expect(rows.map((row) => Boolean(row.querySelector('.lyrics-check')))).toEqual([false, true, false, true, false]);
    expect(rows[1].querySelector('.col-lyrics')?.getAttribute('aria-label')).toBe('Lyrics available');
    expect(rows[0].querySelector('.col-lyrics')?.getAttribute('aria-label')).toBe('No lyrics');
    expect(getComputedStyle(rows[1].querySelector('.lyrics-check')!).color)
      .toBe(getComputedStyle(fixture.nativeElement.querySelector('.root-tab.active')).color);
  });

  it('uses path and ID to break ties between equal file names', () => {
    const source = [
      file('b', 'Same.flac', 'C:/Music/B/Same.flac'),
      file('z', 'same.flac', 'C:/Music/A/Same.flac'),
      file('a', 'Same.flac', 'C:/Music/A/Same.flac'),
    ];
    component.nodeStack.set([folder('ties', 'Ties', source)]);
    expect(fileIds(component)).toEqual(['a', 'z', 'b']);
    expect(source.map((node) => node.id)).toEqual(['b', 'z', 'a']);
  });
  it('plays files in the displayed order regardless of track metadata', () => {
    component.onPlayFolderFiles();
    const queuedTracks = player.playCollection.calls.mostRecent().args[0] as Track[];
    expect(queuedTracks.map((queued) => queued.id)).toEqual(fileIds(component));
    expect(player.playCollection.calls.mostRecent().args[1]).toBe(0);
  });

  it('reorders the current folder after navigation and a library reload', async () => {
    const nested = folder('nested', 'Nested', [
      file('nested-ten', '10.flac', 'C:/Music/Nested/10.flac'),
      file('nested-two', '2.flac', 'C:/Music/Nested/2.flac'),
    ]);
    tree.children?.push(nested);
    component.onEnterFolder(nested);
    await fixture.whenStable();
    expect(fileIds(component)).toEqual(['nested-two', 'nested-ten']);
    component.onNavigateBreadcrumb(0);
    await fixture.whenStable();
    expect(fileIds(component)).toEqual(['one', 'two', 'ten', 'alpha-a', 'alpha-b']);

    tree = folder('root-node', 'Music', [
      file('new-ten', '10.flac', 'C:/Music/10.flac'),
      file('new-one', '1.flac', 'C:/Music/1.flac'),
    ]);
    await component.loadRoots();
    fixture.detectChanges();
    expect(fileIds(component)).toEqual(['new-one', 'new-ten']);
  });
});

function fileIds(component: FoldersComponent): string[] {
  return component.filesInCurrentFolder().map((node) => node.trackId!);
}

function file(id: string, name: string, path: string): FolderNode {
  return { id, name, path, isFolder: false, trackId: id };
}

function folder(id: string, name: string, children: FolderNode[]): FolderNode {
  return { id, name, path: `C:/Music/${name}`, isFolder: true, children };
}

function track(id: string, trackNumber: number): Track {
  return {
    id, path: `C:/Music/${id}.flac`, fileName: `${id}.flac`, title: id,
    artist: null, albumArtist: null, album: null, genre: null, year: null,
    trackNumber, discNumber: 1, duration: 60, codec: 'FLAC', bitrate: null,
    sampleRate: null, bitDepth: null, channels: null, artwork: null,
    fileSize: null, lastModified: null, isAvailable: true,
  };
}
