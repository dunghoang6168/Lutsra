import { Component, ElementRef, OnDestroy, ViewChild, afterNextRender, input, output } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-confirm-remove-folder-dialog',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './confirm-remove-folder-dialog.component.html',
  styleUrl: './confirm-remove-folder-dialog.component.scss',
})
export class ConfirmRemoveFolderDialogComponent implements OnDestroy {
  readonly folderName = input.required<string>();
  readonly busy = input(false);
  readonly errorMessage = input<string | null>(null);
  readonly cancelled = output<void>();
  readonly confirmed = output<void>();
  @ViewChild('dialog') private dialog?: ElementRef<HTMLDialogElement>;
  @ViewChild('cancelButton') private cancelButton?: ElementRef<HTMLButtonElement>;
  private focusBeforeDialog: HTMLElement | null = null;

  constructor() {
    afterNextRender(() => {
      this.focusBeforeDialog = document.activeElement as HTMLElement | null;
      this.dialog?.nativeElement.showModal();
      this.cancelButton?.nativeElement.focus();
    });
  }

  ngOnDestroy(): void {
    this.dialog?.nativeElement.close();
    if (this.focusBeforeDialog?.isConnected) this.focusBeforeDialog.focus();
  }

  onCancel(event: Event): void {
    event.preventDefault();
    this.cancelled.emit();
  }

  onKeyDown(event: KeyboardEvent): void {
    // Keep global player/search shortcuts outside the modal's focus scope.
    event.stopPropagation();
    if (event.key === 'Escape') this.onCancel(event);
  }

  onBackdropClick(event: MouseEvent): void {
    const dialog = this.dialog?.nativeElement;
    if (!dialog || event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom) this.cancelled.emit();
  }
}
