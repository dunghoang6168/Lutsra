import { Component, computed, ElementRef, HostListener, inject, signal } from '@angular/core';
import { PlayerService } from '../../core/player/player.service';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { RangeSliderComponent } from '../../shared/components/range-slider/range-slider.component';

@Component({
  selector: 'app-inline-volume-control',
  standalone: true,
  imports: [IconComponent, RangeSliderComponent],
  templateUrl: './inline-volume-control.component.html',
  styleUrl: './inline-volume-control.component.scss',
})
export class InlineVolumeControlComponent {
  readonly player = inject(PlayerService);
  readonly expanded = signal(false);
  readonly adjusting = signal(false);
  readonly volumePercent = computed(() => Math.round(this.player.volume() * 100));
  readonly volumeLabel = computed(() => `${this.volumePercent()}%`);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  toggle(): void {
    this.expanded.update(open => !open);
    if (!this.expanded()) this.adjusting.set(false);
  }

  @HostListener('document:pointerdown', ['$event'])
  onDocumentPointerDown(event: PointerEvent): void {
    if (this.expanded() && !this.host.nativeElement.contains(event.target as Node)) {
      this.expanded.set(false);
      this.adjusting.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.expanded.set(false);
    this.adjusting.set(false);
  }
}
