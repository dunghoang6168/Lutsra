import { TestBed } from '@angular/core/testing';
import { NavigationEnd, provideRouter, Router } from '@angular/router';
import { firstValueFrom, filter, take } from 'rxjs';
import { AppComponent } from './app.component';
import { routes } from './app.routes';
import { AUDIO_ANALYSIS_ENGINE, LIBRARY_GATEWAY, LYRICS_GATEWAY, PLAYBACK_ENGINE, PLAYLIST_GATEWAY, SETTINGS_GATEWAY } from './core/contracts';
import { MockLibraryGateway, MockLyricsGateway, MockPlaybackEngine, MockPlaylistGateway, MockSettingsGateway } from './core/mock';
import { MOCK_TRACKS } from './core/mock/fixtures/mock-data';
import { RightPanelService } from './core/layout/right-panel.service';
import { NavigationHistoryService } from './core/layout/navigation-history.service';
import { PlayerService } from './core/player/player.service';
import { LayoutPreferenceService } from './core/layout/layout-preference.service';
import { ArtworkEdgeGlowService } from './core/layout/artwork-edge-glow.service';

describe('AppComponent', () => {
  beforeEach(async () => {
    localStorage.removeItem('lutsra.sidebar.collapsed');
    localStorage.removeItem('lutsra.sidebar.hidden');
    localStorage.removeItem('lutsra.layout.mode');
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideRouter(routes),
        { provide: LIBRARY_GATEWAY, useClass: MockLibraryGateway },
        { provide: PLAYLIST_GATEWAY, useClass: MockPlaylistGateway },
        { provide: SETTINGS_GATEWAY, useClass: MockSettingsGateway },
        { provide: PLAYBACK_ENGINE, useClass: MockPlaybackEngine },
        { provide: AUDIO_ANALYSIS_ENGINE, useExisting: PLAYBACK_ENGINE },
        { provide: LYRICS_GATEWAY, useClass: MockLyricsGateway },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    localStorage.removeItem('lutsra.sidebar.collapsed');
    localStorage.removeItem('lutsra.sidebar.hidden');
    localStorage.removeItem('lutsra.layout.mode');
  });

  it('should create the app shell', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('uses the integrated app header instead of the old demo banner', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('app-header')).not.toBeNull();
    expect(element.querySelector('app-demo-banner')).toBeNull();
    expect(element.querySelectorAll('a[aria-label="Settings"]').length).toBe(1);
    expect(element.querySelector('app-sidebar a[title="Settings"]')).toBeNull();
  });

  it('should toggle sidebar collapsed state', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app.isSidebarCollapsed()).toBeFalse();
    app.onToggleSidebar();
    expect(app.isSidebarCollapsed()).toBeTrue();
  });

  it('hides and restores the entire sidebar from the header without changing its collapsed state', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const app = fixture.componentInstance;
    const element = fixture.nativeElement as HTMLElement;
    const headerToggle = element.querySelector<HTMLButtonElement>('.sidebar-visibility-button')!;

    app.onToggleSidebar();
    fixture.detectChanges();
    expect(element.querySelector('app-sidebar')).not.toBeNull();
    expect(element.querySelector<HTMLButtonElement>('.sidebar-toggle-btn')).not.toBeNull();

    headerToggle.click();
    fixture.detectChanges();
    expect(app.isSidebarHidden()).toBeTrue();
    expect(element.querySelector('app-sidebar')).toBeNull();
    expect(element.querySelector('main.main-content')).not.toBeNull();
    expect(headerToggle.getAttribute('aria-label')).toBe('Show sidebar');
    expect(app.isSidebarCollapsed()).toBeTrue();

    headerToggle.click();
    fixture.detectChanges();
    expect(element.querySelector('app-sidebar')).not.toBeNull();
    expect(element.querySelector<HTMLElement>('.sidebar')?.classList.contains('width-collapsed')).toBeTrue();
    expect(element.querySelector<HTMLButtonElement>('.sidebar-toggle-btn')).not.toBeNull();
    expect(headerToggle.getAttribute('aria-label')).toBe('Hide sidebar');
  });

  it('restores both sidebar preferences when the app shell is created again', () => {
    const first = TestBed.createComponent(AppComponent);
    first.componentInstance.onToggleSidebar();
    first.componentInstance.onToggleSidebarVisibility();
    expect(localStorage.getItem('lutsra.sidebar.collapsed')).toBe('true');
    expect(localStorage.getItem('lutsra.sidebar.hidden')).toBe('true');
    first.destroy();

    const restored = TestBed.createComponent(AppComponent);
    restored.detectChanges();
    const element = restored.nativeElement as HTMLElement;
    expect(restored.componentInstance.isSidebarCollapsed()).toBeTrue();
    expect(restored.componentInstance.isSidebarHidden()).toBeTrue();
    expect(element.querySelector('app-sidebar')).toBeNull();

    element.querySelector<HTMLButtonElement>('.sidebar-visibility-button')!.click();
    restored.detectChanges();
    expect(element.querySelector<HTMLElement>('.sidebar')?.classList.contains('width-collapsed')).toBeTrue();
    expect(localStorage.getItem('lutsra.sidebar.hidden')).toBe('false');
  });

  it('shows the player only for active playback or a nonempty queue', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const player = TestBed.inject(PlayerService);

    expect(element.querySelector('app-player-bar')).toBeNull();
    fixture.componentInstance.onToggleQueue();
    expect(fixture.componentInstance.isQueueOpen()).toBeFalse();

    player.playbackState.set('playing');
    fixture.detectChanges();
    expect(element.querySelector('app-player-bar')).not.toBeNull();

    player.playbackState.set('paused');
    fixture.detectChanges();
    expect(element.querySelector('app-player-bar')).toBeNull();

    player.queue.set([{ id: 'queued-track', track: MOCK_TRACKS[0], originalIndex: 0 }]);
    fixture.detectChanges();
    expect(element.querySelector('app-player-bar')).not.toBeNull();
    expect(element.querySelector('.player-bar')).not.toBeNull();
  });

  it('switches the shared shell to Classic and keeps the footer visible with an empty queue', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const layout = TestBed.inject(LayoutPreferenceService);
    const panels = TestBed.inject(RightPanelService);
    const element = fixture.nativeElement as HTMLElement;
    document.body.appendChild(element);
    try {
      fixture.detectChanges();
      expect(element.querySelector('app-player-bar')).toBeNull();
      await layout.setMode('classic');
      fixture.detectChanges();
      expect(element.querySelector('.app-layout')?.classList).toContain('layout-classic');
      expect(element.querySelector('app-player-bar')).not.toBeNull();
      const sidebar = element.querySelector<HTMLElement>('.sidebar')!;
      const footer = element.querySelector<HTMLElement>('.player-bar')!;
      expect(getComputedStyle(sidebar).borderRightWidth).toBe('1px');
      expect(getComputedStyle(sidebar).borderLeftWidth).toBe('0px');
      expect(getComputedStyle(sidebar).borderTopLeftRadius).toBe('0px');
      expect(getComputedStyle(footer).borderTopWidth).toBe('1px');
      expect(getComputedStyle(footer).borderBottomWidth).toBe('0px');
      expect(getComputedStyle(footer).borderTopLeftRadius).toBe('0px');
      expect(getComputedStyle(element.querySelector('app-sidebar')!).paddingLeft).toBe('0px');
      expect(getComputedStyle(element.querySelector('app-player-bar')!).paddingBottom).toBe('0px');

      fixture.componentInstance.onToggleQueue();
      expect(panels.isQueueOpen()).toBeTrue();
      await layout.setMode('inset');
      fixture.detectChanges();
      expect(element.querySelector('app-player-bar')).toBeNull();
      expect(panels.isQueueOpen()).toBeFalse();
      expect(getComputedStyle(element.querySelector('app-sidebar')!).paddingLeft).toBe('8px');
    } finally {
      element.remove();
    }
  });

  it('shows the Classic footer on Now Playing while preserving the saved sidebar state', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const layout = TestBed.inject(LayoutPreferenceService);
    const player = TestBed.inject(PlayerService);
    player.currentTrack.set(MOCK_TRACKS[0]);
    player.queue.set([{ id: 'queued-track', track: MOCK_TRACKS[0], originalIndex: 0 }]);
    fixture.componentInstance.onToggleSidebar();
    fixture.componentInstance.onToggleSidebarVisibility();
    await layout.setMode('classic');
    await TestBed.inject(Router).navigateByUrl('/now-playing');
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('app-player-bar')).not.toBeNull();
    expect(element.querySelector('.heading-queue-btn')).toBeNull();
    expect(element.querySelector('app-sidebar')).toBeNull();
    expect(fixture.componentInstance.isSidebarCollapsed()).toBeTrue();
    expect(fixture.componentInstance.isSidebarHidden()).toBeTrue();

    player.clearQueue();
    fixture.detectChanges();
    expect(element.querySelector('app-player-bar')).not.toBeNull();
  });

  it('closes the queue drawer and removes the player when the queue is cleared', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const player = TestBed.inject(PlayerService);
    const panels = TestBed.inject(RightPanelService);
    player.queue.set([{ id: 'queued-track', track: MOCK_TRACKS[0], originalIndex: 0 }]);
    player.currentTrack.set(MOCK_TRACKS[0]);
    player.playbackState.set('paused');
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    fixture.componentInstance.onToggleQueue();
    fixture.detectChanges();
    expect(panels.isQueueOpen()).toBeTrue();
    expect(getComputedStyle(element.querySelector<HTMLElement>('.queue-drawer')!).bottom).toBe('0px');

    player.clearQueue();
    fixture.detectChanges();
    expect(element.querySelector('app-player-bar')).toBeNull();
    expect(panels.isQueueOpen()).toBeFalse();
    expect(element.querySelector('main.main-content')).not.toBeNull();
  });

  it('hides the footer on Now Playing without closing queue and restores it on other routes', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const router = TestBed.inject(Router);
    const history = TestBed.inject(NavigationHistoryService);
    const panels = TestBed.inject(RightPanelService);
    const player = TestBed.inject(PlayerService);
    player.queue.set([{ id: 'queued-track', track: MOCK_TRACKS[0], originalIndex: 0 }]);
    player.currentTrack.set(MOCK_TRACKS[0]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-player-bar')).not.toBeNull();

    panels.toggleQueue();
    await router.navigateByUrl('/now-playing?source=queue#controls');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-player-bar')).toBeNull();
    expect(panels.isQueueOpen()).toBeTrue();
    expect(fixture.nativeElement.querySelector('main.main-content')).not.toBeNull();

    await router.navigateByUrl('/songs');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-player-bar')).not.toBeNull();
    expect(panels.isQueueOpen()).toBeTrue();

    const backNavigation = firstValueFrom(router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd), take(1)));
    history.back();
    await backNavigation;
    fixture.detectChanges();
    expect(router.url).toContain('/now-playing');
    expect(fixture.nativeElement.querySelector('app-player-bar')).toBeNull();
    const forwardNavigation = firstValueFrom(router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd), take(1)));
    history.forward();
    await forwardNavigation;
    fixture.detectChanges();
    expect(router.url).toBe('/songs');
    expect(fixture.nativeElement.querySelector('app-player-bar')).not.toBeNull();
  });

  it('switches between a centered Classic background and a cover-aligned Panel glow', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const router = TestBed.inject(Router);
    const player = TestBed.inject(PlayerService);
    const layout = TestBed.inject(LayoutPreferenceService);
    const host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);
    try {
      player.currentTrack.set(MOCK_TRACKS[0]);
      await router.navigateByUrl('/now-playing');
      fixture.detectChanges();
      await TestBed.inject(ArtworkEdgeGlowService).getGlow(MOCK_TRACKS[0].artwork!);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      fixture.detectChanges();

      const workspace = host.querySelector<HTMLElement>('.workspace')!;
      const appLayout = host.querySelector<HTMLElement>('.app-layout')!;
      const cover = host.querySelector<HTMLImageElement>('.large-artwork-img')!;
      const glow = host.querySelector<HTMLImageElement>('.panel-edge-glow-img')!;
      const main = host.querySelector<HTMLElement>('.main-content')!;
      expect(workspace.classList).toContain('has-ambient-artwork');
      expect(getComputedStyle(main).backgroundColor).toBe('rgba(0, 0, 0, 0)');
      expect(glow.src).toContain('data:image/png;base64,');
      expect(getComputedStyle(glow).filter).toContain('blur(32px) brightness(2.4)');
      expect(glow.getBoundingClientRect().left + cover.getBoundingClientRect().width)
        .toBeCloseTo(cover.getBoundingClientRect().left, 0);
      expect(glow.getBoundingClientRect().top + cover.getBoundingClientRect().height)
        .toBeCloseTo(cover.getBoundingClientRect().top, 0);
      expect(glow.getBoundingClientRect().width).toBeCloseTo(cover.getBoundingClientRect().width * 3, 0);
      expect(host.querySelector('.classic-ambient-img')).toBeNull();
      expect(host.querySelector('.artwork-glow-img')).toBeNull();

      fixture.componentInstance.onToggleSidebar();
      fixture.componentInstance.onToggleSidebarVisibility();
      fixture.detectChanges();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      fixture.detectChanges();
      expect(host.querySelector('app-sidebar')).toBeNull();
      expect(host.querySelector<HTMLImageElement>('.panel-edge-glow-img')!.getBoundingClientRect().left +
        cover.getBoundingClientRect().width).toBeCloseTo(cover.getBoundingClientRect().left, 0);

      await layout.setMode('classic');
      fixture.detectChanges();
      const classic = host.querySelector<HTMLImageElement>('.classic-ambient-img')!;
      expect(host.querySelector('.panel-edge-glow-img')).toBeNull();
      expect(classic.src).toBe(cover.src);
      expect(getComputedStyle(classic).filter).toContain('blur(52px)');
      expect(classic.getBoundingClientRect().left + classic.getBoundingClientRect().width / 2)
        .toBeCloseTo(appLayout.getBoundingClientRect().left + appLayout.getBoundingClientRect().width / 2, 0);

      const differentCover = MOCK_TRACKS.find((track) => track.artwork && track.artwork !== MOCK_TRACKS[0].artwork)!;
      player.currentTrack.set(differentCover);
      fixture.detectChanges();
      expect(host.querySelector<HTMLImageElement>('.classic-ambient-img')!.src)
        .toBe(host.querySelector<HTMLImageElement>('.large-artwork-img')!.src);

      await layout.setMode('inset');
      fixture.detectChanges();
      await TestBed.inject(ArtworkEdgeGlowService).getGlow(differentCover.artwork!);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      fixture.detectChanges();
      expect(host.querySelector<HTMLImageElement>('.panel-edge-glow-img')!.src).toContain('data:image/png;base64,');
      expect(host.querySelector('.classic-ambient-img')).toBeNull();

      player.currentTrack.set(MOCK_TRACKS.find((track) => !track.artwork)!);
      fixture.detectChanges();
      expect(workspace.classList).not.toContain('has-ambient-artwork');
      expect(host.querySelector('.now-playing-backdrop')).toBeNull();
      main.getAnimations().forEach((animation) => animation.finish());
      expect(getComputedStyle(main).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');

      player.currentTrack.set(MOCK_TRACKS[0]);
      await router.navigateByUrl('/songs');
      fixture.detectChanges();
      expect(workspace.classList).not.toContain('has-ambient-artwork');
      expect(host.querySelector('.now-playing-backdrop')).toBeNull();
    } finally {
      host.remove();
    }
  });

  it('uses the original Panel glow if cover pixels cannot be read', async () => {
    spyOn(TestBed.inject(ArtworkEdgeGlowService), 'getGlow').and.resolveTo(null);
    const fixture = TestBed.createComponent(AppComponent);
    const player = TestBed.inject(PlayerService);
    const element = fixture.nativeElement as HTMLElement;
    document.body.appendChild(element);
    try {
      player.currentTrack.set(MOCK_TRACKS[0]);
      await TestBed.inject(Router).navigateByUrl('/now-playing');
      fixture.detectChanges();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      fixture.detectChanges();

      const fallback = element.querySelector<HTMLImageElement>('.panel-glow-img');
      expect(fallback?.src).toBe(MOCK_TRACKS[0].artwork!);
      expect(element.querySelector('.panel-edge-glow-img')).toBeNull();
    } finally {
      element.remove();
    }
  });

  it('uses a fixed 100% Panel glow without a temporary control', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);
    try {
      TestBed.inject(PlayerService).currentTrack.set(MOCK_TRACKS[0]);
      await TestBed.inject(Router).navigateByUrl('/now-playing');
      fixture.detectChanges();
      await TestBed.inject(ArtworkEdgeGlowService).getGlow(MOCK_TRACKS[0].artwork!);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      fixture.detectChanges();

      const cover = host.querySelector<HTMLElement>('.large-artwork-card')!;
      const glow = host.querySelector<HTMLElement>('.panel-edge-glow-img')!;
      expect(host.querySelector('.ambient-spread-control')).toBeNull();
      expect(glow.getBoundingClientRect().width).toBeCloseTo(cover.getBoundingClientRect().width * 3, 0);
      expect(glow.getBoundingClientRect().left + cover.getBoundingClientRect().width)
        .toBeCloseTo(cover.getBoundingClientRect().left, 0);

      await TestBed.inject(LayoutPreferenceService).setMode('classic');
      fixture.detectChanges();
      expect(host.querySelector('.ambient-spread-control')).toBeNull();
      expect(host.querySelector('.panel-edge-glow-img')).toBeNull();
    } finally {
      host.remove();
    }
  });

  it('handles Space in the app shell while the footer is hidden and ignores focused controls', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const player = TestBed.inject(PlayerService);
    player.queue.set([{ id: 'queued-track', track: MOCK_TRACKS[0], originalIndex: 0 }]);
    player.currentTrack.set(MOCK_TRACKS[0]);
    fixture.detectChanges();
    await TestBed.inject(Router).navigateByUrl('/now-playing');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-player-bar')).toBeNull();

    const toggle = spyOn(player, 'togglePlayPause');
    const event = new KeyboardEvent('keydown', { code: 'Space', cancelable: true });
    fixture.componentInstance.onKeyDown(event);
    expect(event.defaultPrevented).toBeTrue();
    expect(toggle).toHaveBeenCalledTimes(1);

    const input = document.createElement('input');
    const button = document.createElement('button');
    document.body.append(input, button);
    try {
      for (const control of [input, button]) {
        control.focus();
        const focusedEvent = new KeyboardEvent('keydown', { code: 'Space', cancelable: true });
        fixture.componentInstance.onKeyDown(focusedEvent);
        expect(focusedEvent.defaultPrevented).toBeFalse();
        expect(toggle).toHaveBeenCalledTimes(1);
      }
    } finally {
      input.remove();
      button.remove();
    }
  });

  it('should toggle and close queue drawer', () => {
    const fixture = TestBed.createComponent(AppComponent);
    TestBed.inject(PlayerService).queue.set([{ id: 'queued-track', track: MOCK_TRACKS[0], originalIndex: 0 }]);
    const app = fixture.componentInstance;
    expect(app.isQueueOpen()).toBeFalse();
    app.onToggleQueue();
    expect(app.isQueueOpen()).toBeTrue();
    app.onCloseQueue();
    expect(app.isQueueOpen()).toBeFalse();
  });

  it('opens only one right panel at a time', () => {
    const fixture = TestBed.createComponent(AppComponent);
    TestBed.inject(PlayerService).queue.set([{ id: 'queued-track', track: MOCK_TRACKS[0], originalIndex: 0 }]);
    const app = fixture.componentInstance;
    const panels = TestBed.inject(RightPanelService);
    panels.openTrackDetails();
    expect(panels.isTrackDetailsOpen()).toBeTrue();
    app.onToggleQueue();
    expect(app.isQueueOpen()).toBeTrue();
    expect(panels.isTrackDetailsOpen()).toBeFalse();
  });
});
