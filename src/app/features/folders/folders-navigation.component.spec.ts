import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { filter, firstValueFrom, Subject } from 'rxjs';
import { LIBRARY_GATEWAY, LYRICS_GATEWAY } from '../../core/contracts';
import { NavigationHistoryService } from '../../core/layout/navigation-history.service';
import { FolderNode, MusicFolder, ScanProgress } from '../../core/models';
import { PlayerService } from '../../core/player/player.service';
import { FoldersComponent } from './folders.component';

@Component({ standalone: true, template: '' })
class EmptyRouteComponent {}

describe('Folders navigation history', () => {
  const firstRoot: MusicFolder = { id: 'first', name: 'Music', path: 'C:/Music', addedAt: 1 };
  const secondRoot: MusicFolder = { id: 'second', name: 'Other', path: 'D:/Other', addedAt: 2 };
  let firstTree: FolderNode;
  let secondTree: FolderNode;
  let roots: MusicFolder[];
  let scanProgress: Subject<ScanProgress>;
  let router: Router;
  let history: NavigationHistoryService;
  let harness: RouterTestingHarness;
  let component: FoldersComponent;

  beforeEach(async () => {
    firstTree = folder('first-node', 'Music', [folder('jp', 'JP', [folder('album', 'Album', [])])]);
    secondTree = folder('second-node', 'Other', [folder('rock', 'Rock', [])]);
    roots = [firstRoot, secondRoot];
    scanProgress = new Subject<ScanProgress>();
    await TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'home', component: EmptyRouteComponent },
          { path: 'folders', component: FoldersComponent },
        ]),
        { provide: PlayerService, useValue: {} },
        { provide: LYRICS_GATEWAY, useValue: { findTracksWithLyrics: async () => [] } },
        { provide: LIBRARY_GATEWAY, useValue: {
          getLibrary: async () => ({ tracks: [], albums: [], artists: [], folders: roots }),
          getFolderTree: async (id: string) => id === firstRoot.id ? firstTree : secondTree,
          scanProgress$: scanProgress,
        } },
      ],
    }).compileComponents();
    router = TestBed.inject(Router);
    history = TestBed.inject(NavigationHistoryService);
    harness = await RouterTestingHarness.create();
  });

  async function openFolders(url = '/folders'): Promise<void> {
    await harness.navigateByUrl('/home');
    component = await harness.navigateByUrl(url, FoldersComponent);
    await harness.fixture.whenStable();
  }

  async function navigate(action: () => void): Promise<void> {
    const finished = firstValueFrom(router.events.pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd)));
    action();
    await finished;
    harness.fixture.detectChanges();
    await harness.fixture.whenStable();
    harness.fixture.detectChanges();
  }

  it('backs through every folder level to Home and forwards through them again', async () => {
    await openFolders();
    const jp = firstTree.children![0];
    const album = jp.children![0];
    await navigate(() => component.onEnterFolder(jp));
    await navigate(() => component.onEnterFolder(album));
    expect(component.nodeStack().map((node) => node.id)).toEqual(['first-node', 'jp', 'album']);
    expect(router.parseUrl(router.url).queryParamMap.getAll('folder')).toEqual(['jp', 'album']);

    await navigate(() => history.back());
    expect(component.currentNode()?.id).toBe('jp');
    await navigate(() => history.back());
    expect(component.currentNode()?.id).toBe('first-node');
    await navigate(() => history.back());
    expect(router.url).toBe('/home');

    await navigate(() => history.forward());
    component = harness.routeDebugElement!.componentInstance as FoldersComponent;
    await harness.fixture.whenStable();
    expect(component.currentNode()?.id).toBe('first-node');
    await navigate(() => history.forward());
    await navigate(() => history.forward());
    expect(component.currentNode()?.id).toBe('album');
  });

  it('records root and breadcrumb changes and drops forward history after branching', async () => {
    await openFolders();
    const jp = firstTree.children![0];
    await navigate(() => component.onEnterFolder(jp));
    await navigate(() => component.onNavigateBreadcrumb(0));
    await navigate(() => component.onSelectRoot(secondRoot));
    expect(component.currentNode()?.id).toBe('second-node');
    await navigate(() => history.back());
    expect(component.currentNode()?.id).toBe('first-node');
    await navigate(() => history.back());
    expect(component.currentNode()?.id).toBe('jp');
    expect(history.canGoForward()).toBeTrue();
    await navigate(() => component.onEnterFolder(jp.children![0]));
    expect(component.currentNode()?.id).toBe('album');
    expect(history.canGoForward()).toBeFalse();
  });

  it('restores a direct folder URL and falls back to the nearest folder after a rescan', async () => {
    await openFolders('/folders?root=first&folder=jp&folder=album');
    expect(component.currentNode()?.id).toBe('album');
    firstTree = folder('first-node', 'Music', [folder('jp', 'JP', [])]);
    await component.loadRoots();
    await harness.fixture.whenStable();
    expect(component.currentNode()?.id).toBe('jp');
    expect(router.parseUrl(router.url).queryParamMap.getAll('folder')).toEqual(['jp']);
    expect(history.canGoBack()).toBeTrue();
    await navigate(() => history.back());
    expect(router.url).toBe('/home');
  });

  it('selects the first available root when the selected root is removed', async () => {
    await openFolders('/folders?root=second&folder=rock');
    expect(component.currentNode()?.id).toBe('rock');
    roots = [firstRoot];
    await component.loadRoots();
    await harness.fixture.whenStable();
    expect(component.selectedRootId()).toBe('first');
    expect(component.currentNode()?.id).toBe('first-node');
    expect(router.parseUrl(router.url).queryParamMap.get('root')).toBe('first');
    expect(router.parseUrl(router.url).queryParamMap.getAll('folder')).toEqual([]);
  });
});

function folder(id: string, name: string, children: FolderNode[]): FolderNode {
  return { id, name, path: `C:/${name}`, isFolder: true, children };
}
