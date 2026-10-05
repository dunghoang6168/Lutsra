import { Component, afterNextRender, effect, ElementRef, Injector, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PlayerService } from '../../../core/player/player.service';
import { QueueActionsService } from '../../../core/player/queue-actions.service';
import { focusListItem, nextRowIndex } from '../../utils/row-navigation';
import { DurationPipe } from '../../pipes/duration.pipe';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-queue-drawer',
  standalone: true,
  imports: [CommonModule, DurationPipe, IconComponent],
  templateUrl: './queue-drawer.component.html',
  styleUrl: './queue-drawer.component.scss'
})
export class QueueDrawerComponent {
  readonly player = inject(PlayerService);
  private readonly injector = inject(Injector);
  private readonly rowsContainer = viewChild<ElementRef<HTMLElement>>('rowsContainer');
  readonly activeId = signal<string | null>(null);
  readonly queueActions = inject(QueueActionsService);
  readonly isOpen = input<boolean>(false);
  readonly close = output<void>();
  readonly draggingEntryId = signal<string | null>(null);
  readonly dropTarget = signal<{ entryId: string; placement: 'before' | 'after' } | null>(null);
  readonly reorderAnnouncement = signal('');

  constructor() {
    effect(() => {
      const entries = this.player.queue();
      untracked(() => {
        if (!entries.some((entry) => entry.id === this.activeId())) {
          this.activeId.set(entries[0]?.id ?? null);
        }
      });
    });
  }

  onActivateEntry(entryId: string, moveFocus = false): void {
    if (!this.isOpen()) return;
    this.activeId.set(entryId);
    if (moveFocus) focusListItem(this.rowsContainer()?.nativeElement, 'data-entry-id', entryId);
  }

  onRowsKeyDown(event: KeyboardEvent): void {
    if (!this.isOpen()) return;
    if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.closest(
      'button, input, textarea, select, a, [contenteditable], [role="button"], [role="textbox"], [role="combobox"]',
    )) return;
    const row = target.closest<HTMLElement>('.queue-item[data-entry-id]');
    if (!row || row.parentElement !== event.currentTarget) return;
    const rows = this.player.queue();
    const current = rows.findIndex((entry) => entry.id === row.dataset['entryId']);
    if (current < 0) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      this.player.jumpToQueueIndex(current);
      return;
    }
    let next = nextRowIndex(event.key, current, rows.length, 1);
    if (next === null) return;
    event.preventDefault();
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      const viewport = row.ownerDocument.querySelector<HTMLElement>('.main-content');
      const rowHeight = row.getBoundingClientRect().height;
      const clearance = Number.parseFloat(getComputedStyle(row).scrollMarginTop) || 0;
      const pageSize = viewport && rowHeight > 0
        ? Math.max(1, Math.floor((viewport.clientHeight - clearance) / rowHeight))
        : 1;
      next = nextRowIndex(event.key, current, rows.length, pageSize)!;
    }
    this.onActivateEntry(rows[next].id, true);
  }

  onDragStart(event: DragEvent, entryId: string): void {
    event.stopPropagation();
    if (!event.dataTransfer) return;
    this.draggingEntryId.set(entryId);
    this.dropTarget.set(null);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', entryId);
  }

  onDragOver(event: DragEvent, entryId: string): void {
    const sourceId = this.draggingEntryId();
    if (!sourceId || sourceId === entryId) {
      this.dropTarget.set(null);
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const placement = this.dropPlacement(event);
    if (this.isUnchangedPosition(sourceId, entryId, placement)) {
      this.dropTarget.set(null);
      return;
    }
    const current = this.dropTarget();
    if (current?.entryId !== entryId || current.placement !== placement) {
      this.dropTarget.set({ entryId, placement });
    }
  }

  onDragLeave(event: DragEvent, entryId: string): void {
    const row = event.currentTarget as HTMLElement;
    if (event.relatedTarget instanceof Node && row.contains(event.relatedTarget)) return;
    if (this.dropTarget()?.entryId === entryId) this.dropTarget.set(null);
  }

  onDrop(event: DragEvent, entryId: string): void {
    const sourceId = this.draggingEntryId();
    if (!sourceId) return;
    event.preventDefault();
    event.stopPropagation();
    if (sourceId !== entryId) this.moveEntry(sourceId, entryId, this.dropPlacement(event));
    this.clearDragState();
  }

  onDragEnd(): void {
    this.clearDragState();
  }

  onHandleKeydown(event: KeyboardEvent, entryId: string): void {
    event.stopPropagation();
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const entries = this.player.queue();
    const index = entries.findIndex((entry) => entry.id === entryId);
    const direction = event.key === 'ArrowUp' ? -1 : 1;
    const target = entries[index + direction];
    if (index < 0 || !target) return;
    const handle = event.currentTarget;
    const restoreFocus = handle instanceof HTMLElement && document.activeElement === handle;
    this.moveEntry(entryId, target.id, direction < 0 ? 'before' : 'after');
    if (restoreFocus) {
      afterNextRender(() => {
        if (!this.isOpen() || this.activeId() !== entryId) return;
        if (document.activeElement !== handle && document.activeElement !== document.body) return;
        focusListItem(this.rowsContainer()?.nativeElement, 'data-entry-id', entryId, '.drag-handle');
      }, { injector: this.injector });
    }
  }

  private dropPlacement(event: DragEvent): 'before' | 'after' {
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after';
  }

  private moveEntry(sourceId: string, targetId: string, placement: 'before' | 'after'): void {
    if (!this.player.moveQueueEntry(sourceId, targetId, placement)) return;
    const newIndex = this.player.queue().findIndex((entry) => entry.id === sourceId);
    this.reorderAnnouncement.set(`Moved to position ${newIndex + 1} of ${this.player.queue().length}.`);
  }

  private isUnchangedPosition(sourceId: string, targetId: string, placement: 'before' | 'after'): boolean {
    const entries = this.player.queue();
    const sourceIndex = entries.findIndex((entry) => entry.id === sourceId);
    const targetIndex = entries.findIndex((entry) => entry.id === targetId);
    return sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex
      || (placement === 'before' && sourceIndex === targetIndex - 1)
      || (placement === 'after' && sourceIndex === targetIndex + 1);
  }

  private clearDragState(): void {
    this.draggingEntryId.set(null);
    this.dropTarget.set(null);
  }

  onRemove(event: MouseEvent, entryId: string): void {
    event.stopPropagation();
    this.player.removeFromQueue(entryId);
  }
}
