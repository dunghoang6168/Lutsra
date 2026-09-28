import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AUDIO_ANALYSIS_ENGINE, LYRICS_GATEWAY, LyricsGateway, PLAYBACK_ENGINE, SETTINGS_GATEWAY } from '../../core/contracts';
import { RightPanelService } from '../../core/layout/right-panel.service';
import { LayoutPreferenceService } from '../../core/layout/layout-preference.service';
import { MockPlaybackEngine, MockSettingsGateway } from '../../core/mock';
import { MOCK_TRACKS } from '../../core/mock/fixtures/mock-data';
import { PlayerService } from '../../core/player/player.service';
import { NowPlayingComponent } from './now-playing.component';

describe('NowPlayingComponent', () => {
  let fixture: ComponentFixture<NowPlayingComponent>;
  let player: PlayerService;
  let rightPanels: RightPanelService;
  let lyricsGateway: jasmine.SpyObj<LyricsGateway>;

  beforeEach(async () => {
    localStorage.removeItem('lutsra.layout.mode');
    lyricsGateway = jasmine.createSpyObj<LyricsGateway>('LyricsGateway', ['getLyrics']);
    lyricsGateway.getLyrics.and.resolveTo('[00:01.00]First line\n[00:08.00]Second line\n[00:15.00]Third line\n[00:22.00]Fourth line');
    await TestBed.configureTestingModule({
      imports: [NowPlayingComponent],
      providers: [
        provideRouter([]),
        MockPlaybackEngine,
        { provide: PLAYBACK_ENGINE, useExisting: MockPlaybackEngine },
        { provide: AUDIO_ANALYSIS_ENGINE, useExisting: MockPlaybackEngine },
        { provide: SETTINGS_GATEWAY, useClass: MockSettingsGateway },
        { provide: LYRICS_GATEWAY, useValue: lyricsGateway },
        PlayerService,
      ],
    }).compileComponents();

    player = TestBed.inject(PlayerService);
    rightPanels = TestBed.inject(RightPanelService);
    player.currentTrack.set(MOCK_TRACKS[0]);
    player.duration.set(MOCK_TRACKS[0].duration);
    fixture = TestBed.createComponent(NowPlayingComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    localStorage.removeItem('lutsra.layout.mode');
  });

  it('places the shared queue toggle in the track heading and reflects its count and open state', () => {
    player.queue.set([{ id: 'queued-track', track: MOCK_TRACKS[0], originalIndex: 0 }]);
    fixture.detectChanges();
    const heading = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.track-heading-card')!;
    const button = heading.querySelector<HTMLButtonElement>('.heading-queue-btn')!;
    expect(button).not.toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-controls')).toBe('queue-drawer');
    expect(button.querySelector('.queue-badge')?.textContent?.trim()).toBe('1');
    expect(heading.querySelector('h1')?.textContent).toContain(MOCK_TRACKS[0].title);
    expect((fixture.nativeElement as HTMLElement).querySelector('.volume-slider')).toBeNull();

    button.click();
    fixture.detectChanges();
    expect(rightPanels.isQueueOpen()).toBeTrue();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.classList).toContain('active');
    button.click();
    fixture.detectChanges();
    expect(rightPanels.isQueueOpen()).toBeFalse();
  });

  it('uses the footer queue button in Classic layout', async () => {
    await TestBed.inject(LayoutPreferenceService).setMode('classic');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.heading-queue-btn')).toBeNull();
  });

  it('removes the cover shadow in Panel and restores it when switching to Classic', async () => {
    const host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);
    try {
      const page = host.querySelector<HTMLElement>('.now-playing-page')!;
      const cover = host.querySelector<HTMLElement>('.large-artwork-card')!;
      const radius = getComputedStyle(cover).borderRadius;
      expect(page.classList).not.toContain('layout-classic');
      expect(getComputedStyle(cover).boxShadow).toBe('none');

      const layout = TestBed.inject(LayoutPreferenceService);
      await layout.setMode('classic');
      fixture.detectChanges();
      expect(page.classList).toContain('layout-classic');
      expect(getComputedStyle(cover).boxShadow).not.toBe('none');
      expect(getComputedStyle(cover).borderRadius).toBe(radius);

      await layout.setMode('inset');
      fixture.detectChanges();
      expect(getComputedStyle(cover).boxShadow).toBe('none');
    } finally {
      host.remove();
    }
  });

  it('keeps the queue button beside the title at wide and narrow content widths', () => {
    const host = fixture.nativeElement as HTMLElement;
    const container = document.createElement('div');
    container.style.cssText = 'width: 1000px; height: 800px; container-type: inline-size; container-name: main-content;';
    host.style.cssText = 'display: block; height: 100%;';
    document.body.appendChild(container);
    container.appendChild(host);
    try {
      const heading = host.querySelector<HTMLElement>('.track-heading-card')!;
      const title = host.querySelector<HTMLElement>('.track-heading-text')!;
      const button = host.querySelector<HTMLElement>('.heading-queue-btn')!;
      for (const width of [1000, 520, 280]) {
        container.style.width = `${width}px`;
        const headingRect = heading.getBoundingClientRect();
        const titleRect = title.getBoundingClientRect();
        const buttonRect = button.getBoundingClientRect();
        expect(buttonRect.left).toBeGreaterThanOrEqual(titleRect.right);
        expect(buttonRect.right).toBeLessThanOrEqual(headingRect.right);
        expect(heading.scrollWidth).toBeLessThanOrEqual(heading.clientWidth);
      }
    } finally {
      container.remove();
    }
  });

  it('hides the technical summary while Track Properties is open', () => {
    const summary = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.technical-specs-card')!;
    expect(getComputedStyle(summary).display).not.toBe('none');

    rightPanels.openTrackDetails(summary);
    fixture.detectChanges();
    expect(summary.classList).toContain('hidden-while-details-open');
    expect(getComputedStyle(summary).display).toBe('none');

    rightPanels.closeTrackDetails(false);
    fixture.detectChanges();
    expect(getComputedStyle(summary).display).not.toBe('none');
  });

  it('renders the cover without a second glow inside the page', () => {
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector<HTMLImageElement>('.large-artwork-img')?.getAttribute('src')).toBe(MOCK_TRACKS[0].artwork!);
    expect(host.querySelector('.artwork-glow-img')).toBeNull();
    const differentCover = MOCK_TRACKS.find((track) => track.artwork && track.artwork !== MOCK_TRACKS[0].artwork)!;
    player.currentTrack.set(differentCover);
    fixture.detectChanges();
    expect(host.querySelector<HTMLImageElement>('.large-artwork-img')?.getAttribute('src')).toBe(differentCover.artwork!);
    player.currentTrack.set(MOCK_TRACKS.find((track) => !track.artwork)!);
    fixture.detectChanges();
    expect(host.querySelector('.large-artwork-img')).toBeNull();
  });

  it('lets the shared workspace ambient show through the page while keeping the cover raised', () => {
    const host = fixture.nativeElement as HTMLElement;
    const container = document.createElement('div');
    container.style.cssText = 'width: 1000px; height: 800px; container-type: inline-size; container-name: main-content;';
    host.style.cssText = 'display: block; height: 100%;';
    document.body.appendChild(container);
    container.appendChild(host);
    try {
      const page = host.querySelector<HTMLElement>('.now-playing-page')!;
      const cover = host.querySelector<HTMLElement>('.large-artwork-card')!;
      expect(getComputedStyle(page).backgroundColor).toBe('rgba(0, 0, 0, 0)');
      expect(getComputedStyle(page).backgroundImage).toBe('none');
      expect(getComputedStyle(cover).borderTopWidth).toBe('0px');
      container.style.width = '700px';
      expect(getComputedStyle(page).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    } finally {
      container.remove();
    }
  });

  it('puts lyrics below controls at the same width when the main content narrows', async () => {
    await fixture.whenStable();
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const container = document.createElement('div');
    container.style.cssText = 'width: 1000px; height: 900px; container-type: inline-size; container-name: main-content;';
    host.style.display = 'block';
    host.style.height = '100%';
    document.body.appendChild(container);
    container.appendChild(host);
    try {
      const content = host.querySelector<HTMLElement>('.now-playing-content')!;
      const cover = host.querySelector<HTMLElement>('.artwork-column')!;
      const lyrics = host.querySelector<HTMLElement>('.lyrics-card')!;
      const controls = host.querySelector<HTMLElement>('.details-column')!;
      const specs = host.querySelector<HTMLElement>('.technical-specs-card')!;
      if (matchMedia('(min-width: 961px)').matches) expect(getComputedStyle(content).display).toBe('grid');

      container.style.width = '700px';
      expect(getComputedStyle(content).display).toBe('flex');
      expect(controls.getBoundingClientRect().top).toBeGreaterThanOrEqual(cover.getBoundingClientRect().bottom);
      expect(specs.getBoundingClientRect().top).toBeGreaterThanOrEqual(controls.getBoundingClientRect().bottom);
      expect(lyrics.getBoundingClientRect().top).toBeGreaterThanOrEqual(specs.getBoundingClientRect().bottom);
      expect(lyrics.getBoundingClientRect().width).toBeCloseTo(controls.getBoundingClientRect().width, 0);
      expect(content.scrollWidth).toBeLessThanOrEqual(content.clientWidth);

      rightPanels.openTrackDetails(specs);
      fixture.detectChanges();
      container.style.width = '280px';
      expect(lyrics.getBoundingClientRect().top).toBeGreaterThanOrEqual(controls.getBoundingClientRect().bottom);
      expect(lyrics.getBoundingClientRect().width).toBeCloseTo(controls.getBoundingClientRect().width, 0);
      expect(content.scrollWidth).toBeLessThanOrEqual(content.clientWidth);

      rightPanels.closeTrackDetails(false);
      fixture.detectChanges();
      container.style.width = '1000px';
      if (matchMedia('(min-width: 961px)').matches) expect(getComputedStyle(content).display).toBe('grid');
    } finally {
      container.remove();
    }
  });

  it('omits the source-quality header and uses the compact fixed scrollbar', () => {
    const element = fixture.nativeElement as HTMLElement;
    const page = element.querySelector<HTMLElement>('.now-playing-page')!;

    expect(element.querySelector('.badge-source-quality')).toBeNull();
    expect(element.querySelector('.quality-text')).toBeNull();
    expect(element.querySelector('.track-header-tags')).toBeNull();
    expect(getComputedStyle(page).scrollbarGutter).toBe('stable');
    expect(getComputedStyle(page, '::-webkit-scrollbar').width).toBe('6px');
  });

  it('shows the cover and a height-aware lyric viewport with all lines', async () => {
    await fixture.whenStable();
    player.currentTime.set(8.5);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const cover = element.querySelector<HTMLElement>('.large-artwork-card')!;
    const card = element.querySelector<HTMLElement>('.lyrics-card')!;
    const specs = element.querySelector<HTMLElement>('.technical-specs-card')!;
    const page = element.querySelector<HTMLElement>('.now-playing-page')!;
    expect(cover).not.toBeNull();
    expect(card).not.toBeNull();
    expect(card.parentElement).toBe(specs.parentElement);
    expect(getComputedStyle(card).gridColumnStart).toBe('1');
    expect(getComputedStyle(specs).gridColumnStart).toBe('2');
    expect(element.querySelector('[role="tablist"]')).toBeNull();
    expect(element.querySelector('[title*="full screen"]')).toBeNull();
    const lines = element.querySelectorAll<HTMLButtonElement>('.lyrics-line');
    const viewport = element.querySelector<HTMLElement>('.lyrics-lines')!;
    expect(lines.length).toBe(4);
    expect(lines[1].textContent).toContain('Second line');
    expect(lines[1].classList).toContain('active');
    expect(card.querySelector('h2')!.textContent).toBe('Lyrics');
    expect(element.querySelector('.lyrics-expand')).toBeNull();
    const isStacked = matchMedia('(max-width: 960px)').matches ||
      !!cover.closest('.main-content') && cover.closest('.main-content')!.getBoundingClientRect().width <= 760;
    const expectedLyricHeight = isStacked ? 240 : Math.min(520, Math.max(240, innerHeight * 0.28));
    expect(card.getBoundingClientRect().height).toBeCloseTo(expectedLyricHeight, 0);
    expect(getComputedStyle(lines[0]).fontSize).toBe('14px');
    expect(getComputedStyle(viewport).overflowY).toBe('hidden');
    expect(getComputedStyle(viewport).maskImage).toContain('linear-gradient');
    spyOn(player, 'seek');
    lines[2].click();
    expect(player.seek).toHaveBeenCalledWith(15);
    expect(getComputedStyle(page).overflowY).toBe('auto');
  });

  it('smoothly centers the active line inside lyrics without scrolling the page', async () => {
    await fixture.whenStable();
    fixture.detectChanges();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const element = fixture.nativeElement as HTMLElement;
    const viewport = element.querySelector<HTMLElement>('.lyrics-lines')!;
    const page = element.querySelector<HTMLElement>('.now-playing-page')!;
    const line = viewport.querySelector<HTMLElement>('[data-lyric-index="2"]')!;
    const scroll = spyOn(viewport, 'scrollTo');
    const pageScroll = spyOn(page, 'scrollTo');
    spyOn(viewport, 'getBoundingClientRect').and.returnValue({ top: 100 } as DOMRect);
    spyOn(line, 'getBoundingClientRect').and.returnValue({ top: 300 } as DOMRect);
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 200 });
    Object.defineProperty(line, 'offsetHeight', { configurable: true, value: 30 });

    player.currentTime.set(16);
    fixture.detectChanges();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(scroll.calls.mostRecent().args[0] as unknown as ScrollToOptions).toEqual({ top: 115, behavior: 'smooth' });
    expect(pageScroll).not.toHaveBeenCalled();
    fixture.detectChanges();
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it('uses instant lyric scrolling when reduced motion is enabled', async () => {
    await fixture.whenStable();
    fixture.detectChanges();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const viewport = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.lyrics-lines')!;
    const scroll = spyOn(viewport, 'scrollTo');
    spyOn(window, 'matchMedia').and.returnValue({ matches: true } as MediaQueryList);
    player.currentTime.set(16);
    fixture.detectChanges();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(scroll.calls.mostRecent().args[0] as unknown as ScrollToOptions).toEqual(jasmine.objectContaining({ behavior: 'instant' }));
  });

  it('clears lyrics on track change and ignores a late response for the previous track', async () => {
    await fixture.whenStable();
    let completeOld!: (value: string | null) => void;
    lyricsGateway.getLyrics.and.returnValues(
      new Promise<string | null>((resolve) => { completeOld = resolve; }),
      Promise.resolve('[00:02.00]New song'),
    );
    player.currentTrack.set(MOCK_TRACKS[1]);
    fixture.detectChanges();
    expect(fixture.componentInstance.lyricLines()).toEqual([]);
    player.currentTrack.set(MOCK_TRACKS[2]);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.lyricLines()[0].text).toBe('New song');
    completeOld('[00:03.00]Old song');
    await Promise.resolve();
    expect(fixture.componentInstance.lyricLines()[0].text).toBe('New song');
  });

  it('distinguishes missing, unsupported and unreadable lyrics', async () => {
    await fixture.whenStable();
    lyricsGateway.getLyrics.and.resolveTo(null);
    player.currentTrack.set(MOCK_TRACKS[1]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.lyricsStatus()).toBe('missing');
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.lyrics-card')).toBeNull();
    expect(getComputedStyle(element.querySelector<HTMLElement>('.technical-specs-card')!).gridColumn).toBe('1 / -1');

    lyricsGateway.getLyrics.and.resolveTo('[ar:Artist]');
    player.currentTrack.set(MOCK_TRACKS[2]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.lyricsStatus()).toBe('unsupported');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('no timed lyric lines');

    lyricsGateway.getLyrics.and.rejectWith(new Error('Unreadable'));
    player.currentTrack.set(MOCK_TRACKS[3]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.lyricsStatus()).toBe('error');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('could not be read');
  });
});
