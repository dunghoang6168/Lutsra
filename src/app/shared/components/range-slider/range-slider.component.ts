import { Component, computed, HostListener, input, output } from '@angular/core';

@Component({
  selector: 'app-range-slider',
  standalone: true,
  templateUrl: './range-slider.component.html',
  styleUrl: './range-slider.component.scss',
  host: {
    '[class.vertical]': "orientation() === 'vertical'",
    '[class.responsive-vertical]': 'responsiveVertical()',
    '[class.muted]': 'muted()',
    '[class.disabled]': 'disabled()',
  },
})
export class RangeSliderComponent {
  readonly inputId = input<string>();
  readonly min = input(0);
  readonly max = input(100);
  readonly step = input(1);
  readonly value = input(0);
  readonly disabled = input(false);
  readonly muted = input(false);
  readonly orientation = input<'horizontal' | 'vertical'>('horizontal');
  readonly responsiveVertical = input(false);
  readonly ariaLabel = input<string>();
  readonly ariaValueText = input<string>();
  readonly valueChange = output<number>();
  readonly adjustingChange = output<boolean>();

  readonly progress = computed(() => {
    const span = this.max() - this.min();
    if (!Number.isFinite(span) || span <= 0) return 0;
    return Math.max(0, Math.min(100, ((this.value() - this.min()) / span) * 100));
  });

  private adjusting = false;

  onInput(event: Event): void {
    this.valueChange.emit(Number((event.currentTarget as HTMLInputElement).value));
  }

  onPointerDown(): void {
    if (this.disabled() || this.adjusting) return;
    this.adjusting = true;
    this.adjustingChange.emit(true);
  }

  @HostListener('document:pointerup')
  @HostListener('document:pointercancel')
  onPointerEnd(): void {
    if (!this.adjusting) return;
    this.adjusting = false;
    this.adjustingChange.emit(false);
  }

  onBlur(): void {
    this.onPointerEnd();
  }
}
