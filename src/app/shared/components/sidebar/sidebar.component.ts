import { Component, DestroyRef, OnDestroy, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { IsActiveMatchOptions, RouterModule } from '@angular/router';
import { filter } from 'rxjs';
import { LIBRARY_GATEWAY } from '../../../core/contracts';
import { formatCount, QualityStats, summarizeQuality } from '../../../features/home/library-quality';
import { IconComponent, IconName } from '../icon/icon.component';

export type SidebarPhase = 'expanded' | 'collapsing' | 'collapsed' | 'expanding';

const LABEL_DELAY_MS = 70;
const COLLAPSE_WIDTH_DELAY_MS = 50;
const WIDTH_TRANSITION_MS = 160;
const TRANSITION_FALLBACK_PADDING_MS = 50;

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterModule, IconComponent],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss'
})
export class SidebarComponent implements OnDestroy {
  /** `tree` is the Console library tree; `rail` is the Ambient icon rail. */
  readonly variant = input<'tree' | 'rail'>('tree');
  readonly isCollapsed = input<boolean>(false);
  readonly toggleCollapse = output<void>();

  readonly navItems: { path: string; label: string; icon: IconName }[] = [
    { path: '/home', label: 'Home', icon: 'home' },
    { path: '/songs', label: 'Songs', icon: 'music' },
    { path: '/albums', label: 'Albums', icon: 'disc' },
    { path: '/artists', label: 'Artists', icon: 'user' },
    { path: '/playlists', label: 'Playlists', icon: 'list-music' },
    { path: '/folders', label: 'Folders', icon: 'folder' },
  ];
  readonly exactQuery: IsActiveMatchOptions = { paths: 'subset', queryParams: 'exact', fragment: 'ignored', matrixParams: 'ignored' };
  private readonly library = signal<{ tracks: number; albums: number; artists: number; quality: QualityStats } | null>(null);
  readonly counts = computed((): Record<string, string> => {
    const lib = this.library();
    if (!lib) return {};
    return { '/songs': formatCount.format(lib.tracks), '/albums': formatCount.format(lib.albums), '/artists': formatCount.format(lib.artists) };
  });
  readonly qualityItems = computed(() => {
    const q = this.library()?.quality;
    if (!q) return [];
    return [
      { key: 'lossless', label: 'Lossless', count: formatCount.format(q.lossless), params: { quality: 'lossless' }, warning: false },
      { key: 'hires', label: 'Hi-Res', count: formatCount.format(q.hires), params: { quality: 'hires' }, warning: false },
      { key: 'lossy', label: 'Lossy', count: formatCount.format(q.lossy), params: { quality: 'lossy' }, warning: false },
      { key: 'missing', label: 'Missing', count: formatCount.format(q.missing), params: { availability: 'missing' }, warning: q.missing > 0 },
    ];
  });
  private readonly gateway = inject(LIBRARY_GATEWAY);
  private readonly destroyRef = inject(DestroyRef);
  readonly phase = signal<SidebarPhase>('expanded');
  readonly widthCollapsed = signal(false);
  readonly labelsVisible = signal(true);
  readonly contentCollapsed = computed(() => this.phase() === 'collapsed');
  readonly isAnimating = computed(() => this.phase() === 'collapsing' || this.phase() === 'expanding');

  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private initialized = false;

  constructor() {
    let wasScanning = false;
    this.gateway.scanProgress$.pipe(
      filter((progress) => { const finished = wasScanning && !progress.isScanning; wasScanning = progress.isScanning; return finished; }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(() => this.refreshCounts());
    this.gateway.libraryChanged$?.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.refreshCounts());
    effect(() => { if (this.variant() === 'tree') untracked(() => this.refreshCounts()); });
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

  private refreshCounts(): void {
    if (this.variant() !== 'tree') return;
    this.gateway.getLibrary().then(
      (lib) => this.library.set({ tracks: lib.tracks.length, albums: lib.albums.length, artists: lib.artists.length, quality: summarizeQuality(lib.tracks) }),
      () => this.library.set(null),
    );
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
