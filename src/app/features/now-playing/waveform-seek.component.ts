import { AfterViewInit, ChangeDetectionStrategy, Component, effect, ElementRef, inject, input, NgZone, OnDestroy, signal, ViewChild } from '@angular/core';
import { PlayerService } from '../../core/player/player.service';
import { Track } from '../../core/models';
import { aggregateWaveformLevels } from '../../core/media/waveform-aggregation';
import { WaveformPeaksService, WaveformPreview } from '../../core/media/waveform-peaks.service';
import { ThemeService } from '../../core/theme/theme.service';
import { DurationPipe } from '../../shared/pipes/duration.pipe';

const PADDING = 12;
const BAR_WIDTH = 4;
const BAR_GAP = 2;
const SEEK_INTERVAL_MS = 100;
const MAX_INTERPOLATION_SECONDS = 1.25;

@Component({
  selector: 'app-waveform-seek',
  standalone: true,
  imports: [DurationPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './waveform-seek.component.html',
  styleUrl: './waveform-seek.component.scss',
})
export class WaveformSeekComponent implements AfterViewInit, OnDestroy {
  readonly track = input.required<Track>();
  readonly player = inject(PlayerService);
  private readonly peaksService = inject(WaveformPeaksService);
  private readonly theme = inject(ThemeService);
  private readonly zone = inject(NgZone);
  private readonly host = inject(ElementRef<HTMLElement>);
  @ViewChild('futureCanvas', { static: true }) private readonly futureCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('playedCanvas', { static: true }) private readonly playedCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('playedLayer', { static: true }) private readonly playedLayer!: ElementRef<HTMLElement>;
  @ViewChild('previewFutureCanvas', { static: true }) private readonly previewFutureCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('previewPlayedCanvas', { static: true }) private readonly previewPlayedCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('previewPlayedLayer', { static: true }) private readonly previewPlayedLayer!: ElementRef<HTMLElement>;
  @ViewChild('cursor', { static: true }) private readonly cursor!: ElementRef<HTMLElement>;
  readonly state = signal<'loading' | 'partial' | 'ready' | 'fallback'>('loading');
  readonly displayTime = signal(0);
  readonly analysisPercent = signal(0);
  readonly hasPreview = signal(false);
  private peaks: Float32Array | null = null;
  private previewPeaks: Float32Array | null = null;
  private previewCoverage = 0;
  private controller: AbortController | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private viewReady = false;
  private destroyed = false;
  private request = 0;
  private loadedKey: string | null = null;
  private activePointerId: number | null = null;
  private previewTime: number | null = null;
  private lastSeekAt = Number.NEGATIVE_INFINITY;
  private anchorTime = 0;
  private anchorClock = 0;
  private frameId: number | null = null;
  private staticFrameId: number | null = null;
  private plotWidth = 1;
  private surfaceWidth = 1;
  private lastDisplaySecond = 0;

  private readonly trackEffect = effect(() => {
    const track = this.track();
    if (this.viewReady) this.load(track);
  });

  private readonly staticEffect = effect(() => {
    this.theme.effectiveTheme();
    this.theme.themePreset();
    this.theme.accentColor();
    if (this.viewReady) this.scheduleStaticRender();
  });

  private readonly playbackEffect = effect(() => {
    const currentTime = this.player.currentTime();
    this.player.duration();
    const playing = this.player.isPlaying();
    const ready = this.state() === 'ready' || this.state() === 'partial';
    if (!this.viewReady || this.activePointerId !== null) return;
    this.anchorTime = currentTime;
    this.anchorClock = performance.now();
    this.updateProgress(currentTime);
    if (playing && ready) this.startAnimation();
    else this.stopAnimation();
  });

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.anchorTime = this.player.currentTime();
    this.anchorClock = performance.now();
    this.resizeCanvas();
    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(() => this.resizeCanvas());
      this.resizeObserver.observe(this.futureCanvas.nativeElement);
    }
    this.load(this.track());
    this.updateProgress(this.anchorTime);
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.request++;
    this.controller?.abort();
    this.resizeObserver?.disconnect();
    this.stopAnimation();
    if (this.staticFrameId !== null) cancelAnimationFrame(this.staticFrameId);
  }

  onPointerDown(event: PointerEvent): void {
    if (!this.canSeek() || this.activePointerId !== null) return;
    this.activePointerId = event.pointerId;
    this.stopAnimation();
    const target = event.currentTarget as HTMLElement;
    try { target.setPointerCapture(event.pointerId); } catch { /* Synthetic pointers may not own capture. */ }
    this.previewFromPointer(event, target, true);
    event.preventDefault();
  }

  onPointerMove(event: PointerEvent): void {
    if (this.activePointerId === event.pointerId) this.previewFromPointer(event, event.currentTarget as HTMLElement, false);
  }

  onPointerUp(event: PointerEvent): void {
    if (this.activePointerId !== event.pointerId) return;
    this.previewFromPointer(event, event.currentTarget as HTMLElement, true);
    this.finishScrub(event);
  }

  onPointerCancel(event: PointerEvent): void {
    if (this.activePointerId !== event.pointerId) return;
    if (this.previewTime !== null) this.player.seek(this.previewTime);
    this.finishScrub(event);
  }

  onKeyDown(event: KeyboardEvent): void {
    if (!this.canSeek()) return;
    const duration = this.player.duration();
    let next: number | null = null;
    if (event.key === 'ArrowLeft') next = this.player.currentTime() - 5;
    else if (event.key === 'ArrowRight') next = this.player.currentTime() + 5;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = duration;
    if (next === null) return;
    event.preventDefault();
    this.seek(Math.max(0, Math.min(duration, next)));
  }

  private async load(track: Track): Promise<void> {
    const key = `${track.id}:${track.fileSize ?? ''}:${track.lastModified ?? ''}`;
    if (key === this.loadedKey) return;
    this.loadedKey = key;
    this.controller?.abort();
    this.controller = new AbortController();
    const request = ++this.request;
    this.activePointerId = null;
    this.previewTime = null;
    this.stopAnimation();
    this.peaks = null;
    this.previewPeaks = null;
    this.previewCoverage = 0;
    this.hasPreview.set(false);
    this.analysisPercent.set(0);
    this.state.set('loading');
    for (const canvas of this.canvases()) {
      const context = canvas.getContext('2d');
      context?.setTransform(1, 0, 0, 1, 0, 0);
      context?.clearRect(0, 0, canvas.width, canvas.height);
    }
    try {
      const peaks = await this.peaksService.getPeaks(track, this.controller.signal, (preview) => {
        if (this.destroyed || request !== this.request || this.controller?.signal.aborted) return;
        this.showPreview(preview);
      });
      if (this.destroyed || request !== this.request) return;
      this.peaks = peaks;
      this.state.set('ready');
      this.renderStatic();
      this.anchorTime = this.player.currentTime();
      this.anchorClock = performance.now();
      this.updateProgress(this.anchorTime);
      if (this.player.isPlaying()) this.startAnimation();
    } catch (error) {
      if (this.destroyed || request !== this.request) return;
      console.warn('[waveform] Analysis failed', {
        trackId: track.id,
        reason: error instanceof Error ? error.message : String(error),
      });
      this.state.set('fallback');
    }
  }

  private showPreview(preview: WaveformPreview): void {
    this.previewPeaks = preview.peaks;
    this.previewCoverage = preview.coverage;
    this.analysisPercent.set(Math.min(99, Math.floor(preview.coverage * 100)));
    this.hasPreview.set(true);
    this.state.set('partial');
    this.renderPreview();
    this.anchorTime = this.player.currentTime();
    this.anchorClock = performance.now();
    this.updateProgress(this.anchorTime);
    if (this.player.isPlaying()) this.startAnimation();
  }

  private canvases(): HTMLCanvasElement[] {
    return [this.futureCanvas.nativeElement, this.playedCanvas.nativeElement,
      this.previewFutureCanvas.nativeElement, this.previewPlayedCanvas.nativeElement];
  }

  private resizeCanvas(): void {
    const rect = this.futureCanvas.nativeElement.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    for (const canvas of this.canvases()) {
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
    }
    this.surfaceWidth = rect.width;
    this.plotWidth = Math.max(1, rect.width - PADDING * 2);
    this.renderStatic();
    this.renderPreview();
    this.updateProgress(this.previewTime ?? this.currentPosition());
  }

  private renderStatic(): void {
    if (!this.peaks || this.state() !== 'ready') return;
    this.drawLayers(this.peaks, this.futureCanvas.nativeElement, this.playedCanvas.nativeElement, 1);
  }

  private renderPreview(): void {
    if (!this.previewPeaks) return;
    this.drawLayers(this.previewPeaks, this.previewFutureCanvas.nativeElement,
      this.previewPlayedCanvas.nativeElement, this.previewCoverage);
  }

  private drawLayers(peaks: Float32Array, future: HTMLCanvasElement, played: HTMLCanvasElement, coverage: number): void {
    const canvas = future;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.width / ratio;
    const height = canvas.height / ratio;
    const styles = getComputedStyle(this.host.nativeElement);
    const count = Math.max(1, Math.floor((this.plotWidth + BAR_GAP) / (BAR_WIDTH + BAR_GAP)));
    const levels = aggregateWaveformLevels(peaks, count);
    const barWidth = Math.max(2, (this.plotWidth - (count - 1) * BAR_GAP) / count);
    const center = (height - 25) / 2;
    const maximumHeight = Math.max(8, height - 52);
    const accentColor = styles.getPropertyValue('--accent-primary').trim() || '#8b5cf6';
    const playedColor = darkenAccent(accentColor);
    [future, played].forEach((layer, layerIndex) => {
      const context = layer.getContext('2d');
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      context.fillStyle = layerIndex === 0 ? accentColor : playedColor;
      context.globalAlpha = layerIndex === 0 ? 0.94 : 1;
      for (let index = 0; index < Math.min(count, Math.floor(count * coverage)); index++) {
        const barHeight = Math.max(2, levels[index] * maximumHeight);
        const x = PADDING + index * (barWidth + BAR_GAP);
        context.beginPath();
        context.roundRect(x, center - barHeight / 2, barWidth, barHeight, Math.min(barWidth / 2, 4));
        context.fill();
      }
      context.globalAlpha = 1;
    });
  }

  private scheduleStaticRender(): void {
    if (this.staticFrameId !== null) return;
    this.zone.runOutsideAngular(() => {
      this.staticFrameId = requestAnimationFrame(() => {
        this.staticFrameId = null;
        if (!this.destroyed) {
          this.renderStatic();
          this.renderPreview();
        }
      });
    });
  }

  private startAnimation(): void {
    if (this.frameId !== null || this.destroyed || this.activePointerId !== null) return;
    this.zone.runOutsideAngular(() => {
      const frame = () => {
        this.frameId = null;
        if (this.destroyed || this.activePointerId !== null || !this.player.isPlaying()
          || (this.state() !== 'ready' && this.state() !== 'partial')) return;
        this.updateProgress(this.currentPosition());
        this.frameId = requestAnimationFrame(frame);
      };
      this.frameId = requestAnimationFrame(frame);
    });
  }

  private stopAnimation(): void {
    if (this.frameId === null) return;
    cancelAnimationFrame(this.frameId);
    this.frameId = null;
  }

  private currentPosition(): number {
    const elapsed = this.player.isPlaying()
      ? Math.min(MAX_INTERPOLATION_SECONDS, Math.max(0, (performance.now() - this.anchorClock) / 1000)) : 0;
    return this.anchorTime + elapsed;
  }

  private updateProgress(time: number): void {
    if (!this.viewReady) return;
    const duration = this.player.duration();
    const bounded = Math.max(0, Math.min(duration || 0, time));
    const second = Math.floor(bounded);
    if (this.lastDisplaySecond !== second) {
      this.lastDisplaySecond = second;
      this.displayTime.set(second);
    }
    const progress = duration > 0 ? bounded / duration : 0;
    const cursorX = PADDING + progress * this.plotWidth;
    this.playedLayer.nativeElement.style.clipPath = `inset(0 ${Math.max(0, this.surfaceWidth - cursorX)}px 0 0)`;
    this.previewPlayedLayer.nativeElement.style.clipPath = this.playedLayer.nativeElement.style.clipPath;
    this.cursor.nativeElement.style.transform = `translate3d(${progress * this.plotWidth}px, 0, 0)`;
  }

  private previewFromPointer(event: PointerEvent, target: HTMLElement, forceSeek: boolean): void {
    const rect = target.getBoundingClientRect();
    if (rect.width <= 0) return;
    const padding = this.state() === 'ready' || this.state() === 'partial' ? PADDING : 0;
    const width = Math.max(1, rect.width - padding * 2);
    const progress = Math.max(0, Math.min(1, (event.clientX - rect.left - padding) / width));
    const time = progress * this.player.duration();
    this.previewTime = time;
    this.updateProgress(time);
    const now = performance.now();
    if (forceSeek || now - this.lastSeekAt >= SEEK_INTERVAL_MS) {
      this.player.seek(time);
      this.lastSeekAt = now;
    }
  }

  private finishScrub(event: PointerEvent): void {
    this.anchorTime = this.previewTime ?? this.player.currentTime();
    this.anchorClock = performance.now();
    this.activePointerId = null;
    this.previewTime = null;
    const target = event.currentTarget as HTMLElement;
    try {
      if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    } catch { /* Capture may already have been released. */ }
    if (this.player.isPlaying() && (this.state() === 'ready' || this.state() === 'partial')) this.startAnimation();
  }

  private seek(time: number): void {
    this.anchorTime = time;
    this.anchorClock = performance.now();
    this.updateProgress(time);
    this.player.seek(time);
  }

  private canSeek(): boolean { return this.player.duration() > 0; }
}

function darkenAccent(color: string): string {
  const match = /^#([\da-f]{6})$/i.exec(color);
  if (!match) return color;
  return `#${[0, 2, 4].map((offset) => Math.round(parseInt(match[1].slice(offset, offset + 2), 16) * 0.5)
    .toString(16).padStart(2, '0')).join('')}`;
}
