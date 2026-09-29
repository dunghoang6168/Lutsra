import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { WaveformPeaksService } from '../../core/media/waveform-peaks.service';
import { MOCK_TRACKS } from '../../core/mock/fixtures/mock-data';
import { PlayerService } from '../../core/player/player.service';
import { ThemeService } from '../../core/theme/theme.service';
import { WaveformSeekComponent } from './waveform-seek.component';

describe('WaveformSeekComponent', () => {
  const currentTime = signal(0);
  const duration = signal(120);
  const isPlaying = signal(false);
  const themePreset = signal('dark');
  const accentColor = signal('violet');
  let seek: jasmine.Spy;
  let getPeaks: jasmine.Spy;

  beforeEach(async () => {
    currentTime.set(0);
    duration.set(120);
    isPlaying.set(false);
    themePreset.set('dark');
    accentColor.set('violet');
    seek = jasmine.createSpy('seek');
    getPeaks = jasmine.createSpy('getPeaks').and.resolveTo(new Float32Array(1024).fill(0.5));
    await TestBed.configureTestingModule({
      imports: [WaveformSeekComponent],
      providers: [
        { provide: PlayerService, useValue: { currentTime, duration, isPlaying, progressPercent: computed(() => currentTime() / duration() * 100), seek } },
        { provide: ThemeService, useValue: { themePreset, accentColor } },
        { provide: WaveformPeaksService, useValue: { getPeaks } },
      ],
    }).compileComponents();
  });

  it('seeks by pointer and keyboard using whole-track time', async () => {
    const fixture = TestBed.createComponent(WaveformSeekComponent);
    fixture.componentRef.setInput('track', MOCK_TRACKS[0]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const surface = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.seek-surface')!;
    spyOn(surface, 'getBoundingClientRect').and.returnValue({ left: 0, width: 200 } as DOMRect);
    fixture.componentInstance.onPointerDown({ clientX: 100, currentTarget: surface, pointerId: 1, preventDefault() {} } as unknown as PointerEvent);
    expect(seek).toHaveBeenCalledWith(60);

    currentTime.set(60);
    fixture.componentInstance.onKeyDown({ key: 'ArrowRight', preventDefault() {} } as KeyboardEvent);
    expect(seek).toHaveBeenCalledWith(65);
    fixture.destroy();
  });

  it('uses a regular seek bar when waveform decoding fails', async () => {
    getPeaks.and.rejectWith(new Error('Unsupported codec'));
    const fixture = TestBed.createComponent(WaveformSeekComponent);
    fixture.componentRef.setInput('track', MOCK_TRACKS[0]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.waveform-area.fallback')).not.toBeNull();
    expect(host.querySelector('.fallback-track')).not.toBeNull();
    expect(host.querySelector<HTMLElement>('[role="slider"]')?.getAttribute('aria-valuemax')).toBe('120');
    fixture.destroy();
  });

  it('keeps the waveform canvases unchanged while progress moves and stops its frame loop on pause', async () => {
    const fixture = TestBed.createComponent(WaveformSeekComponent);
    fixture.componentRef.setInput('track', MOCK_TRACKS[0]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const canvases = host.querySelectorAll<HTMLCanvasElement>('canvas');
    expect(canvases.length).toBe(4);
    const draw = spyOn(canvases[0].getContext('2d')!, 'roundRect').and.callThrough();
    const frames: FrameRequestCallback[] = [];
    spyOn(window, 'requestAnimationFrame').and.callFake((callback) => { frames.push(callback); return frames.length; });
    const cancel = spyOn(window, 'cancelAnimationFrame').and.stub();
    const clock = spyOn(performance, 'now').and.returnValue(1000);
    currentTime.set(10);
    isPlaying.set(true);
    fixture.detectChanges();
    expect(frames.length).toBeGreaterThan(0);
    clock.and.returnValue(1250);
    frames[frames.length - 1](1250);
    expect(draw).not.toHaveBeenCalled();
    expect(host.querySelector<HTMLElement>('.waveform-cursor')!.style.transform).toContain('translate3d(');
    isPlaying.set(false);
    fixture.detectChanges();
    expect(cancel).toHaveBeenCalled();
    fixture.destroy();
  });

  it('shows progressive FLAC data and fades to the final waveform without showing a stale preview', async () => {
    let resolvePeaks!: (peaks: Float32Array) => void;
    getPeaks.and.callFake((_track: unknown, _signal: AbortSignal, onProgress: (preview: { peaks: Float32Array; coverage: number }) => void) => {
      onProgress({ peaks: new Float32Array(1024).fill(0.4), coverage: 0.25 });
      return new Promise<Float32Array>((resolve) => { resolvePeaks = resolve; });
    });
    const fixture = TestBed.createComponent(WaveformSeekComponent);
    (fixture.nativeElement as HTMLElement).style.setProperty('--accent-primary', '#f43f5e');
    fixture.componentRef.setInput('track', MOCK_TRACKS[0]);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.waveform-area.partial')).not.toBeNull();
    expect(host.querySelector('.waveform-analysis')?.textContent).toContain('25%');
    expect(host.querySelector('.preview-overlay')).not.toBeNull();
    const canvases = host.querySelectorAll<HTMLCanvasElement>('canvas');
    expect(canvases[2].getContext('2d')!.fillStyle).toBe('#f43f5e');
    expect(canvases[3].getContext('2d')!.fillStyle).toBe('#7a202f');
    resolvePeaks(new Float32Array(1024).fill(0.6));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(host.querySelector('.waveform-area.preview-complete')).not.toBeNull();
    expect(host.querySelector('.waveform-analysis')).toBeNull();
    fixture.destroy();
  });

  it('previews fast dragging while limiting audio seeks and commits the final position', async () => {
    const fixture = TestBed.createComponent(WaveformSeekComponent);
    fixture.componentRef.setInput('track', MOCK_TRACKS[0]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const surface = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.seek-surface')!;
    spyOn(surface, 'getBoundingClientRect').and.returnValue({ left: 0, width: 200 } as DOMRect);
    const clock = spyOn(performance, 'now').and.returnValue(1000);
    const pointer = (clientX: number) => ({ clientX, currentTarget: surface, pointerId: 7, preventDefault() {} } as unknown as PointerEvent);
    fixture.componentInstance.onPointerDown(pointer(12));
    clock.and.returnValue(1030);
    fixture.componentInstance.onPointerMove(pointer(100));
    fixture.componentInstance.onPointerMove(pointer(150));
    expect(seek.calls.count()).toBe(1);
    expect(fixture.componentInstance.displayTime()).toBe(94);
    clock.and.returnValue(1050);
    fixture.componentInstance.onPointerUp(pointer(188));
    expect(seek.calls.count()).toBe(2);
    expect(seek).toHaveBeenCalledWith(120);
    fixture.destroy();
  });

  it('darkens played waveform columns by 50% and uses theme text color for the cursor', async () => {
    const fixture = TestBed.createComponent(WaveformSeekComponent);
    fixture.componentRef.setInput('track', MOCK_TRACKS[0]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const [future, played] = Array.from(host.querySelectorAll<HTMLCanvasElement>('canvas'));
    const futureContext = future.getContext('2d')!;
    const playedContext = played.getContext('2d')!;
    const futureAlphas: number[] = [];
    const playedAlphas: number[] = [];
    spyOn(futureContext, 'fill').and.callFake(() => futureAlphas.push(futureContext.globalAlpha));
    spyOn(playedContext, 'fill').and.callFake(() => playedAlphas.push(playedContext.globalAlpha));

    host.style.setProperty('--accent-primary', '#123456');
    host.style.setProperty('--text-primary', '#f3f4f6');
    host.style.setProperty('--bg-surface', '#1c1e22');
    accentColor.set('blue');
    fixture.detectChanges();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(futureContext.fillStyle).toBe('#123456');
    expect(playedContext.fillStyle).toBe('#091a2b');
    expect(futureAlphas).toContain(0.94);
    expect(playedAlphas).toContain(1);
    const cursor = host.querySelector<HTMLElement>('.waveform-cursor')!;
    expect(getComputedStyle(cursor).backgroundColor).toBe('rgb(243, 244, 246)');

    host.style.setProperty('--accent-primary', '#abcdef');
    host.style.setProperty('--text-primary', '#0f172a');
    host.style.setProperty('--bg-surface', '#ffffff');
    themePreset.set('light');
    fixture.detectChanges();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(futureContext.fillStyle).toBe('#abcdef');
    expect(playedContext.fillStyle).toBe('#566778');
    expect(getComputedStyle(cursor).backgroundColor).toBe('rgb(15, 23, 42)');
    expect(getComputedStyle(cursor).boxShadow).toContain('rgb(255, 255, 255)');
    fixture.destroy();
  });

  it('uses every accent token in both light and dark themes', async () => {
    const root = document.documentElement;
    const originalTheme = root.getAttribute('data-theme');
    const originalAccent = root.getAttribute('data-accent');
    const fixture = TestBed.createComponent(WaveformSeekComponent);
    fixture.componentRef.setInput('track', MOCK_TRACKS[0]);
    fixture.detectChanges();
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const canvases = host.querySelectorAll<HTMLCanvasElement>('canvas');
    try {
      for (const theme of ['dark', 'light']) {
        for (const accent of ['violet', 'blue', 'cyan', 'emerald', 'amber', 'rose']) {
          root.setAttribute('data-theme', theme);
          root.setAttribute('data-accent', accent);
          themePreset.set(theme);
          accentColor.set(accent);
          fixture.detectChanges();
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          const expected = getComputedStyle(host).getPropertyValue('--accent-primary').trim().toLowerCase();
          expect(canvases[0].getContext('2d')!.fillStyle).withContext(`${theme}/${accent} future`).toBe(expected);
          const darkened = `#${[1, 3, 5].map((offset) => Math.round(parseInt(expected.slice(offset, offset + 2), 16) / 2)
            .toString(16).padStart(2, '0')).join('')}`;
          expect(canvases[1].getContext('2d')!.fillStyle).withContext(`${theme}/${accent} played`).toBe(darkened);
          expect(getComputedStyle(host.querySelector<HTMLElement>('.waveform-cursor')!).backgroundColor)
            .withContext(`${theme}/${accent} cursor`).toBe(theme === 'dark' ? 'rgb(243, 244, 246)' : 'rgb(15, 23, 42)');
        }
      }
    } finally {
      fixture.destroy();
      if (originalTheme === null) root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', originalTheme);
      if (originalAccent === null) root.removeAttribute('data-accent');
      else root.setAttribute('data-accent', originalAccent);
    }
  });
});
