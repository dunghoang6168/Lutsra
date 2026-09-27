import { AfterViewChecked, Component, computed, effect, ElementRef, inject, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { PlayerService } from '../../core/player/player.service';
import { DurationPipe } from '../../shared/pipes/duration.pipe';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { SpectrumVisualizerComponent } from '../../shared/components/spectrum-visualizer/spectrum-visualizer.component';
import { RightPanelService } from '../../core/layout/right-panel.service';
import { LYRICS_GATEWAY } from '../../core/contracts';
import { LyricLine } from '../../core/models';
import { activeLyricIndex, parseLrc } from './lrc-parser';
import { ArtworkPalette, ArtworkPaletteService } from './artwork-palette.service';

@Component({
  selector: 'app-now-playing',
  standalone: true,
  imports: [CommonModule, RouterModule, DurationPipe, IconComponent, SpectrumVisualizerComponent],
  templateUrl: './now-playing.component.html',
  styleUrl: './now-playing.component.scss'
})
export class NowPlayingComponent implements AfterViewChecked, OnDestroy {
  readonly player = inject(PlayerService);
  readonly rightPanels = inject(RightPanelService);
  private readonly lyricsGateway = inject(LYRICS_GATEWAY);
  private readonly paletteService = inject(ArtworkPaletteService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly lyricsStatus = signal<'loading' | 'ready' | 'missing' | 'unsupported' | 'error'>('loading');
  readonly lyricLines = signal<LyricLine[]>([]);
  readonly activeLineIndex = computed(() => activeLyricIndex(this.lyricLines(), this.player.currentTime()));
  readonly artworkPalette = signal<ArtworkPalette | null>(null);
  private isTimelineScrubbing = false;
  private lyricsRequest = 0;
  private paletteRequest = 0;
  private lastTrackKey: string | null = null;
  private destroyed = false;
  private lastScrolledLine: number | null = null;
  private scrollFrame: number | null = null;

  private readonly trackEffect = effect(() => {
    const trackId = this.player.currentTrack()?.id ?? null;
    const queueEntry = this.player.currentQueueEntry();
    const trackKey = trackId ? `${trackId}:${queueEntry?.track.id === trackId ? queueEntry.id : ''}` : null;
    if (trackKey === this.lastTrackKey) return;
    this.lastTrackKey = trackKey;
    const request = ++this.lyricsRequest;
    this.lastScrolledLine = null;
    if (this.scrollFrame !== null) cancelAnimationFrame(this.scrollFrame);
    this.scrollFrame = null;
    this.lyricLines.set([]);
    if (!trackId) { this.lyricsStatus.set('missing'); return; }
    this.lyricsStatus.set('loading');
    void this.lyricsGateway.getLyrics(trackId).then((contents) => {
      if (this.destroyed || request !== this.lyricsRequest) return;
      if (contents === null) { this.lyricsStatus.set('missing'); return; }
      const lines = parseLrc(contents);
      this.lyricLines.set(lines);
      this.lyricsStatus.set(lines.length ? 'ready' : 'unsupported');
    }).catch(() => {
      if (!this.destroyed && request === this.lyricsRequest) this.lyricsStatus.set('error');
    });
  });

  private readonly paletteEffect = effect(() => {
    const artwork = this.player.currentTrack()?.artwork;
    const request = ++this.paletteRequest;
    this.artworkPalette.set(null);
    if (!artwork) return;
    void this.paletteService.getPalette(artwork).then((palette) => {
      if (!this.destroyed && request === this.paletteRequest) this.artworkPalette.set(palette);
    });
  });

  openTrackDetails(event: MouseEvent): void {
    this.rightPanels.openTrackDetails(event.currentTarget as HTMLElement);
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.lyricsRequest++;
    this.paletteRequest++;
    if (this.scrollFrame !== null) cancelAnimationFrame(this.scrollFrame);
    this.rightPanels.closeTrackDetails(false);
  }

  ngAfterViewChecked(): void {
    if (this.lyricsStatus() !== 'ready') return;
    const active = this.activeLineIndex();
    if (active === this.lastScrolledLine) return;
    this.lastScrolledLine = active;
    if (this.scrollFrame !== null) cancelAnimationFrame(this.scrollFrame);
    this.scrollFrame = requestAnimationFrame(() => {
      this.scrollFrame = null;
      const viewport = this.host.nativeElement.querySelector<HTMLElement>('.lyrics-lines');
      if (!viewport || this.destroyed) return;
      if (active < 0) { viewport.scrollTo({ top: 0, behavior: 'instant' }); return; }
      const line = viewport.querySelector<HTMLElement>(`[data-lyric-index="${active}"]`);
      if (!line) return;
      const top = viewport.scrollTop + line.getBoundingClientRect().top
        - viewport.getBoundingClientRect().top + line.offsetHeight / 2 - viewport.clientHeight / 2;
      const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
      viewport.scrollTo({ top: Math.max(0, top), behavior });
    });
  }

  seekToLyric(line: LyricLine): void { this.player.seek(line.time); }

  onTimelinePointerDown(event: PointerEvent): void {
    if (!this.canSeek()) return;
    this.isTimelineScrubbing = true;
    const target = event.currentTarget as HTMLElement;
    try { target.setPointerCapture(event.pointerId); } catch { /* Synthetic events may not own a pointer. */ }
    this.seekFromClientX(event.clientX, target);
    event.preventDefault();
  }

  onTimelinePointerMove(event: PointerEvent): void {
    if (!this.isTimelineScrubbing) return;
    this.seekFromClientX(event.clientX, event.currentTarget as HTMLElement);
  }

  onTimelinePointerUp(event: PointerEvent): void {
    if (!this.isTimelineScrubbing) return;
    this.seekFromClientX(event.clientX, event.currentTarget as HTMLElement);
    this.finishTimelineScrub(event);
  }

  onTimelinePointerCancel(event: PointerEvent): void {
    this.finishTimelineScrub(event);
  }

  onTimelineKeyDown(event: KeyboardEvent): void {
    if (!this.canSeek()) return;
    const duration = this.player.duration();
    let nextPosition: number | null = null;
    if (event.key === 'ArrowLeft') nextPosition = this.player.currentTime() - 5;
    else if (event.key === 'ArrowRight') nextPosition = this.player.currentTime() + 5;
    else if (event.key === 'Home') nextPosition = 0;
    else if (event.key === 'End') nextPosition = duration;
    if (nextPosition === null) return;
    event.preventDefault();
    this.player.seek(Math.max(0, Math.min(duration, nextPosition)));
  }

  private seekFromClientX(clientX: number, target: HTMLElement): void {
    const totalDuration = this.player.duration();
    const rect = target.getBoundingClientRect();
    if (rect.width <= 0 || totalDuration <= 0) return;
    const clickX = clientX - rect.left;
    const percent = Math.max(0, Math.min(1, clickX / rect.width));
    this.player.seek(percent * totalDuration);
  }

  private finishTimelineScrub(event: PointerEvent): void {
    this.isTimelineScrubbing = false;
    const target = event.currentTarget as HTMLElement;
    try {
      if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    } catch { /* Pointer capture may already be released. */ }
  }

  private canSeek(): boolean {
    return Boolean(this.player.currentTrack()) && this.player.duration() > 0;
  }

  formatFileSize(bytes: number | null): string {
    if (!bytes) return 'N/A';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  }
}
