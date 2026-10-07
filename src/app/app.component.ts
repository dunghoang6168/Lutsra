import { AfterViewChecked, Component, DestroyRef, ElementRef, HostListener, ViewChild, afterNextRender, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { AppHeaderComponent } from './shared/components/app-header/app-header.component';
import { SidebarComponent } from './shared/components/sidebar/sidebar.component';
import { PlayerBarComponent } from './shared/components/player-bar/player-bar.component';
import { QueueDrawerComponent } from './shared/components/queue-drawer/queue-drawer.component';
import { TrackDetailsPanelComponent } from './shared/components/track-details-panel/track-details-panel.component';
import { IconComponent } from './shared/components/icon/icon.component';
import { RightPanelService } from './core/layout/right-panel.service';
import { PlayerService } from './core/player/player.service';
import { QueueActionsService } from './core/player/queue-actions.service';
import { LayoutPreferenceService } from './core/layout/layout-preference.service';
import { ArtworkGlowPositionService } from './core/layout/artwork-glow-position.service';
import { ArtworkEdgeGlowService, EDGE_GLOW_SPREAD } from './core/layout/artwork-edge-glow.service';
import { RecentPlaysService } from './core/layout/recent-plays.service';
import { AcrylicScrollbarService } from './core/layout/acrylic-scrollbar.service';
import { LIBRARY_GATEWAY } from './core/contracts';
import { getDesktopApi } from './core/desktop/desktop-api';

const SIDEBAR_COLLAPSED_KEY = 'lutsra.sidebar.collapsed';
const SIDEBAR_HIDDEN_KEY = 'lutsra.sidebar.hidden';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    AppHeaderComponent,
    SidebarComponent,
    PlayerBarComponent,
    QueueDrawerComponent,
    TrackDetailsPanelComponent,
    IconComponent,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements AfterViewChecked {
  readonly isSidebarCollapsed = signal(readSavedFlag(SIDEBAR_COLLAPSED_KEY));
  readonly isSidebarHidden = signal(readSavedFlag(SIDEBAR_HIDDEN_KEY));
  readonly windowWidth = signal(typeof window !== 'undefined' ? window.innerWidth : 1280);
  readonly rightPanels = inject(RightPanelService);
  readonly player = inject(PlayerService);
  readonly queueActions = inject(QueueActionsService);
  readonly layoutPreference = inject(LayoutPreferenceService);
  readonly artworkGlowPosition = inject(ArtworkGlowPositionService);
  private readonly artworkEdgeGlow = inject(ArtworkEdgeGlowService);
  private readonly acrylicScrollbars = inject(AcrylicScrollbarService);
  private readonly recentPlays = inject(RecentPlaysService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly libraryGateway = inject(LIBRARY_GATEWAY);
  @ViewChild('onboardingDialog') private onboardingDialog?: ElementRef<HTMLElement>;
  @ViewChild('shortcutsDialog') private shortcutsDialog?: ElementRef<HTMLElement>;
  readonly showShortcuts = signal(false);
  private needsShortcutsFocus = false;
  private needsShortcutsFocusRestore = false;
  private focusBeforeShortcuts: HTMLElement | null = null;
  readonly showOnboarding = signal(false);
  readonly onboardingBusy = signal(false);
  readonly onboardingError = signal<string | null>(null);
  private onboardingChecked = false;
  private needsOnboardingFocus = false;
  private needsFocusRestore = false;
  private focusBeforeOnboarding: HTMLElement | null = null;
  readonly edgeGlowSpread = EDGE_GLOW_SPREAD;
  readonly panelGlow = signal<{ source: string; url: string | null } | null>(null);
  private readonly router = inject(Router);
  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );
  readonly isQueueOpen = this.rightPanels.isQueueOpen;
  readonly layout = this.layoutPreference.mode;
  readonly hasTrackOrQueue = computed(() => this.player.currentTrack() !== null || this.player.queue().length > 0);
  private readonly onNowPlaying = computed(() => this.currentUrl().split(/[?#]/, 1)[0] === '/now-playing');
  /** Ambient lays the playing artwork under every page, Gallery only on Now Playing, Console never (no glow). */
  readonly backdropArtwork = computed(() => {
    const artwork = this.player.currentTrack()?.artwork ?? null;
    if (this.layout() === 'classic') return null;
    return this.layout() === 'liquid-glass' || this.onNowPlaying() ? artwork : null;
  });
  /** Console's strip is permanent; Gallery's rail and Ambient's dock appear once there is music. */
  readonly showPlayer = computed(() => {
    if (this.layout() === 'classic') return true;
    if (!this.hasTrackOrQueue()) return false;
    return this.layout() === 'liquid-glass' || !this.onNowPlaying();
  });
  readonly consoleInspector = computed(() => this.layout() === 'classic' && this.windowWidth() >= 1100);
  /** Audio notices dismiss themselves; hover or focus holds the countdown (WCAG 2.2.1). */
  readonly noticeDurationMs = 8000;
  readonly noticePaused = signal(false);
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;
  private noticeDeadline = 0;
  private noticeRemaining = 0;

  @HostListener('window:resize')
  onWindowResize(): void {
    this.windowWidth.set(window.innerWidth);
  }

  constructor() {
    afterNextRender(() => this.acrylicScrollbars.start());
    this.destroyRef.onDestroy(() => {
      this.acrylicScrollbars.stop();
      clearTimeout(this.noticeTimer);
    });
    void this.checkOnboarding();
    effect(() => {
      // A JS timer, not animationend: reduced motion collapses animations to 0.01ms.
      clearTimeout(this.noticeTimer);
      this.noticeTimer = undefined;
      this.noticePaused.set(false);
      if (!this.player.playbackNotice()) return;
      this.noticeRemaining = this.noticeDurationMs;
      this.startNoticeTimer();
    });
    effect(() => {
      if (this.layoutPreference.mode() !== 'classic' && !this.hasTrackOrQueue()) this.rightPanels.closeQueue();
    });
    effect(() => {
      const artwork = this.backdropArtwork();
      if (!artwork || this.layoutPreference.mode() !== 'inset') {
        this.panelGlow.set(null);
        return;
      }
      this.panelGlow.set(null);
      void this.artworkEdgeGlow.getGlow(artwork).then((url) => {
        if (this.backdropArtwork() === artwork && this.layoutPreference.mode() === 'inset') {
          this.panelGlow.set({ source: artwork, url });
        }
      });
    });
  }

  pauseNotice(): void {
    if (!this.noticeTimer) return;
    clearTimeout(this.noticeTimer);
    this.noticeTimer = undefined;
    this.noticeRemaining = Math.max(0, this.noticeDeadline - Date.now());
    this.noticePaused.set(true);
  }

  resumeNotice(): void {
    if (!this.noticePaused()) return;
    this.noticePaused.set(false);
    this.startNoticeTimer();
  }

  private startNoticeTimer(): void {
    this.noticeDeadline = Date.now() + this.noticeRemaining;
    this.noticeTimer = setTimeout(() => {
      this.noticeTimer = undefined;
      this.player.playbackNotice.set(null);
    }, this.noticeRemaining);
  }

  private async checkOnboarding(): Promise<void> {
    if (!getDesktopApi() || this.onboardingChecked) return;
    this.onboardingChecked = true;
    try {
      if ((await this.libraryGateway.getLibrary()).folders.length === 0) {
        this.focusBeforeOnboarding = document.activeElement as HTMLElement | null;
        this.showOnboarding.set(true);
        this.needsOnboardingFocus = true;
      }
    } catch (error) {
      console.error('[library:onboarding] Failed to inspect folders', error);
    }
  }

  ngAfterViewChecked(): void {
    if (this.needsShortcutsFocusRestore && !this.showShortcuts()) {
      this.needsShortcutsFocusRestore = false;
      if (this.focusBeforeShortcuts?.isConnected) this.focusBeforeShortcuts.focus();
    }
    if (this.needsShortcutsFocus && this.shortcutsDialog) {
      this.needsShortcutsFocus = false;
      this.shortcutsDialog.nativeElement.querySelector<HTMLButtonElement>('button')?.focus();
    }
    if (this.needsFocusRestore && !this.showOnboarding()) {
      this.needsFocusRestore = false;
      if (this.focusBeforeOnboarding?.isConnected) this.focusBeforeOnboarding.focus();
    }
    if (!this.needsOnboardingFocus || !this.onboardingDialog) return;
    this.needsOnboardingFocus = false;
    this.onboardingDialog.nativeElement.querySelector<HTMLButtonElement>('button')?.focus();
  }

  closeOnboarding(): void {
    this.showOnboarding.set(false);
    this.onboardingError.set(null);
    this.needsFocusRestore = true;
  }

  async onAddMusicFolder(): Promise<void> {
    if (this.onboardingBusy()) return;
    this.onboardingBusy.set(true);
    this.onboardingError.set(null);
    try {
      const added = await this.libraryGateway.selectAndAddMusicFolders();
      if (added.length) this.closeOnboarding();
      else this.needsOnboardingFocus = true;
    } catch (error) {
      this.onboardingError.set(error instanceof Error ? error.message : 'Failed to add music folders');
      this.needsOnboardingFocus = true;
    } finally {
      this.onboardingBusy.set(false);
    }
  }

  onOnboardingKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.closeOnboarding();
    } else if (event.key === 'Tab') {
      const buttons = [...(this.onboardingDialog?.nativeElement.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [])];
      if (!buttons.length) return;
      const first = buttons[0];
      const last = buttons.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }

  onToggleSidebar(): void {
    this.isSidebarCollapsed.update((val) => !val);
    saveFlag(SIDEBAR_COLLAPSED_KEY, this.isSidebarCollapsed());
  }

  onToggleSidebarVisibility(): void {
    this.isSidebarHidden.update((hidden) => !hidden);
    saveFlag(SIDEBAR_HIDDEN_KEY, this.isSidebarHidden());
  }

  onToggleQueue(): void {
    if (this.layoutPreference.mode() !== 'classic' && !this.hasTrackOrQueue()) return;
    this.rightPanels.toggleQueue();
  }

  onCloseQueue(): void {
    this.rightPanels.closeQueue();
  }

  closeShortcuts(): void {
    this.showShortcuts.set(false);
    this.needsShortcutsFocusRestore = true;
  }

  onShortcutsKeyDown(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeShortcuts();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      this.shortcutsDialog?.nativeElement.querySelector<HTMLButtonElement>('button')?.focus();
    }
  }

  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    if (this.showOnboarding()) {
      if (event.key === 'Escape') { event.preventDefault(); this.closeOnboarding(); }
      return;
    }
    if (this.showShortcuts()) {
      if (event.key === 'Escape') { event.preventDefault(); this.closeShortcuts(); }
      return;
    }
    if (event.defaultPrevented || event.isComposing) return;
    // Some existing playlist/confirmation dialogs use a backdrop without aria-modal.
    if ([...document.querySelectorAll<HTMLElement>('[aria-modal="true"], dialog[open], .modal-backdrop, .metadata-modal-backdrop')]
      .some((dialog) => dialog.checkVisibility())) return;
    if (event.key === 'Escape') {
      this.rightPanels.closeActive();
      return;
    }
    if (event.ctrlKey || event.altKey || event.metaKey || event.repeat) return;

    const activeEl = document.activeElement as HTMLElement | null;
    if (activeEl?.isContentEditable || activeEl?.closest(
      'input, textarea, select, [role="textbox"], [role="combobox"], [role="searchbox"]',
    )) return;

    switch (event.code) {
      case 'Slash':
        if (!event.shiftKey) return;
        this.focusBeforeShortcuts = activeEl;
        this.showShortcuts.set(true);
        this.needsShortcutsFocus = true;
        break;
      case 'Space':
        if (!this.hasTrackOrQueue() || activeEl?.closest('button, a, [role="button"]')) return;
        this.player.togglePlayPause();
        break;
      case 'KeyP':
        if (!this.player.currentTrack()) return;
        this.player.previous();
        break;
      case 'KeyN':
        if (!this.player.currentTrack()) return;
        this.player.next();
        break;
      case 'KeyS':
        if (!this.player.queue().length) return;
        this.player.toggleShuffle();
        break;
      case 'KeyR':
        this.player.cycleRepeatMode();
        break;
      case 'KeyM':
        this.player.toggleMute();
        break;
      case 'KeyQ':
        if (this.layoutPreference.mode() !== 'classic' && !this.hasTrackOrQueue()) return;
        this.onToggleQueue();
        break;
      default:
        return;
    }

    event.preventDefault();
  }
}

function readSavedFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

function saveFlag(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // The controls remain usable when local storage is unavailable.
  }
}
