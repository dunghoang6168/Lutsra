import { AfterViewInit, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, ViewChild, inject, signal } from '@angular/core';
import { getDesktopApi } from '../../../core/desktop/desktop-api';

@Component({
  selector: 'app-window-controls',
  standalone: true,
  templateUrl: './window-controls.component.html',
  styleUrl: './window-controls.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WindowControlsComponent implements AfterViewInit {
  private readonly controls = getDesktopApi()?.windowControls;
  private readonly destroyRef = inject(DestroyRef);

  readonly enabled = this.controls?.customControls === true;
  readonly isMaximized = signal(false);
  readonly snapHovered = signal(false);
  @ViewChild('maximizeButton') private maximizeButton?: ElementRef<HTMLButtonElement>;
  private resizeObserver?: ResizeObserver;
  private measureFrame = 0;

  constructor() {
    if (!this.enabled || !this.controls) return;

    const unsubscribe = this.controls.onStateChange((state) => this.isMaximized.set(state.isMaximized));
    this.destroyRef.onDestroy(unsubscribe);
    this.destroyRef.onDestroy(this.controls.onSnapHoverChange((hovered) => this.snapHovered.set(hovered)));
    void this.controls.getState().then((state) => this.isMaximized.set(state.isMaximized)).catch(() => undefined);
    this.destroyRef.onDestroy(() => {
      this.resizeObserver?.disconnect();
      window.removeEventListener('resize', this.scheduleMeasurement);
      window.removeEventListener('focus', this.scheduleMeasurement);
      window.visualViewport?.removeEventListener('resize', this.scheduleMeasurement);
      cancelAnimationFrame(this.measureFrame);
    });
  }

  ngAfterViewInit(): void {
    if (!this.enabled || !this.maximizeButton) return;
    this.resizeObserver = new ResizeObserver(this.scheduleMeasurement);
    this.resizeObserver.observe(this.maximizeButton.nativeElement);
    const controls = this.maximizeButton.nativeElement.closest('.window-controls');
    if (controls) this.resizeObserver.observe(controls);
    const toolbar = this.maximizeButton.nativeElement.closest('.header-right');
    if (toolbar) this.resizeObserver.observe(toolbar);
    window.addEventListener('resize', this.scheduleMeasurement);
    window.addEventListener('focus', this.scheduleMeasurement);
    window.visualViewport?.addEventListener('resize', this.scheduleMeasurement);
    this.scheduleMeasurement();
  }

  private readonly scheduleMeasurement = (): void => {
    cancelAnimationFrame(this.measureFrame);
    this.measureFrame = requestAnimationFrame(() => {
      const rect = this.maximizeButton?.nativeElement.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return;
      void this.controls?.setSnapButtonBounds({
        x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      }).catch(() => undefined);
    });
  };

  minimize(): void {
    void this.controls?.minimize().catch(() => undefined);
  }

  toggleMaximize(): void {
    void this.controls?.toggleMaximize().then((state) => this.isMaximized.set(state.isMaximized)).catch(() => undefined);
  }

  close(): void {
    void this.controls?.close().catch(() => undefined);
  }
}
