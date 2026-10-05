import {
  ChangeDetectionStrategy, Component, HostListener, computed, effect, inject, input, output, signal, viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { LIBRARY_GATEWAY } from '../../../core/contracts';
import { getDesktopApi } from '../../../core/desktop/desktop-api';
import { NavigationHistoryService } from '../../../core/layout/navigation-history.service';
import { LayoutPreferenceService } from '../../../core/layout/layout-preference.service';
import { type ScanProgress } from '../../../core/models';
import { ThemeService } from '../../../core/theme/theme.service';
import { GlobalSearchComponent } from '../global-search/global-search.component';
import { IconComponent } from '../icon/icon.component';
import { WindowControlsComponent } from '../window-controls/window-controls.component';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [NgTemplateOutlet, RouterLink, RouterLinkActive, GlobalSearchComponent, IconComponent, WindowControlsComponent],
  templateUrl: './app-header.component.html',
  styleUrl: './app-header.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppHeaderComponent {
  readonly sidebarHidden = input(false);
  readonly toggleSidebarVisibility = output<void>();
  readonly layoutPreference = inject(LayoutPreferenceService);
  private readonly gateway = inject(LIBRARY_GATEWAY);
  private readonly theme = inject(ThemeService);
  private readonly search = viewChild.required(GlobalSearchComponent);
  private readonly desktopApi = getDesktopApi();
  private wasScanning = false;
  readonly compactSearchOpen = signal(false);

  readonly navHistory = inject(NavigationHistoryService);
  /** Gallery's section tabs; Folders lives in Settings › Music Library Folders. */
  readonly tabs = [
    { path: '/home', label: 'Home' },
    { path: '/songs', label: 'Songs' },
    { path: '/albums', label: 'Albums' },
    { path: '/artists', label: 'Artists' },
    { path: '/playlists', label: 'Playlists' },
  ];
  readonly scanProgress = toSignal(this.gateway.scanProgress$, {
    initialValue: {
      isScanning: false, scannedFiles: 0, audioFiles: 0, currentPath: null, error: null,
    } satisfies ScanProgress,
  });
  readonly statusLabel = computed(() => {
    const progress = this.scanProgress();
    if (progress.isScanning) return `Scanning · ${progress.scannedFiles}`;
    if (progress.error) return 'Scan warning';
    return '';
  });
  readonly statusTitle = computed(() => {
    const progress = this.scanProgress();
    if (progress.error) return progress.error;
    if (progress.isScanning) return progress.currentPath ?? `Scanning ${progress.scannedFiles} files`;
    return '';
  });

  constructor() {
    effect(() => {
      const mode = this.theme.effectiveTheme() === 'dark' ? 'dark' : 'light';
      void this.desktopApi?.windowControls.setTitleBarAppearance(mode).catch(() => undefined);
    });
    effect(() => {
      const scanning = this.scanProgress().isScanning;
      if (this.wasScanning && !scanning) queueMicrotask(() => this.search().refreshIfOpen());
      this.wasScanning = scanning;
    });
  }

  @HostListener('window:keydown', ['$event'])
  onWindowKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.compactSearchOpen()) this.closeCompactSearch();
    if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'k') {
      event.preventDefault();
      this.openCompactSearch();
    }
  }

  openCompactSearch(): void {
    this.compactSearchOpen.set(true);
    requestAnimationFrame(() => this.search().focus());
  }

  toggleCompactSearch(): void {
    if (this.compactSearchOpen()) this.closeCompactSearch();
    else this.openCompactSearch();
  }

  private closeCompactSearch(): void {
    this.compactSearchOpen.set(false);
    this.search().close();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.compactSearchOpen() || !(event.target instanceof Element)) return;
    const target = event.target;
    if (target.closest('app-global-search, .compact-search-button')) return;
    this.closeCompactSearch();
  }
}
