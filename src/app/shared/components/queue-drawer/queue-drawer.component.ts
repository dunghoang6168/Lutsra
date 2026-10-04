import { Component, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PlayerService } from '../../../core/player/player.service';
import { QueueActionsService } from '../../../core/player/queue-actions.service';
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
  readonly queueActions = inject(QueueActionsService);
  readonly isOpen = input<boolean>(false);
  readonly close = output<void>();
  readonly draggingEntryId = signal<string | null>(null);
  readonly dropTarget = signal<{ entryId: string; placement: 'before' | 'after' } | null>(null);
  readonly reorderAnnouncement = signal('');

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
    this.moveEntry(entryId, target.id, direction < 0 ? 'before' : 'after');
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
