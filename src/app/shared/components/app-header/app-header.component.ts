import {
  ChangeDetectionStrategy, Component, HostListener, computed, effect, inject, input, output, viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { LIBRARY_GATEWAY } from '../../../core/contracts';
import { getDesktopApi } from '../../../core/desktop/desktop-api';
import { NavigationHistoryService } from '../../../core/layout/navigation-history.service';
import { LIGHT_THEME_PRESETS, type ScanProgress } from '../../../core/models';
import { ThemeService } from '../../../core/theme/theme.service';
import { GlobalSearchComponent } from '../global-search/global-search.component';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, GlobalSearchComponent, IconComponent],
  templateUrl: './app-header.component.html',
  styleUrl: './app-header.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppHeaderComponent {
  readonly sidebarHidden = input(false);
  readonly toggleSidebarVisibility = output<void>();
  private readonly gateway = inject(LIBRARY_GATEWAY);
  private readonly theme = inject(ThemeService);
  private readonly search = viewChild.required(GlobalSearchComponent);
  private readonly desktopApi = getDesktopApi();
  private wasScanning = false;

  readonly history = inject(NavigationHistoryService);
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
      const preset = this.theme.themePreset();
      const mode = (LIGHT_THEME_PRESETS as readonly string[]).includes(preset) ? 'light' : 'dark';
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
    if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'k') {
      event.preventDefault();
      this.search().focus();
    }
  }
}
