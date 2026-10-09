import { Component, ElementRef, HostListener, Injector, afterNextRender, inject, input, output, signal, viewChild } from '@angular/core';
import { Playlist, Track } from '../../../core/models';
import { PlayerService } from '../../../core/player/player.service';
import { QueueActionsService } from '../../../core/player/queue-actions.service';
import { AddToPlaylistDialogComponent } from '../add-to-playlist-dialog/add-to-playlist-dialog.component';
import { IconComponent } from '../icon/icon.component';

/** Row "⋯" button: Play next, Add to queue and Add to playlist in one menu. */
@Component({
  selector: 'app-track-actions-menu',
  standalone: true,
  imports: [AddToPlaylistDialogComponent, IconComponent],
  templateUrl: './track-actions-menu.component.html',
  styleUrl: './track-actions-menu.component.scss',
})
export class TrackActionsMenuComponent {
  readonly track = input.required<Track>();
  readonly tabIndex = input(0);
  readonly added = output<Playlist>();
  private readonly player = inject(PlayerService);
  private readonly queueActions = inject(QueueActionsService);
  private readonly injector = inject(Injector);
  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  private readonly menu = viewChild<ElementRef<HTMLElement>>('menu');
  readonly open = signal(false);
  readonly dialogOpen = signal(false);

  toggle(): void {
    if (this.open()) { this.close(); return; }
    this.open.set(true);
    afterNextRender(() => {
      const menu = this.menu()?.nativeElement;
      if (!menu || !this.open()) return;
      menu.showPopover();
      this.position();
      menu.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
    }, { injector: this.injector });
  }

  close(restoreFocus = true): void {
    if (!this.open()) return;
    this.menu()?.nativeElement.hidePopover();
    this.open.set(false);
    if (restoreFocus) this.trigger()?.nativeElement.focus();
  }

  playNext(): void {
    this.close();
    this.player.playNext([this.track()]);
    this.queueActions.notify('Added 1 track to play next');
  }

  addToQueue(): void {
    this.close();
    this.queueActions.add([this.track()]);
  }

  addToPlaylist(): void {
    this.close();
    this.dialogOpen.set(true);
  }

  // The menu and dialog sit inside a table row; a double-click in them must not play the row.
  @HostListener('dblclick', ['$event'])
  @HostListener('mousedown', ['$event'])
  stopRowEvent(event: Event): void {
    event.stopPropagation();
  }

  // The table scrolls inside its own container, so a fixed menu closes instead of following it.
  @HostListener('document:wheel')
  @HostListener('window:resize')
  onViewportChange(): void {
    this.close(false);
  }

  private position(): void {
    const menu = this.menu()?.nativeElement;
    const trigger = this.trigger()?.nativeElement;
    if (!this.open() || !menu || !trigger) return;
    const rect = trigger.getBoundingClientRect();
    const bounds = menu.getBoundingClientRect();
    const gap = 4;
    menu.style.left = Math.max(gap, Math.min(rect.right - bounds.width, window.innerWidth - bounds.width - gap)) + 'px';
    const below = rect.bottom + gap;
    menu.style.top = (below + bounds.height > window.innerHeight - gap ? Math.max(gap, rect.top - gap - bounds.height) : below) + 'px';
  }

  @HostListener('document:click', ['$event'])
  onOutsideClick(event: MouseEvent): void {
    if (!this.open() || !(event.target instanceof Node)) return;
    if (!this.menu()?.nativeElement.contains(event.target) && !this.trigger()?.nativeElement.contains(event.target)) this.close(false);
  }

  onMenuKeyDown(event: KeyboardEvent): void {
    // Arrow keys and Esc belong to the menu, not the track grid around it.
    event.stopPropagation();
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault();
      this.close(event.key === 'Escape');
      return;
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown' && event.key !== 'Home' && event.key !== 'End') return;
    const items = [...(this.menu()?.nativeElement.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  }
}
