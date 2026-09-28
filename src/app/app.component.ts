import { Component, HostListener, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { AppHeaderComponent } from './shared/components/app-header/app-header.component';
import { SidebarComponent } from './shared/components/sidebar/sidebar.component';
import { PlayerBarComponent } from './shared/components/player-bar/player-bar.component';
import { QueueDrawerComponent } from './shared/components/queue-drawer/queue-drawer.component';
import { TrackDetailsPanelComponent } from './shared/components/track-details-panel/track-details-panel.component';
import { RightPanelService } from './core/layout/right-panel.service';
import { PlayerService } from './core/player/player.service';
import { LayoutPreferenceService } from './core/layout/layout-preference.service';
import { ArtworkGlowPositionService } from './core/layout/artwork-glow-position.service';
import { ArtworkEdgeGlowService, EDGE_GLOW_SPREAD } from './core/layout/artwork-edge-glow.service';

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
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  readonly isSidebarCollapsed = signal(readSavedFlag(SIDEBAR_COLLAPSED_KEY));
  readonly isSidebarHidden = signal(readSavedFlag(SIDEBAR_HIDDEN_KEY));
  readonly rightPanels = inject(RightPanelService);
  readonly player = inject(PlayerService);
  readonly layoutPreference = inject(LayoutPreferenceService);
  readonly artworkGlowPosition = inject(ArtworkGlowPositionService);
  private readonly artworkEdgeGlow = inject(ArtworkEdgeGlowService);
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
  readonly hasPlaybackOrQueue = computed(() => this.player.isPlaybackActive() || this.player.queue().length > 0);
  readonly nowPlayingArtwork = computed(() =>
    this.currentUrl().split(/[?#]/, 1)[0] === '/now-playing' ? this.player.currentTrack()?.artwork ?? null : null);
  readonly showPlayerBar = computed(() => this.layoutPreference.mode() === 'classic' ||
    (this.hasPlaybackOrQueue() && this.currentUrl().split(/[?#]/, 1)[0] !== '/now-playing'));

  constructor() {
    effect(() => {
      if (this.layoutPreference.mode() === 'inset' && !this.hasPlaybackOrQueue()) this.rightPanels.closeQueue();
    });
    effect(() => {
      const artwork = this.nowPlayingArtwork();
      if (!artwork || this.layoutPreference.mode() !== 'inset') {
        this.panelGlow.set(null);
        return;
      }
      this.panelGlow.set(null);
      void this.artworkEdgeGlow.getGlow(artwork).then((url) => {
        if (this.nowPlayingArtwork() === artwork && this.layoutPreference.mode() === 'inset') {
          this.panelGlow.set({ source: artwork, url });
        }
      });
    });
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
    if (this.layoutPreference.mode() === 'inset' && !this.hasPlaybackOrQueue()) return;
    this.rightPanels.toggleQueue();
  }

  onCloseQueue(): void {
    this.rightPanels.closeQueue();
  }

  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.rightPanels.closeActive();
      return;
    }
    if (event.code !== 'Space' || !this.hasPlaybackOrQueue()) return;

    const activeEl = document.activeElement as HTMLElement | null;
    const activeTag = activeEl?.tagName.toLowerCase();
    if (
      activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select' ||
      activeTag === 'button' || activeTag === 'a' ||
      activeEl?.getAttribute('role') === 'button' || activeEl?.isContentEditable
    ) return;

    event.preventDefault();
    this.player.togglePlayPause();
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
