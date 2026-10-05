import { Component, DestroyRef, ElementRef, afterNextRender, afterRenderEffect, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterModule } from '@angular/router';
import { nextQueueEntries } from '../../utils/list-media';
import { formatTrackFormat } from '../../../features/home/library-quality';
import { PlayerService } from '../../../core/player/player.service';
import { DurationPipe } from '../../pipes/duration.pipe';
import { IconComponent } from '../icon/icon.component';
import { RangeSliderComponent } from '../range-slider/range-slider.component';
import { SignalPathComponent } from '../signal-path/signal-path.component';

export type PlayerVariant = 'strip' | 'rail' | 'pill';

@Component({
  selector: 'app-player-bar',
  standalone: true,
  imports: [NgTemplateOutlet, RouterModule, DurationPipe, IconComponent, RangeSliderComponent, SignalPathComponent],
  templateUrl: './player-bar.component.html',
  styleUrl: './player-bar.component.scss'
})
export class PlayerBarComponent {
  readonly player = inject(PlayerService);
  readonly variant = input<PlayerVariant>('strip');
  readonly isQueueOpen = input<boolean>(false);
  readonly toggleQueue = output<void>();
  readonly isVolumeAdjusting = signal(false);
  readonly volumePercent = computed(() => Math.round(this.player.volume() * 100));
  readonly volumePosition = computed(() => `${this.volumePercent()}%`);
  readonly volumeTooltip = computed(() => this.player.isMuted()
    ? `Muted · ${this.volumePercent()}%`
    : `${this.volumePercent()}%`);
  readonly volumeAriaText = computed(() => this.player.isMuted()
    ? `Muted, volume ${this.volumePercent()} percent`
    : `${this.volumePercent()} percent`);

  readonly timelineValueText = computed(() =>
    `${formatClock(this.player.currentTime())} of ${formatClock(this.player.duration())}`);

  readonly formatTrackFormat = formatTrackFormat;
  readonly upNext = computed(() => nextQueueEntries(this.player.queue(), this.player.currentIndex()));
  readonly upNextEnabled = signal(false);
  readonly upNextRowCount = signal(0);
  readonly upNextHeaderFits = signal(false);
  readonly visibleUpNext = computed(() => this.upNext().slice(0, this.upNextRowCount()));
  private readonly upNextSlot = viewChild<ElementRef<HTMLElement>>('upNextSlot');
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    afterNextRender(() => {
      const media = window.matchMedia('(min-width: 1101px) and (min-height: 701px)');
      const update = () => this.upNextEnabled.set(media.matches);
      update();
      media.addEventListener('change', update);
      this.destroyRef.onDestroy(() => media.removeEventListener('change', update));
    });
    afterRenderEffect((onCleanup) => {
      const slot = this.upNextSlot()?.nativeElement;
      if (!slot) return;
      const update = () => {
        const header = slot.querySelector<HTMLElement>('.up-next-header');
        const measure = slot.querySelector<HTMLElement>('.up-next-measure');
        const list = slot.querySelector<HTMLElement>('.up-next-list');
        if (!header || !measure || !list) return;
        const headerHeight = header.getBoundingClientRect().height;
        const rowHeight = measure.getBoundingClientRect().height;
        const sectionGap = Number.parseFloat(getComputedStyle(slot).rowGap) || 0;
        const rowGap = Number.parseFloat(getComputedStyle(list).rowGap) || 0;
        const available = slot.clientHeight - headerHeight - sectionGap;
        this.upNextHeaderFits.set(slot.clientHeight >= headerHeight);
        this.upNextRowCount.set(rowHeight > 0
          ? Math.max(0, Math.min(3, Math.floor((available + rowGap) / (rowHeight + rowGap))))
          : 0);
      };
      const observer = new ResizeObserver(update);
      observer.observe(slot);
      update();
      onCleanup(() => observer.disconnect());
    });
  }

  private isTimelineScrubbing = false;

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
}

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
