import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AUDIO_ANALYSIS_ENGINE, LYRICS_GATEWAY, LyricsGateway, PLAYBACK_ENGINE, SETTINGS_GATEWAY } from '../../core/contracts';
import { RightPanelService } from '../../core/layout/right-panel.service';
import { LayoutPreferenceService } from '../../core/layout/layout-preference.service';
import { AudioVisualizationPreferenceService } from '../../core/layout/audio-visualization-preference.service';
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
    localStorage.removeItem('lutsra.audio.visualization');
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
    localStorage.removeItem('lutsra.audio.visualization');
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
    expect((fixture.nativeElement as HTMLElement).querySelector('.panel-volume-control')).not.toBeNull();

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

  it('combines waveform seeking and playback controls in one card', async () => {
    await TestBed.inject(AudioVisualizationPreferenceService).setMode('waveform');
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const card = host.querySelector<HTMLElement>('.visualization-controls.waveform-mode');
    expect(card).not.toBeNull();
    expect(card?.querySelector('app-waveform-seek')).not.toBeNull();
    expect(card?.querySelector('.transport-buttons')).not.toBeNull();
    expect(card?.querySelector('.timeline-group')).toBeNull();
    expect(host.querySelector('app-spectrum-visualizer')).toBeNull();
  });

  it('cycles one Panel button through Off, Shuffle, Repeat All, and Repeat One', () => {
    const host = fixture.nativeElement as HTMLElement;
    const button = host.querySelector<HTMLButtonElement>('.playback-mode-button')!;
    expect(host.querySelectorAll('.transport-buttons button').length).toBe(5);
    expect(button.getAttribute('aria-label')).toContain('Playback mode: Off');
    expect(button.classList).not.toContain('active');

    const states = [
      { shuffle: true, repeat: 'off', label: 'Shuffle' },
      { shuffle: false, repeat: 'all', label: 'Repeat All' },
      { shuffle: false, repeat: 'one', label: 'Repeat One' },
      { shuffle: false, repeat: 'off', label: 'Off' },
    ] as const;
    for (const state of states) {
      button.click();
      fixture.detectChanges();
      expect(player.isShuffle()).toBe(state.shuffle);
      expect(player.repeatMode()).toBe(state.repeat);
      expect(button.getAttribute('aria-label')).toContain(`Playback mode: ${state.label}`);
      expect(button.classList.contains('active')).toBe(state.label !== 'Off');
    }
  });

  it('reflects changes from other controls and clears a combined mode on the next click', () => {
    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.playback-mode-button')!;
    player.setRepeatMode('all');
    fixture.detectChanges();
    expect(button.getAttribute('aria-label')).toContain('Repeat All');
    player.setShuffle(true);
    fixture.detectChanges();
    expect(button.getAttribute('aria-label')).toContain('Shuffle and Repeat All');
    expect(button.querySelectorAll('app-icon').length).toBe(2);

    button.click();
    fixture.detectChanges();
    expect(player.isShuffle()).toBeFalse();
    expect(player.repeatMode()).toBe('off');
    expect(button.getAttribute('aria-label')).toContain('Playback mode: Off');
    button.click();
    fixture.detectChanges();
    expect(player.isShuffle()).toBeTrue();
    expect(player.repeatMode()).toBe('off');

    player.setRepeatMode('one');
    fixture.detectChanges();
    expect(button.getAttribute('aria-label')).toContain('Shuffle and Repeat One');
  });

  it('keeps Classic Shuffle and Repeat as separate controls', async () => {
    await TestBed.inject(LayoutPreferenceService).setMode('classic');
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.playback-mode-button')).toBeNull();
    expect(host.querySelector('.panel-volume-control')).toBeNull();
    expect(host.querySelectorAll('.transport-buttons button').length).toBe(5);
    host.querySelector<HTMLButtonElement>('[aria-label="Toggle Shuffle"]')!.click();
    host.querySelector<HTMLButtonElement>('[aria-label="Toggle Repeat Mode"]')!.click();
    expect(player.isShuffle()).toBeTrue();
    expect(player.repeatMode()).toBe('all');
  });

  it('keeps the Panel transport trio centered while volume opens at wide and narrow widths', () => {
    const host = fixture.nativeElement as HTMLElement;
    const container = document.createElement('div');
    container.style.cssText = 'width: 1000px; height: 800px; container-type: inline-size; container-name: main-content;';
    host.style.cssText = 'display: block; height: 100%;';
    document.body.appendChild(container);
    container.appendChild(host);
    try {
      const controls = host.querySelector<HTMLElement>('.inline-controls')!;
      const row = host.querySelector<HTMLElement>('.transport-buttons')!;
      const core = row.querySelector<HTMLElement>('.transport-core')!;
      const mode = row.querySelector<HTMLElement>('.playback-mode-button')!;
      const previous = row.querySelector<HTMLElement>('[aria-label="Previous Track"]')!;
      const volumeButton = row.querySelector<HTMLButtonElement>('[aria-label="Adjust volume"]')!;
      const reveal = row.querySelector<HTMLElement>('.volume-reveal')!;
      const slider = row.querySelector<HTMLInputElement>('.volume-slider')!;
      const tooltip = row.querySelector<HTMLElement>('.volume-tooltip')!;
      reveal.style.transition = 'none';
      for (const width of [1000, 520, 280]) {
        container.style.width = `${width}px`;
        for (const open of [false, true]) {
          if (volumeButton.getAttribute('aria-expanded') !== String(open)) {
            volumeButton.click();
            fixture.detectChanges();
          }
          const rowRect = row.getBoundingClientRect();
          const coreRect = core.getBoundingClientRect();
          expect(Math.abs((coreRect.left + coreRect.right) / 2 - (rowRect.left + rowRect.right) / 2)).toBeLessThan(1);
          expect(mode.getBoundingClientRect().right).toBeLessThanOrEqual(previous.getBoundingClientRect().left);
          expect(rowRect.right).toBeLessThanOrEqual(controls.getBoundingClientRect().right);
          expect(controls.scrollWidth).toBeLessThanOrEqual(controls.clientWidth);
          expect(slider.disabled).toBe(!open);
          if (open) {
            expect(getComputedStyle(slider).writingMode).toBe(width === 280 ? 'vertical-lr' : 'horizontal-tb');
            const sliderRect = slider.getBoundingClientRect();
            const tooltipRect = tooltip.getBoundingClientRect();
            if (width === 280) {
              expect(tooltipRect.right).toBeLessThanOrEqual(sliderRect.left);
            } else {
              expect(tooltipRect.left).toBeGreaterThanOrEqual(sliderRect.right);
              expect(tooltipRect.right).toBeLessThanOrEqual(controls.getBoundingClientRect().right);
            }
          }
        }
      }
    } finally {
      container.remove();
    }
  });

  it('opens and closes the volume slider without changing volume, including outside clicks and Escape', () => {
    const host = fixture.nativeElement as HTMLElement;
    const button = host.querySelector<HTMLButtonElement>('[aria-label="Adjust volume"]')!;
    const slider = host.querySelector<HTMLInputElement>('.volume-slider')!;
    const tooltip = host.querySelector<HTMLElement>('.volume-tooltip')!;
    expect(tooltip.textContent?.trim()).toBe(`${Math.round(player.volume() * 100)}%`);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(slider.disabled).toBeTrue();
    expect(slider.tabIndex).toBe(-1);
    const initialVolume = player.volume();

    button.click();
    fixture.detectChanges();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(slider.disabled).toBeFalse();
    expect(slider.tabIndex).toBe(0);
    expect(getComputedStyle(tooltip).visibility).toBe('hidden');
    expect(player.volume()).toBe(initialVolume);

    button.click();
    fixture.detectChanges();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    button.click();
    fixture.detectChanges();

    slider.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    fixture.detectChanges();
    expect(getComputedStyle(tooltip).visibility).toBe('visible');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    fixture.detectChanges();
    expect(getComputedStyle(tooltip).visibility).toBe('hidden');
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    fixture.detectChanges();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(slider.disabled).toBeTrue();
    expect(getComputedStyle(tooltip).visibility).toBe('hidden');

    button.click();
    fixture.detectChanges();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('shares volume with the player and shows a crossed speaker at zero or while muted', () => {
    const host = fixture.nativeElement as HTMLElement;
    const button = host.querySelector<HTMLButtonElement>('[aria-label="Adjust volume"]')!;
    const slider = host.querySelector<HTMLInputElement>('.volume-slider')!;
    const tooltip = host.querySelector<HTMLElement>('.volume-tooltip')!;
    button.click();
    fixture.detectChanges();

    slider.value = '0';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    expect(player.volume()).toBe(0);
    expect(tooltip.textContent?.trim()).toBe('0%');
    expect(host.querySelector<HTMLElement>('.volume-reveal')!.style.getPropertyValue('--volume-position')).toBe('0%');
    expect(button.querySelector('line[x1="23"][x2="17"]')).not.toBeNull();

    player.setVolume(0.64);
    fixture.detectChanges();
    expect(slider.value).toBe('64');
    expect(tooltip.textContent?.trim()).toBe('64%');
    expect(host.querySelector<HTMLElement>('.volume-reveal')!.style.getPropertyValue('--volume-position')).toBe('64%');
    expect(button.querySelector('line[x1="23"][x2="17"]')).toBeNull();

    player.setVolume(1);
    fixture.detectChanges();
    expect(slider.value).toBe('100');
    expect(tooltip.textContent?.trim()).toBe('100%');
    expect(host.querySelector<HTMLElement>('.volume-reveal')!.style.getPropertyValue('--volume-position')).toBe('100%');

    player.toggleMute();
    fixture.detectChanges();
    expect(tooltip.textContent?.trim()).toBe('100%');
    expect(button.querySelector('line[x1="23"][x2="17"]')).not.toBeNull();
  });

  it('fills the complete track at 100% and none of it at 0% in both orientations', () => {
    const host = fixture.nativeElement as HTMLElement;
    const container = document.createElement('div');
    container.style.cssText = 'width: 520px; height: 800px; container-type: inline-size; container-name: main-content;';
    host.style.cssText = 'display: block; height: 100%;';
    document.body.appendChild(container);
    container.appendChild(host);
    try {
      host.querySelector<HTMLButtonElement>('[aria-label="Adjust volume"]')!.click();
      fixture.detectChanges();
      const track = host.querySelector<HTMLElement>('.volume-track')!;
      const fill = host.querySelector<HTMLElement>('.volume-track-fill')!;
      for (const width of [520, 280]) {
        container.style.width = `${width}px`;
        player.setVolume(0);
        fixture.detectChanges();
        expect(width === 520 ? fill.getBoundingClientRect().width : fill.getBoundingClientRect().height).toBe(0);
        player.setVolume(1);
        fixture.detectChanges();
        expect(width === 520 ? fill.getBoundingClientRect().width : fill.getBoundingClientRect().height)
          .toBeCloseTo(width === 520 ? track.getBoundingClientRect().width : track.getBoundingClientRect().height, 1);
      }
    } finally {
      container.remove();
    }
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
