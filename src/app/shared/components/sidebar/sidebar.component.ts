import { Component, OnDestroy, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { IconComponent } from '../icon/icon.component';
import { PlayerService } from '../../../core/player/player.service';

export type SidebarPhase = 'expanded' | 'collapsing' | 'collapsed' | 'expanding';

const LABEL_DELAY_MS = 70;
const COLLAPSE_WIDTH_DELAY_MS = 50;
const WIDTH_TRANSITION_MS = 160;
const TRANSITION_FALLBACK_PADDING_MS = 50;

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterModule, IconComponent],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss'
})
export class SidebarComponent implements OnDestroy {
  readonly player = inject(PlayerService);
  readonly isCollapsed = input<boolean>(false);
  readonly showNowPlayingDock = input(false);
  readonly toggleCollapse = output<void>();
  readonly phase = signal<SidebarPhase>('expanded');
  readonly widthCollapsed = signal(false);
  readonly labelsVisible = signal(true);
  readonly contentCollapsed = computed(() => this.phase() === 'collapsed');
  readonly isAnimating = computed(() => this.phase() === 'collapsing' || this.phase() === 'expanding');

  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private initialized = false;

  constructor() {
    effect(() => {
      const collapsed = this.isCollapsed();
      untracked(() => {
        if (!this.initialized) {
          this.initialized = true;
          this.applyImmediateState(collapsed);
          return;
        }
        this.transitionTo(collapsed);
      });
    });
  }

  ngOnDestroy(): void {
    this.clearTimers();
  }

  onWidthTransitionEnd(event: TransitionEvent): void {
    if (event.propertyName !== 'width' || event.target !== event.currentTarget) return;
    if (this.phase() === 'collapsing' && this.widthCollapsed()) this.finishTransition(true);
    else if (this.phase() === 'expanding' && !this.widthCollapsed()) this.finishTransition(false);
  }

  private transitionTo(collapsed: boolean): void {
    this.clearTimers();
    if (this.reducedMotion.matches) {
      this.applyImmediateState(collapsed);
      return;
    }

    if (collapsed) this.startCollapsing();
    else this.startExpanding();
  }

  private startCollapsing(): void {
    this.phase.set('collapsing');
    this.labelsVisible.set(false);

    this.schedule(() => {
      if (this.phase() !== 'collapsing') return;
      this.widthCollapsed.set(true);
    }, COLLAPSE_WIDTH_DELAY_MS);
    this.schedule(
      () => this.finishTransition(true),
      COLLAPSE_WIDTH_DELAY_MS + WIDTH_TRANSITION_MS + TRANSITION_FALLBACK_PADDING_MS,
    );
  }

  private startExpanding(): void {
    this.phase.set('expanding');
    this.labelsVisible.set(false);
    this.widthCollapsed.set(false);

    this.schedule(() => {
      if (this.phase() === 'expanding') this.labelsVisible.set(true);
    }, LABEL_DELAY_MS);
    this.schedule(
      () => this.finishTransition(false),
      WIDTH_TRANSITION_MS + TRANSITION_FALLBACK_PADDING_MS,
    );
  }

  private finishTransition(collapsed: boolean): void {
    if (this.isCollapsed() !== collapsed) return;
    this.clearTimers();
    this.phase.set(collapsed ? 'collapsed' : 'expanded');
    this.widthCollapsed.set(collapsed);
    this.labelsVisible.set(!collapsed);
  }

  private applyImmediateState(collapsed: boolean): void {
    this.clearTimers();
    this.phase.set(collapsed ? 'collapsed' : 'expanded');
    this.widthCollapsed.set(collapsed);
    this.labelsVisible.set(!collapsed);
  }

  private schedule(callback: () => void, delay: number): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      callback();
    }, delay);
    this.timers.add(timer);
  }

  private clearTimers(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }
}
