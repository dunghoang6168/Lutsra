import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { LIBRARY_GATEWAY, PLAYBACK_ENGINE, SETTINGS_GATEWAY, type LibraryGateway } from '../../../core/contracts';
import { MockPlaybackEngine, MockSettingsGateway } from '../../../core/mock';
import type { ScanProgress } from '../../../core/models';
import { PlayerService } from '../../../core/player/player.service';
import { AppHeaderComponent } from './app-header.component';

describe('AppHeaderComponent', () => {
  let fixture: ComponentFixture<AppHeaderComponent>;
  let gateway: jasmine.SpyObj<LibraryGateway>;
  let progress: BehaviorSubject<ScanProgress>;

  beforeEach(async () => {
    progress = new BehaviorSubject<ScanProgress>({ isScanning: false, scannedFiles: 0, audioFiles: 0, currentPath: null });
    gateway = jasmine.createSpyObj<LibraryGateway>('LibraryGateway', [
      'getLibrary', 'getFolderTree', 'getTrackDetails', 'selectAndAddMusicFolders', 'removeMusicFolder', 'requestScan',
    ]);
    Object.defineProperty(gateway, 'scanProgress$', { value: progress.asObservable() });
    gateway.getLibrary.and.resolveTo({ tracks: [], albums: [], artists: [], folders: [] });
    await TestBed.configureTestingModule({
      imports: [AppHeaderComponent],
      providers: [
        provideRouter([]),
        { provide: LIBRARY_GATEWAY, useValue: gateway },
        { provide: PLAYBACK_ENGINE, useClass: MockPlaybackEngine },
        { provide: SETTINGS_GATEWAY, useClass: MockSettingsGateway },
        PlayerService,
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AppHeaderComponent);
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('renders the integrated drag header and functional search control', () => {
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.app-header')).not.toBeNull();
    expect(element.querySelector('app-global-search input[role="combobox"]')).not.toBeNull();
    expect(element.querySelector('.runtime-status')).toBeNull();
    expect(element.querySelector('a.settings-button')).not.toBeNull();
    expect(getComputedStyle(element.querySelector('.app-header')!).getPropertyValue('-webkit-app-region')).toBe('drag');
  });

  it('centers the link-based Home and Settings controls', () => {
    const element = fixture.nativeElement as HTMLElement;
    const controls = [
      element.querySelector<HTMLElement>('a.home-button'),
      element.querySelector<HTMLElement>('a.settings-button'),
    ];

    for (const control of controls) {
      expect(control).not.toBeNull();
      const style = getComputedStyle(control!);
      expect(['flex', 'inline-flex']).toContain(style.display);
      expect(style.alignItems).toBe('center');
      expect(style.justifyContent).toBe('center');
      expect(style.padding).toBe('0px');
      expect(style.lineHeight).toBe('0px');
    }
  });

  it('toggles the sidebar from the former menu position without rendering the application menu', () => {
    const element = fixture.nativeElement as HTMLElement;
    const button = element.querySelector<HTMLButtonElement>('.sidebar-visibility-button')!;
    const navigation = element.querySelector<HTMLElement>('.navigation-buttons');
    const emit = spyOn(fixture.componentInstance.toggleSidebarVisibility, 'emit');
    expect(button.nextElementSibling).toBe(navigation);
    expect(getComputedStyle(button).width).toBe(window.matchMedia('(max-width: 900px)').matches ? '34px' : '38px');
    expect(getComputedStyle(button).getPropertyValue('-webkit-app-region')).toBe('no-drag');
    expect(button.getAttribute('aria-label')).toBe('Hide sidebar');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.querySelector('app-icon svg rect')).not.toBeNull();
    button.click();
    expect(emit).toHaveBeenCalledTimes(1);

    fixture.componentRef.setInput('sidebarHidden', true);
    fixture.detectChanges();
    expect(button.getAttribute('aria-label')).toBe('Show sidebar');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(element.querySelector('[aria-label="Open application menu"]')).toBeNull();
    expect(element.querySelector('.app-menu')).toBeNull();
    expect(element.querySelector('[aria-label="Go back"]')).not.toBeNull();
    expect(element.querySelector('[aria-label="Go forward"]')).not.toBeNull();
    expect(element.querySelector('[aria-label="Home"]')).not.toBeNull();
  });

  it('shows live scan progress and focuses search with Ctrl+K', () => {
    progress.next({ isScanning: true, scannedFiles: 42, audioFiles: 20, currentPath: 'D:\\Music' });
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Scanning · 42');

    fixture.componentInstance.onWindowKeyDown(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true }));
    const input = (fixture.nativeElement as HTMLElement).querySelector('app-global-search input') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
  });

  it('shows scan errors without restoring the idle status badge', () => {
    progress.next({ isScanning: false, scannedFiles: 42, audioFiles: 20, currentPath: null, error: 'Folder unavailable' });
    fixture.detectChanges();
    const status = (fixture.nativeElement as HTMLElement).querySelector('.runtime-status') as HTMLElement;
    expect(status.textContent).toContain('Scan warning');
    expect(status.title).toBe('Folder unavailable');

    progress.next({ isScanning: false, scannedFiles: 42, audioFiles: 20, currentPath: null, error: null });
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.runtime-status')).toBeNull();
  });
});
